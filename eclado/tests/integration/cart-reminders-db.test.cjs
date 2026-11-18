const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');
const config = require('../../src/config/cartReminder.json');

test('abandoned cart reminders: settings, 24h eligibility, leases, delivery and round isolation', { skip:!process.env.PGLITE_MODULE }, async t => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
  const db = new PGlite();
  const uid='11111111-1111-4111-8111-111111111111';
  const second='22222222-2222-4222-8222-222222222222';
  const line='U'+'a'.repeat(32);
  const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
  const result=async(sql,args=[]) => (await q(sql,args))[0]?.result;
  const worker=()=>db.exec("reset role; set role service_role; set request.jwt.claim.role='service_role';");
  const owner=()=>db.exec("reset role; set request.jwt.claim.role='';");
  const claim=async(available=true)=>{await worker();return result('select public.claim_cart_reminder($1) result',[available]);};
  const prepare=async(job,available=true)=>{await worker();return result('select public.prepare_cart_reminder($1,$2,$3,$4) result',[job.id,job.lease_token,available,'ECLADO <service@example.test>']);};
  const complete=async(job,status='accepted')=>{await worker();return result('select public.complete_cart_reminder($1,$2,$3,null) result',[job.id,job.lease_token,status]);};
  const inspect=async(id)=>{await owner();return (await q('select * from public.cart_reminder_jobs where id=$1',[id]))[0];};
  async function reset(){
    await owner();
    await db.exec(`delete from public.orders;delete from public.member_carts;
      update public.cart_reminder_settings set enabled=true,enabled_at=now()-interval '26 hours';
      update public.profiles set line_user_id='${line}',email='member@example.test' where id='${uid}';
      update auth.users set email_confirmed_at=now() where id='${uid}';
      insert into public.member_carts(user_id,items,revision,updated_at) values('${uid}','[{"id":1,"variantId":"11","qty":2}]',1,now()-interval '25 hours');`);
    await q('update public.cart_reminder_settings set content=$1',[config.defaultContent]);
  }
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
      create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create function auth.role() returns text language sql as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
      create function public.has_backoffice_permission(p text) returns boolean language sql as $$select p='notifications.send' and coalesce(current_setting('test.can_notify',true),'')='on' and auth.uid() is not null$$;
      create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,email text,line_user_id text);
      create table public.orders(id text primary key,user_id uuid,order_source text default 'online',created_at timestamptz default now());
      grant usage on schema public,auth to authenticated,anon,service_role;
      insert into auth.users values('${uid}','member@example.test',now()),('${second}','second@example.test',now());
      insert into public.profiles values('${uid}','member@example.test','${line}'),('${second}','second@example.test',null);`);
    await db.exec(readFileSync(resolve(__dirname,'../../supabase-member-carts.sql'),'utf8'));
    const sql=readFileSync(resolve(__dirname,'../../supabase-cart-reminders.sql'),'utf8');
    await db.exec(sql);await db.exec(sql);

    await t.test('default template, permission boundaries, and concurrent settings edits',async()=>{
      assert.deepEqual((await q('select enabled,content,version from public.cart_reminder_settings'))[0],{enabled:false,content:config.defaultContent,version:0});
      await db.exec(`set role authenticated;set test.uid='${uid}';set test.can_notify='off';`);
      await assert.rejects(result('select public.get_cart_reminder_settings() result'),/access required/);
      await assert.rejects(q('select * from public.cart_reminder_jobs'),/permission denied/);
      await assert.rejects(q('select public.claim_cart_reminder(true)'),/permission denied/);
      await db.exec("set test.can_notify='on';");
      const saved=await result('select public.save_cart_reminder_settings(true,$1,0) result',[config.defaultContent]);
      assert.equal(saved.enabled,true);assert.equal(saved.version,1);
      await assert.rejects(result('select public.save_cart_reminder_settings(true,$1,0) result',[config.defaultContent]),/其他管理員/);
      await assert.rejects(result("select public.save_cart_reminder_settings(true,'no link',1) result"),/購物車連結/);
      await assert.rejects(result('select public.save_cart_reminder_settings(true,$1,1) result',[config.placeholder.repeat(200)]),/購物車連結/);
      await db.exec('reset role;set role anon;');
      await assert.rejects(q('select public.get_cart_reminder_settings()'),/permission denied/);
    });
    await t.test('24 hours, disabled switch, verified contact and existing online orders',async()=>{
      await reset();await owner();await db.exec("update public.cart_reminder_settings set enabled=false");assert.equal(await claim(),null);
      await owner();await db.exec("update public.cart_reminder_settings set enabled=true,enabled_at=now()");assert.equal(await claim(),null);
      await owner();await db.exec("update public.cart_reminder_settings set enabled_at=now()-interval '26 hours';update public.member_carts set updated_at=now()-interval '23 hours'");assert.equal(await claim(),null);
      await owner();await db.exec("update public.member_carts set updated_at=now()-interval '25 hours';update public.profiles set line_user_id=null;update auth.users set email_confirmed_at=null;");assert.equal(await claim(),null);
      await owner();await db.exec(`update auth.users set email_confirmed_at=now();insert into public.orders(id,user_id) values('online-order','${uid}');`);assert.equal(await claim(),null);
      await owner();await db.exec("update public.orders set order_source='historical_manual'");assert(await claim(false));
    });
    await t.test('exclusive lease, final order check and stale worker token',async()=>{
      await reset();const job=await claim();assert(job);assert.equal(await claim(),null);
      await owner();await db.exec(`insert into public.orders(id,user_id) values('new-order','${uid}');`);
      assert.equal(await prepare(job),null);assert.equal((await inspect(job.id)).status,'cancelled');
      assert.equal(await complete(job),false);
    });
    await t.test('cart changes before first delivery defer 24h; empty cart starts a new round',async()=>{
      await reset();const job=await claim();
      await owner();await db.exec("update public.member_carts set items='[{\"id\":1,\"variantId\":\"11\",\"qty\":3}]',revision=2,updated_at=now()");
      assert.equal(await prepare(job),null);let row=await inspect(job.id);assert.equal(row.status,'pending');assert.equal(row.attempts,0);
      await owner();await db.exec("update public.member_carts set updated_at=now()-interval '25 hours';update public.cart_reminder_jobs set next_retry_at=now()-interval '1 minute'");
      const reclaimed=await claim();const payload=await prepare(reclaimed);assert.equal(payload.target,line);assert.equal(payload.payload.content,config.defaultContent);
      assert.equal(await complete(reclaimed),true);row=await inspect(job.id);assert.equal(row.targets,null);assert.equal(row.status,'sent');
      await owner();await db.exec("update public.member_carts set items='[{\"id\":1,\"variantId\":\"11\",\"qty\":4}]',revision=3,updated_at=now()-interval '25 hours'");assert.equal(await claim(),null);
      await owner();await db.exec("update public.member_carts set items='[]',updated_at=now();update public.member_carts set items='[{\"id\":1,\"variantId\":\"11\",\"qty\":1}]',updated_at=now()-interval '25 hours'");
      assert.notEqual((await claim()).id,job.id);
    });
    await t.test('ambiguous retry freezes content, recipient, sender and provider key',async()=>{
      await reset();const job=await claim();const first=await prepare(job);assert.equal(await complete(job,'ambiguous'),true);
      await owner();await q("update public.cart_reminder_settings set content=$1",['Changed [購物車連結]']);
      await db.exec("update public.profiles set line_user_id='Ubbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';update public.cart_reminder_jobs set next_retry_at=now()-interval '1 minute'");
      const retry=await claim();const next=await prepare(retry);assert.notEqual(retry.lease_token,job.lease_token);
      assert.equal(next.key,first.key);assert.equal(next.target,first.target);assert.equal(next.payload.content,first.payload.content);assert.equal(next.from,first.from);
      assert.equal(await complete(job),false);assert.equal(await complete(retry),true);assert.equal(await claim(),null);
    });
    await t.test('definite LINE rejection falls back to verified Email with its own stable key',async()=>{
      await reset();const job=await claim();const first=await prepare(job);await complete(job,'line_rejected');
      const fallback=await claim();const email=await prepare(fallback);assert.equal(email.channel,'email');assert.equal(email.target,'member@example.test');assert.notEqual(email.key,first.key);
      await complete(fallback);assert.equal((await inspect(job.id)).targets,null);
    });
    await t.test('changed cart after ambiguous attempt cancels; expired provider retry window becomes unknown',async()=>{
      await reset();let job=await claim();await prepare(job);await complete(job,'ambiguous');
      await owner();await db.exec("update public.member_carts set revision=2,items='[{\"id\":1,\"variantId\":\"11\",\"qty\":3}]';update public.cart_reminder_jobs set next_retry_at=now()-interval '1 minute'");
      const retry=await claim();assert.equal(await prepare(retry),null);assert.equal((await inspect(job.id)).status,'cancelled');
      await reset();job=await claim();await prepare(job);await complete(job,'ambiguous');
      await owner();await db.exec("update public.cart_reminder_jobs set started_at=now()-interval '24 hours',next_retry_at=now()-interval '1 minute'");
      assert.equal(await claim(),null);const expired=await inspect(job.id);assert.equal(expired.status,'unknown');assert.equal(expired.targets,null);
    });
    await t.test('pure cart reads and repeat operations do not restart the 24h clock',async()=>{
      await reset();await owner();
      const before=(await q('select updated_at,revision,reminder_cycle from public.member_carts'))[0];
      await db.exec(`set role authenticated;set test.uid='${uid}'`);
      await result('select public.sync_my_cart($1) result',[uid]);
      await result('select public.sync_my_cart($1,$2,$3,$4::jsonb) result',[uid,'33333333-3333-4333-8333-333333333333','patch','[]']);
      await owner();const after=(await q('select updated_at,revision,reminder_cycle from public.member_carts'))[0];
      assert.deepEqual(after,before);
    });
    await t.test('online checkout starts a new cart round while historical and other-member orders do not suppress it',async()=>{
      await reset();await owner();
      await db.exec("update public.member_carts set updated_at=now()-interval '48 hours'");
      const original=(await q('select reminder_cycle from public.member_carts'))[0].reminder_cycle;
      await db.exec(`insert into public.orders(id,user_id,created_at) values('checked-out','${uid}',now()-interval '26 hours');
        update public.member_carts set items='[{"id":2,"variantId":"22","qty":1}]',revision=2,updated_at=now()-interval '25 hours';
        insert into public.orders(id,user_id) values('another-member','${second}');`);
      assert.notEqual((await q('select reminder_cycle from public.member_carts'))[0].reminder_cycle,original);
      assert(await claim());
    });
    await t.test('disabling after claim pauses before provider access; deleted profile cancels the pending delivery',async()=>{
      await reset();const job=await claim();await owner();await db.exec('update public.cart_reminder_settings set enabled=false');
      assert.equal(await prepare(job),null);assert.equal((await inspect(job.id)).attempts,0);
      await owner();await db.exec("update public.cart_reminder_settings set enabled=true;update public.cart_reminder_jobs set next_retry_at=now()-interval '1 minute'");
      const pending=await claim();await owner();await db.exec(`delete from public.profiles where id='${uid}'`);
      assert.equal(await prepare(pending),null);assert.equal((await inspect(job.id)).status,'cancelled');
      await owner();await db.exec(`insert into public.profiles values('${uid}','member@example.test','${line}')`);
    });
    await t.test('lost lease retries with same key; deleting the test member removes routing data',async()=>{
      await reset();const job=await claim();const first=await prepare(job);
      await owner();await db.exec("update public.cart_reminder_jobs set lease_until=now()-interval '1 minute'");
      const retry=await claim();const next=await prepare(retry);assert.equal(next.key,first.key);assert.equal(await complete(job),false);
      await owner();await db.exec(`delete from auth.users where id='${uid}'`);
      assert.equal((await q('select count(*)::int n from public.cart_reminder_jobs'))[0].n,0);
    });
  } finally {await db.close();}
});
