const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { runRewardCheckoutDatabaseScenario } = require('../fixtures/instructor-reward-checkout-db.cjs');

test('checkout request: atomic replay, owner/capability ACL, reservations, rollback and independent sessions', {
  skip: !process.env.PGLITE_MODULE && !process.env.EMBEDDED_POSTGRES_MODULE, timeout: 180000,
}, t => runRewardCheckoutDatabaseScenario(async c => {
  const { db, read, one, actor, teacher, student, status } = c;
  const migration = read('supabase-checkout-order-idempotency.sql');
  const original = (await one("select pg_get_functiondef('public.create_order_with_wallets(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint,bigint,jsonb)'::regprocedure) d")).d;
  await db.exec(migration); await db.exec(migration);
  assert.equal((await one("select pg_get_functiondef('public.create_order_with_wallets(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint,bigint,jsonb)'::regprocedure) d")).d, original);
  // Replenish through the real student purchase/ledger, not balance edits.
  await db.exec('update public.student_pricing_feature_settings set enabled=true');
  await actor(student);
  const incomeItems = [{ product_id: 1, variant_id: 1, qty: 99 }];
  const income = await c.ordinaryCreate(incomeItems, await c.ordinaryQuote(incomeItems));
  await actor(c.admin);
  await db.query('select public.confirm_admin_instructor_reward_payment($1,true)', [income.order_id]);
  await status(income.order_id, 'delivered');
  await db.exec('update public.student_pricing_feature_settings set enabled=false; update public.product_variants set gift_stock=100,gift_enabled=true where id=1');
  await actor(teacher);
  const items = [{ product_id: 1, variant_id: 1, qty: 10 }];
  const quote = async () => (await one("select public.quote_order_with_wallets($1::jsonb,'delivery','ONLY','',100,300) q", [JSON.stringify(items)])).q;
  await db.exec("update public.promotions set active=true where id in ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003')");
  const sql = `select public.create_order_with_wallets($1::jsonb,'測試會員','隔離地址','0912345678','r09@example.test','','card','delivery','ONLY','personal',null,null,100::bigint,300::bigint,$2::jsonb,$3::uuid,$4::text,$5::uuid) q`;
  const secret = 'a'.repeat(64);
  const args = (q, key, token = secret, owner = teacher) => [JSON.stringify(items), JSON.stringify(q), key, token, owner];
  const create = async (q, key, token = secret, owner = teacher) => (await one(sql, args(q, key, token, owner))).q;
  const recover = async (key, token = secret) => (await one('select public.recover_checkout_order($1::uuid,$2::text) q', [key, token])).q;
  const snapshot = () => one(`select
    (select count(*)::int from public.orders) orders,
    (select count(*)::int from public.order_payment_authorizations) authorizations,
    (select count(*)::int from public.coupon_redemptions) coupons,
    (select count(*)::int from public.promotion_gift_reservations) gifts,
    (select count(*)::int from public.instructor_reward_ledger) ledger,
    (select to_jsonb(a) from public.shopping_credit_accounts a where user_id=$1) shopping,
    (select to_jsonb(a) from public.instructor_reward_accounts a where user_id=$1) reward,
    (select stock from public.product_variants where id=1) stock`, [teacher]);

  let saved, key, q;
  await t.test('same key returns original result without reserving coupon/gift/wallets again', async () => {
    q = await quote(); key = randomUUID();
    const before = await snapshot();
    saved = await create(q, key);
    const committed = await snapshot();
    assert.equal(committed.orders, before.orders + 1);
    assert.equal(committed.authorizations, before.authorizations + 1);
    assert.equal(committed.coupons, before.coupons + 1);
    assert.ok(committed.gifts > before.gifts);
    assert.equal(Number(saved.shopping_credit_amount), 100);
    assert.equal(Number(saved.reward_credit_amount), 300);
    assert.deepEqual(await create(q, key), saved);
    assert.equal((await recover(key)).order_id, saved.order_id);
    assert.deepEqual(await snapshot(), committed);
  });
  await t.test('changed payload, another owner, wrong secret and identity switch cannot replay', async () => {
    await assert.rejects(create({ ...q, total: q.total + 1 }, key), e => e.code === '55000');
    await assert.rejects(create(q, key, 'b'.repeat(64)), e => e.code === '42501');
    await assert.rejects(recover(key, 'b'.repeat(64)), e => e.code === '42501');
    await actor(student);
    await assert.rejects(recover(key), e => e.code === '42501');
    await assert.rejects(create(q, randomUUID()), e => e.code === '42501');
    await actor(null);
    await assert.rejects(recover(key), e => e.code === '42501');
    await actor(teacher);
  });
  await t.test('private rows and helper are not callable by clients; valid owner can recover', async () => {
    await db.exec('set role authenticated');
    try {
      await assert.rejects(db.query('select * from public.checkout_order_requests'), e => e.code === '42501');
      await assert.rejects(db.query("select public.create_checkout_order_once($1,$2,$3,'{}')", [key, secret, teacher]), e => e.code === '42501');
      assert.equal((await recover(key)).order_id, saved.order_id);
    } finally { await db.exec('reset role'); }
  });
  await t.test('cancelled order remains the original request, never creates a replacement', async () => {
    await status(saved.order_id, 'cancelled');
    assert.equal((await recover(key)).recovered_order_state, 'cancelled');
    assert.equal((await create(q, key)).order_id, saved.order_id);
    await db.exec(migration);
    assert.equal((await recover(key)).order_id, saved.order_id);
  });
  await t.test('failed creator rolls back both request and reservations; same key can be corrected', async () => {
    const nextKey = randomUUID(), current = await quote(), before = await snapshot();
    await assert.rejects(create({ ...current, total: Number(current.total) + 1 }, nextKey), e => e.code === '40001');
    assert.equal(await recover(nextKey), null);
    assert.deepEqual(await snapshot(), before);
    const corrected = await create(current, nextKey);
    assert.equal((await recover(nextKey)).order_id, corrected.order_id);
    await status(corrected.order_id, 'cancelled');
  });
  await t.test('anonymous checkout requires its own secret and cannot become a member request', async () => {
    await actor(null);
    const guestKey = randomUUID(), guestQuote = await c.ordinaryQuote(items);
    const guestSql = `select public.create_order_with_pricing($1::jsonb,'訪客','隔離地址','0912345678','guest@example.test','','card','delivery','','personal',null,null,0::bigint,$2::jsonb,$3::uuid,$4::text,null::uuid) q`;
    const values = [JSON.stringify(items), JSON.stringify(guestQuote), guestKey, secret];
    await db.exec('set role anon');
    let guest;
    try {
      guest = (await one(guestSql, values)).q;
      assert.deepEqual((await one(guestSql, values)).q, guest);
      assert.equal((await recover(guestKey)).order_id, guest.order_id);
      await assert.rejects(recover(guestKey, 'c'.repeat(64)), e => e.code === '42501');
    } finally { await db.exec('reset role'); }
    await actor(teacher);
    await assert.rejects(recover(guestKey), e => e.code === '42501');
    await status(guest.order_id, 'cancelled');
  });
  await t.test('independent PostgreSQL sessions serialize duplicate creation and recovery before commit', { skip: !db.connect }, async () => {
    const left = await db.connect(), right = await db.connect();
    try {
      for (const client of [left, right]) await client.query("select set_config('test.uid',$1,false),set_config('test.access','admin',false)", [teacher]);
      const concurrentKey = randomUUID(), current = await quote(), before = await snapshot();
      const both = await Promise.all([left, right].map(client => client.query(sql, args(current, concurrentKey))));
      assert.equal(both[0].rows[0].q.order_id, both[1].rows[0].q.order_id);
      assert.equal((await snapshot()).orders, before.orders + 1);
      await status(both[0].rows[0].q.order_id, 'cancelled');
      const inFlightKey = randomUUID();
      await left.query('begin');
      const inFlight = (await left.query(sql, args(await quote(), inFlightKey))).rows[0].q;
      let resolved = false;
      const pending = right.query('select public.recover_checkout_order($1::uuid,$2::text) q', [inFlightKey, secret]).finally(() => { resolved = true; });
      const pid = (await left.query('select pg_backend_pid() pid')).rows[0].pid;
      for (let i = 0; i < 100; i++) {
        if ((await one('select count(*)::int n from pg_stat_activity where $1=any(pg_blocking_pids(pid))', [pid])).n) break;
        if (i === 99) throw new Error('Recovery did not wait for the uncommitted request');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(resolved, false);
      await left.query('commit');
      assert.equal((await pending).rows[0].q.order_id, inFlight.order_id);
      await status(inFlight.order_id, 'cancelled');
    } finally {
      await left.query('rollback');
      await left.end(); await right.end();
    }
  });
  for (const [name, value] of Object.entries(await one(read('supabase-checkout-order-idempotency-verify.sql')))) assert.equal(value, true, name);
}));
