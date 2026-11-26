const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

test('historical expiry recovery preserves orders/evidence, resets payment choice once and rejects unsafe restores', {skip:!process.env.PGLITE_MODULE},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);const db=new PGlite();
 const teacher=randomUUID(),student=randomUUID(),pro=randomUUID(),consumer=randomUUID(),admin=randomUUID(),binding=randomUUID();
 const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const scalar=async(sql,args=[])=>(await query(sql,args))[0].value;
 const member=id=>db.exec(`reset role;set test.member='${id}';set role authenticated`);
 const owner=()=>db.exec('reset role');const service=()=>db.exec('reset role;set role service_role');
 try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('test.member', true),'')::uuid $$;
      create table public.backoffice_role_permissions (
        role text, permission text check (permission in ('catalog.write')), primary key (role, permission)
      );
      create function public.has_backoffice_permission(text) returns boolean language sql stable as
        $$ select auth.uid() = '${admin}'::uuid and $1 in ('courses.manage','notifications.send') $$;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit int, allowed_mime_types text[]);
      create table storage.objects (bucket_id text, name text);
      create table public.profiles (id uuid primary key, name text, role text);
      create table public.instructor_student_bindings (id uuid primary key, student_id uuid, instructor_id uuid, ended_at timestamptz);
      insert into public.profiles values ('${teacher}','師資甲','instructor'), ('${student}','學生乙','pro'),
        ('${pro}','美容師丙','pro'), ('${consumer}','一般會員','consumer'), ('${admin}','管理員','staff');
      insert into public.instructor_student_bindings values ('${binding}','${student}','${teacher}',null);
    `);
    await db.exec('alter table public.profiles add column email text, add column line_user_id text');
    await query("update public.profiles set email = 'teacher@example.test', line_user_id = 'teacher-line' where id=$1", [teacher]);
    await query("update public.profiles set email = 'student@example.test' where id=$1", [student]);
    for (const file of ['supabase-courses-foundation.sql', 'supabase-course-listing-details.sql', 'supabase-course-description-images.sql', 'supabase-course-registration.sql', 'supabase-course-payments.sql',
      'supabase-course-notifications.sql', 'supabase-course-income.sql', 'supabase-course-publication-schedule.sql', 'supabase-course-image-jpeg-fallback.sql', 'supabase-course-slugs.sql', 'supabase-course-payment-resume.sql', 'supabase-course-payment-reminders.sql', 'supabase-course-enrollment-retention.sql', 'supabase-course-expiry-recovery.sql']) {
      await db.exec(readFileSync(resolve(__dirname, '../..', file), 'utf8'));
    }

 const fixture=async(method='card')=>{
  await owner();const c=randomUUID();
  await query("insert into courses(id,name,description,image_path,starts_at,ends_at,price_twd,published) values($1::uuid,'歷史逾期恢復','內容',$1::text||'.webp',now()+interval '20 days',now()+interval '20 days 2 hours',1200,true)",[c]);
  await member(pro);const o=await scalar("select create_course_registration($1,$2,true,'[]',1200) value",[c,randomUUID()]);
  await service();const a=await scalar('select claim_course_payment($1,$2,true,$3) value',[o.id,pro,method]);
  await query('select store_course_payment_link($1,$2,$3,null)',[a.provider_order_no,'https://bank.example.test/old','old-tx']);
  await owner();await query("update course_orders set payment_due_at=now()-interval '1 day' where id=$1",[o.id]);
  await query("update course_payment_attempts set link_expires_at=now()-interval '1 day' where order_id=$1",[o.id]);
  await query("update course_registrations set status='cancelled',cancelled_at=now()-interval '1 day',cancel_reason='付款期限已過' where order_id=$1",[o.id]);
  return {c,o,a,terminal:method==='card'?'1C250':'1M250'};
 };
 const restore=async(f,status=f.terminal,at=new Date().toISOString())=>{
  await service();return scalar("select recover_expired_course_enrollment($1,$2,$3,$4,'銀行確認原交易逾期未付款後恢復') value",[f.o.id,f.a.provider_order_no,status,at]);
 };
 // Both historical methods can reset to any of the four choices, only once.
 for(const old of ['card','apple'])for(const next of ['card','apple','google','atm']){
  const f=await fixture(old);await member(pro);
  await assert.rejects(query("select recover_expired_course_enrollment($1,$2,$3,now(),'test')",[f.o.id,f.a.provider_order_no,f.terminal]),{code:'42501'});
  let out=await restore(f);assert.equal(out.id,f.o.id);assert.equal(out.status,'pending');assert.equal(out.payment_method,null);
  assert.equal(out.registrations[0].id,f.o.registrations[0].id);assert.equal(out.registrations[0].status,'pending');
  await owner();assert.equal((await query('select payment_due_at=c.starts_at ok from course_orders o join courses c on c.id=o.course_id where o.id=$1',[f.o.id]))[0].ok,true);
  const audit=(await query('select * from course_expiry_recoveries where order_id=$1',[f.o.id]))[0];
  assert.equal(audit.previous_cancellations.cancel_reason,'付款期限已過');assert.ok(audit.previous_cancellations.cancelled_at);
  await member(pro);await assert.rejects(query('select * from course_expiry_recoveries'),{code:'42501'});
  await restore(f);await owner();assert.equal((await query('select count(*)::int n from course_expiry_recoveries where order_id=$1',[f.o.id]))[0].n,1);
  await service();const a=await scalar('select claim_course_payment($1,$2,true,$3) value',[f.o.id,pro,next]);
  assert.equal(a.attempt_no,2);assert.equal(a.payment_method,next);assert.notEqual(a.provider_order_no,f.a.provider_order_no);
  const race=await scalar('select claim_course_payment($1,$2,true,$3) value',[f.o.id,pro,'card']);assert.equal(race.create_attempt,false);assert.equal(race.provider_order_no,a.provider_order_no);
  await query('select store_course_payment_link($1,$2,$3,$4)',[a.provider_order_no,'https://bank.example.test/new','new-tx',next==='atm'?'12345678901234':null]);
  await restore(f);await member(pro);const mine=await scalar('select get_my_course_orders($1) value',[f.c]);assert.equal(mine.orders[0].payment_method,next);
  await service();const paid=await scalar('select confirm_course_payment($1,120000,$2) value',[a.provider_order_no,'new-tx']);assert.equal(paid.status,'paid');
  await query('select confirm_course_payment($1,120000,$2)',[a.provider_order_no,'new-tx']);
  await query('select confirm_course_payment($1,120000,$2)',[f.a.provider_order_no,'old-tx']);
  await owner();assert.equal((await query('select status from course_orders where id=$1',[f.o.id]))[0].status,'paid');
  assert.equal((await query("select count(*)::int n from course_manual_cases where order_id=$1 and kind='payment_exception'",[f.o.id]))[0].n,1);
 }
 for(const bad of [null,'1C200','1C400','1M250']){const f=await fixture();await assert.rejects(restore(f,bad),{code:'22023'});}
 const stale=await fixture();await assert.rejects(restore(stale,stale.terminal,new Date(Date.now()-600000).toISOString()),{code:'22023'});
 const manual=await fixture();await owner();await query("update course_registrations set cancel_reason='客人要求取消' where order_id=$1",[manual.o.id]);await assert.rejects(restore(manual),{code:'22023'});
 const duplicate=await fixture();await member(pro);await scalar("select create_course_registration($1,$2,true,'[]',1200) value",[duplicate.c,randomUUID()]);await assert.rejects(restore(duplicate),{code:'23505'});
 const alreadyPaid=await fixture();await owner();await query("update course_orders set status='paid',paid_at=now() where id=$1",[alreadyPaid.o.id]);await assert.rejects(restore(alreadyPaid),{code:'22023'});
 const futureStamp=await fixture();await assert.rejects(restore(futureStamp,futureStamp.terminal,new Date(Date.now()+600000).toISOString()),{code:'22023'});
 const wrongProvider=await fixture();await service();await assert.rejects(query("select recover_expired_course_enrollment($1,$2,'1C250',now(),'wrong provider')",[wrongProvider.o.id,'CRS'+'f'.repeat(32)]),{code:'22023'});
 const closed=await fixture();await owner();await query('update courses set published=false where id=$1',[closed.c]);await assert.rejects(restore(closed),{code:'22023'});
 const roleChanged=await fixture();await owner();await query("update profiles set role='consumer' where id=$1",[pro]);await assert.rejects(restore(roleChanged),{code:'22023'});await owner();await query("update profiles set role='pro' where id=$1",[pro]);
 const late=await fixture();await restore(late);await service();let result=await scalar('select confirm_course_payment($1,120000,$2) value',[late.a.provider_order_no,'old-tx']);assert.equal(result.status,'review');
 assert.equal(result.registrations[0].status,'pending');assert.equal((await scalar("select claim_course_payment($1,$2,true,'card') value",[late.o.id,pro])).eligible,false);
 console.log('Validated both old methods → all four choices, unchanged order/seat IDs, service-only audit, idempotency, concurrent claims, late callbacks and unsafe recovery rejection.');
 } finally {await db.close();}
});
