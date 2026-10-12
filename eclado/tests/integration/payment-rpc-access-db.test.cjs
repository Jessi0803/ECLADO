const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function body(file, name) {
  const source = read(file);
  const start = source.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('$$;', source.indexOf('as $$', start)) + 3);
}

test('payment RPC ACL repair blocks real client calls and preserves service payment behavior', {
  skip: !process.env.PGLITE_MODULE,
}, async () => {
  const moduleUrl = pathToFileURL(process.env.PGLITE_MODULE);
  const { PGlite } = await import(moduleUrl);
  const { pgcrypto } = await import(new URL('./contrib/pgcrypto.js', moduleUrl));
  const db = new PGlite({ extensions: { pgcrypto } });
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const state = () => one(`select
    (select jsonb_agg(to_jsonb(a) order by order_id) from public.order_payment_authorizations a) as authorizations,
    (select jsonb_agg(to_jsonb(a) order by order_id,attempt_no) from public.order_payment_attempts a) as attempts`);
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema extensions; create extension pgcrypto with schema extensions;
      create table public.orders(id text primary key,user_id uuid,status text,total numeric,
        payment_amount numeric,shopping_credit_amount bigint,items jsonb,payment_due_at timestamptz);
      create table public.order_payment_authorizations(order_id text primary key,token_hash text,
        provider_order_no text,attempt_no integer,claimed_at timestamptz,gateway_created_at timestamptz);
      create table public.order_payment_instructions(order_id text primary key,payment_state text,
        payment_method text,provider_order_no text,attempt_no integer);
      create table public.order_payment_attempts(order_id text,provider_order_no text unique,
        attempt_no integer,payment_method text,payment_state text);
      insert into public.orders values
        ('ECL-RETRY',null,'unpaid',1000,900,100,'[]',now()+interval '1 day');
      insert into public.order_payment_authorizations values
        ('ECL-RETRY',encode(extensions.digest('old-token','sha256'),'hex'),'ECL-RETRY',1,null,null);
      insert into public.order_payment_instructions values ('ECL-RETRY','failed','card','ECL-RETRY',1);
    `);
    await db.exec(body('supabase-payment-retry.sql', 'begin_order_payment_retry'));
    await db.exec(body('supabase-shopping-credit-checkout.sql', 'claim_order_payment'));
    // Reproduce the observed production drift, including explicit grants that
    // REVOKE FROM PUBLIC alone cannot remove.
    await db.exec(`grant execute on function public.begin_order_payment_retry(text) to anon,authenticated;
      grant execute on function public.claim_order_payment(text,text) to anon,authenticated;
      set role anon;`);
    const reproduced = await one("select public.begin_order_payment_retry('ECL-RETRY') as result");
    assert.ok(reproduced.result.payment_token);
    assert.equal(reproduced.result.attempt_no, 2);
    await db.exec('reset role');

    const definitionBefore = await one(`select
      pg_get_functiondef('public.begin_order_payment_retry(text)'::regprocedure) as retry,
      pg_get_functiondef('public.claim_order_payment(text,text)'::regprocedure) as claim`);
    const migration = read('supabase-payment-rpc-access-hardening.sql');
    await db.exec(migration);
    await db.exec(migration); // Safe to reapply.
    assert.deepEqual(await one(`select
      pg_get_functiondef('public.begin_order_payment_retry(text)'::regprocedure) as retry,
      pg_get_functiondef('public.claim_order_payment(text,text)'::regprocedure) as claim`), definitionBefore);
    const verified = await db.exec(read('supabase-payment-rpc-access-hardening-verify.sql'));
    for (const row of verified[1].rows) {
      assert.equal(row.anon_denied, true);
      assert.equal(row.authenticated_denied, true);
      assert.equal(row.service_role_allowed, true);
    }
    const before = await state();
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      for (const id of ['ECL-RETRY', ' ECL-RETRY ', 'missing-order']) {
        await assert.rejects(db.query('select public.begin_order_payment_retry($1)', [id]),
          error => error.code === '42501');
      }
      await assert.rejects(db.query('select public.claim_order_payment($1,$2)',
        ['ECL-RETRY', reproduced.result.payment_token]), error => error.code === '42501');
      await db.exec('reset role');
    }
    assert.deepEqual(await state(), before);

    // Preserve guest/member retries for every supported retry payment method.
    for (const [i, method] of ['card', 'apple', 'google'].entries()) {
      const id = `ECL-SERVICE-${method}`;
      await db.query(`insert into public.orders values ($1,$2,'unpaid',1000,900,100,'[]',now()+interval '1 day')`,
        [id, i === 0 ? null : '22222222-2222-4222-8222-222222222222']);
      await db.query(`insert into public.order_payment_authorizations values
        ($1,encode(extensions.digest('old-token','sha256'),'hex'),$1,1,null,null)`, [id]);
      await db.query(`insert into public.order_payment_instructions values ($1,'failed',$2,$1,1)`, [id, method]);
      await db.exec('set role service_role');
      const retry = (await one('select public.begin_order_payment_retry($1) as result', [id])).result;
      assert.equal(retry.order_id, id);
      assert.equal(retry.attempt_no, 2);
      await assert.rejects(db.query('select public.claim_order_payment($1,$2)', [id, 'old-token']),
        error => error.code === '42501');
      const claim = (await one('select public.claim_order_payment($1,$2) as result', [id, retry.payment_token])).result;
      assert.equal(claim.total, 900);
      assert.equal(claim.order_total, 1000);
      assert.equal(claim.shopping_credit_amount, 100);
      await assert.rejects(db.query('select public.claim_order_payment($1,$2)', [id, retry.payment_token]),
        error => error.code === '55P03');
      await db.exec('reset role');
    }
  } finally {
    await db.close();
  }
});
