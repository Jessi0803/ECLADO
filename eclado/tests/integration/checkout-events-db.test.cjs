const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const crypto = require('node:crypto');

test('checkout diagnostics: real PostgreSQL permissions, transaction evidence, dedupe, limits and failure isolation', {
  skip: !process.env.PGLITE_MODULE, timeout: 90000,
}, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
  const db = new PGlite();
  const root = path.resolve(__dirname, '../..');
  const migration = fs.readFileSync(path.join(root, 'supabase-checkout-events.sql'), 'utf8');
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const flow = crypto.randomUUID(), attempt = crypto.randomUUID();
  const batch = [{ event_id: crypto.randomUUID(), flow_id: flow, attempt_id: attempt,
    event_name: 'submit_started', occurred_at: new Date().toISOString() }];
  const ingest = () => one('select public.ingest_checkout_browser_events($1,$2::jsonb) ok', ['a'.repeat(64), JSON.stringify(batch)]);
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; grant usage on schema public,auth to anon,authenticated,service_role;
      create function auth.role() returns text language sql as $$select current_setting('test.jwt_role',true)$$;
      create function public.is_eclado_admin() returns boolean language sql as $$select coalesce(current_setting('test.admin',true),'false')='true'$$;
      create table public.orders(id text primary key);
      create table public.order_payment_authorizations(order_id text primary key,gateway_created_at timestamptz);`);
    const rateSql = fs.readFileSync(path.join(root, 'supabase-security-hardening-20260827.sql'), 'utf8');
    await db.exec(rateSql.slice(rateSql.indexOf('create table if not exists public.api_rate_limits'), rateSql.indexOf('create or replace function public.enforce_order_creation_rate_limit')));
    await db.exec(migration);
    await db.exec(migration); // Safe reapplication.
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from public.checkout_events'), /permission denied/);
    await assert.rejects(ingest(), /permission denied/);
    await db.exec('reset role; set role authenticated');
    await assert.rejects(db.query("insert into public.checkout_events(flow_id) values(null)"), /permission denied/);
    await assert.rejects(ingest(), /permission denied/);
    await db.exec('reset role');

    await db.query("select set_config('request.headers',$1,false)", [JSON.stringify({ 'x-client-info': `eclado-checkout/v1;flow=${flow};attempt=${attempt}` })]);
    await db.exec(`insert into public.orders values('ECL-LOCAL-1'); insert into public.order_payment_authorizations values('ECL-LOCAL-1',null);
      update public.order_payment_authorizations set gateway_created_at=now();
      update public.order_payment_authorizations set gateway_created_at=gateway_created_at;`);
    assert.equal((await one("select count(*)::int n from public.checkout_events where source='database'")).n, 2);
    await db.exec('begin');
    await db.exec("insert into public.orders values('ECL-ROLLED-BACK')");
    await db.exec('rollback');
    assert.equal((await one("select count(*)::int n from public.checkout_events where order_id='ECL-ROLLED-BACK'")).n, 0);
    await db.exec('set role authenticated');
    assert.equal((await one('select count(*)::int n from public.checkout_events')).n, 0);
    await db.exec("select set_config('test.admin','true',false)");
    assert.equal((await one('select count(*)::int n from public.checkout_events')).n, 2);
    await db.exec("reset role; select set_config('test.jwt_role','service_role',false); set role service_role");
    assert.equal((await ingest()).ok, true); assert.equal((await ingest()).ok, true);
    assert.equal((await one("select count(*)::int n from public.checkout_events where source='browser'")).n, 1);
    for (let i = 2; i < 60; i++) assert.equal((await ingest()).ok, true);
    assert.equal((await ingest()).ok, false);
    await db.exec('reset role');
    await db.query("insert into public.checkout_events(flow_id,attempt_id,source,event_name,occurred_at,received_at) values($1,$2,'browser','submit_started',now()-interval '31 days',now()-interval '31 days')", [flow, attempt]);
    await db.query("select public.ingest_checkout_browser_events($1,$2::jsonb)", ['b'.repeat(64), JSON.stringify(batch)]);
    assert.equal((await one("select count(*)::int n from public.checkout_events where received_at<now()-interval '30 days'")).n, 0);
    // Malformed header or absent diagnostic table must never roll back an order.
    await db.exec("select set_config('request.headers','invalid json',false); insert into public.orders values('ECL-BAD-HEADER')");
    await db.query("select set_config('request.headers',$1,false)", [JSON.stringify({ 'x-client-info': `eclado-checkout/v1;flow=${flow};attempt=${attempt}` })]);
    await db.exec(`alter table public.checkout_events rename to temporarily_unavailable;
      insert into public.orders values('ECL-DIAGNOSTICS-DOWN');
      alter table public.temporarily_unavailable rename to checkout_events;`);
    assert.equal((await one("select count(*)::int n from public.orders where id in ('ECL-BAD-HEADER','ECL-DIAGNOSTICS-DOWN')")).n, 2);
  } finally { await db.close(); }
});
