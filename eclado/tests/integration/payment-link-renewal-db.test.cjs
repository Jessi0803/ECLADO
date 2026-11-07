const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const read = name => fs.readFileSync(path.resolve(__dirname, '../..', name), 'utf8');
function functionDefinition(file, name) {
  const sql = read(file);
  const start = sql.indexOf('create or replace function public.' + name + '(');
  assert.ok(start >= 0);
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('as $$', start)) + 3);
}

test('verified renewal is atomic, private and preserves inventory and wallet reservations', {
  skip: !process.env.PGLITE_MODULE,
}, async () => {
  const moduleUrl = pathToFileURL(process.env.PGLITE_MODULE);
  const { PGlite } = await import(moduleUrl);
  const { pgcrypto } = await import(new URL('./contrib/pgcrypto.js', moduleUrl));
  const db = new PGlite({extensions:{pgcrypto}});
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema extensions; create extension pgcrypto with schema extensions;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$select null::uuid$$;
      create table auth.users(id uuid primary key);
      create table public.profiles(id uuid primary key, role text);
      create table public.orders(id text primary key, user_id uuid, status text, total numeric,
        payment_amount numeric, shopping_credit_amount bigint, reward_credit_amount bigint,
        order_source text, items jsonb, note text, payment_due_at timestamptz);
      create table public.order_payment_authorizations(order_id text primary key, token_hash text,
        provider_order_no text, attempt_no integer, claimed_at timestamptz, gateway_created_at timestamptz);
      create table public.order_payment_instructions(order_id text primary key, payment_state text,
        payment_method text, provider_order_no text, attempt_no integer, payment_url text,
        provider_status text, provider_description text, provider_transaction_no text,
        gateway_created_at timestamptz, updated_at timestamptz);
      create table public.order_payment_attempts(order_id text, provider_order_no text unique,
        attempt_no integer, payment_method text, payment_state text, updated_at timestamptz);
      create table public.instructor_reward_reservations(order_id text primary key,user_id uuid,amount bigint,
        cycle integer,status text,provider_order_no text,updated_at timestamptz);
      create table public.instructor_reward_accounts(user_id uuid primary key,balance bigint,reserved_balance bigint,
        pending_balance bigint,status text,version integer,updated_at timestamptz);
      create table public.instructor_reward_payment_receipts(order_id text,amount bigint);
      create table public.instructor_reward_ledger(instructor_id uuid,order_id text,event_type text,amount bigint,
        balance_delta bigint,pending_delta bigint,balance_after bigint,pending_after bigint,actor_user_id uuid,
        reservation_cycle integer,reserved_delta bigint,reserved_after bigint,reason_code text);
      create table public.inventory(product_id integer, stock integer, reserved integer);
      create table public.shopping_credit_reservations(order_id text,amount bigint,status text);
      insert into auth.users values('11111111-1111-4111-8111-111111111111');
      insert into public.orders values('ECL-DB','11111111-1111-4111-8111-111111111111','unpaid',
        1000,800,100,100,'online','[{"name":"完整商品資訊","qty":1}]','完整訂單備註',now()+interval '48 hours');
      insert into public.order_payment_authorizations values('ECL-DB','old-token','ECL-DB',1,now(),null);
      insert into public.order_payment_instructions(order_id,payment_state,payment_method,provider_order_no,attempt_no)
        values('ECL-DB','pending','apple','ECL-DB',1);
      insert into public.inventory values(1,9,1);
      insert into public.shopping_credit_reservations values('ECL-DB',100,'reserved');
      insert into public.instructor_reward_reservations values('ECL-DB','11111111-1111-4111-8111-111111111111',100,1,'reserved','ECL-DB',now());
      insert into public.instructor_reward_accounts values('11111111-1111-4111-8111-111111111111',900,100,0,'active',1,now());
    `);
    await db.exec(functionDefinition('supabase-instructor-reward-checkout.sql', 'reward_credit_event'));
    const existingRetry = functionDefinition('supabase-payment-retry.sql', 'begin_order_payment_retry')
      .replace('  next_attempt := greatest', "  perform public.reward_credit_event(p_order_id,'reserve');\n  next_attempt := greatest");
    await db.exec(existingRetry);
    const oldDefinition = await one("select pg_get_functiondef('public.begin_order_payment_retry(text)'::regprocedure) as body");
    await db.exec(read('supabase-payment-link-renewal.sql'));
    await db.exec(read('supabase-payment-link-renewal.sql'));
    assert.deepEqual(await one("select pg_get_functiondef('public.begin_order_payment_retry(text)'::regprocedure) as body"), oldDefinition);
    const snapshots = async () => one(`select
      (select to_jsonb(o) from public.orders o where id='ECL-DB') as order_data,
      (select jsonb_agg(i) from public.inventory i) as inventory,
      (select jsonb_agg(c) from public.shopping_credit_reservations c) as shopping_credit,
      (select jsonb_agg(a) from public.instructor_reward_accounts a) as reward_account,
      (select jsonb_agg(r) from public.instructor_reward_reservations r) as reward_reservation,
      (select count(*) from public.instructor_reward_ledger) as reward_ledger_count`);
    const before = await snapshots();
    for (const role of ['anon','authenticated']) {
      await db.exec('set role ' + role);
      await assert.rejects(db.query("select public.begin_verified_order_payment_retry('ECL-DB','ECL-DB','1M250')"),
        error => error.code === '42501');
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    for (const status of ['1M200','1M400','1C250',null]) {
      await assert.rejects(db.query("select public.begin_verified_order_payment_retry('ECL-DB','ECL-DB',$1)", [status]));
    }
    const results = await Promise.allSettled([
      db.query("select public.begin_verified_order_payment_retry('ECL-DB','ECL-DB','1M250') as result"),
      db.query("select public.begin_verified_order_payment_retry('ECL-DB','ECL-DB','1M250') as result"),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const retry = results.find(result => result.status === 'fulfilled').value.rows[0].result;
    assert.equal(retry.order_id, 'ECL-DB');
    assert.equal(retry.attempt_no, 2);
    await db.exec('reset role');
    assert.deepEqual(await snapshots(), before);
    const instruction = await one("select * from public.order_payment_instructions where order_id='ECL-DB'");
    assert.equal(instruction.payment_state, 'initiated');
    assert.equal(instruction.provider_order_no, retry.provider_order_no);
    assert.equal(instruction.payment_url, null);
    assert.equal((await one("select count(*) as count from public.order_payment_attempts")).count, 1);
    await db.exec(`
      insert into public.orders select 'ECL-ABSENT',user_id,status,1000,900,100,0,order_source,items,note,payment_due_at
        from public.orders where id='ECL-DB';
      insert into public.order_payment_authorizations values('ECL-ABSENT','old-token','ECL-ABSENT',1,now(),null);
      insert into public.order_payment_instructions(order_id,payment_state,payment_method,provider_order_no,attempt_no,provider_status)
        values('ECL-ABSENT','failed','card','ECL-ABSENT',1,'F');
      set role service_role;
    `);
    await assert.rejects(db.query("select public.begin_verified_order_payment_retry('ECL-ABSENT','ECL-ABSENT','NOT_CREATED')"));
    await db.exec("reset role; update public.order_payment_authorizations set claimed_at=null where order_id='ECL-ABSENT'; update public.order_payment_instructions set provider_status=null where order_id='ECL-ABSENT'; set role service_role");
    await assert.rejects(db.query("select public.begin_verified_order_payment_retry('ECL-ABSENT','ECL-ABSENT','NOT_CREATED')"));
    await db.exec("reset role; update public.order_payment_instructions set provider_status='F' where order_id='ECL-ABSENT'; set role service_role");
    const absentRetry = (await one("select public.begin_verified_order_payment_retry('ECL-ABSENT','ECL-ABSENT','NOT_CREATED') as result")).result;
    assert.equal(absentRetry.attempt_no, 2);
    await db.exec('reset role');
    assert.deepEqual(await snapshots(), before);
    await db.exec("update public.orders set payment_due_at=now()-interval '1 second'; set role service_role");
    await assert.rejects(db.query("select public.begin_verified_order_payment_retry('ECL-DB',$1,'1M250')", [retry.provider_order_no]), /expired/);
    await db.exec('reset role');
    assert.equal((await one("select attempt_no from public.order_payment_authorizations where order_id='ECL-DB'")).attempt_no, 2);
  } finally {
    await db.close();
  }
});
