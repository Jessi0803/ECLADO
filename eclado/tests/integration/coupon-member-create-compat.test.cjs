const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { runStudentPricingDatabaseScenario } = require('./student-pricing-db.test.cjs');

test('member-targeted coupon quote and create use the same identity rule', {
  skip: !process.env.EMBEDDED_POSTGRES_MODULE,
  timeout: 120000,
}, () => runStudentPricingDatabaseScenario(async context => {
  const { db, read, ordinaryQuote, one, actor, student } = context;
  const metadata = JSON.parse(fs.readFileSync(
    'docs/evidence/reward-stage7a/production-metadata.json',
    'utf8',
  ));
  const productionCreator = metadata.functions.find(
    entry => entry.name === 'create_order_with_pricing_discount_v2',
  ).definition;

  assert.match(productionCreator, /any\(target\.audience_roles\)/);
  await db.exec(productionCreator);
  await db.exec(read('supabase-student-reward-snapshots.sql'));

  await actor(student);
  await db.exec(`
    update public.coupon_campaigns
    set active = true, per_member_limit = null, total_usage_limit = null
    where code_normalized = 'ONLY';
    update public.promotions
    set active = true
    where id in (
      select promotion_id from public.coupon_promotions
      where coupon_campaign_id = '20000000-0000-4000-8000-000000000001'
    );
  `);

  const items = [{ product_id: 1, variant_id: 1, qty: 10 }];
  const quoteBeforePatch = await ordinaryQuote(items, 'ONLY');
  await assert.rejects(
    db.query(`select public.create_order_with_pricing(
      $1::jsonb, '隔離學生', '隔離地址', '0900000000', 'student@example.test',
      '', 'atm', 'delivery', 'ONLY', 'personal', null, null, 0::bigint, $2::jsonb
    )`, [JSON.stringify(items), JSON.stringify(quoteBeforePatch)]),
    error => error.code === '22023',
  );

  const ownerBefore = await one(`select proowner::text owner, coalesce(proacl::text, '') acl
    from pg_proc where oid =
    'public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)'::regprocedure`);
  await db.exec(read('supabase-coupon-member-create-compat.sql'));
  await db.exec(read('supabase-coupon-member-create-compat-verify.sql'));
  const ownerAfter = await one(`select proowner::text owner, coalesce(proacl::text, '') acl
    from pg_proc where oid =
    'public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)'::regprocedure`);
  assert.deepEqual(ownerAfter, ownerBefore);

  const selectedQuote = await ordinaryQuote(items, 'ONLY');
  const created = (await db.query(`select public.create_order_with_pricing(
    $1::jsonb, '隔離學生', '隔離地址', '0900000000', 'student@example.test',
    '', 'atm', 'delivery', 'ONLY', 'personal', null, null, 0::bigint, $2::jsonb
  ) as result`, [JSON.stringify(items), JSON.stringify(selectedQuote)])).rows[0].result;
  assert.ok(created.order_id);
  assert.equal((await one('select count(*)::int n from public.orders where id = $1', [created.order_id])).n, 1);
  assert.equal((await one(`select count(*)::int n from public.coupon_redemptions
    where order_id = $1 and status = 'reserved'`, [created.order_id])).n, 1);

  await actor('11111111-1111-4111-8111-111111111111');
  await assert.rejects(ordinaryQuote(items, 'ONLY'), /優惠碼/);

  await db.exec(read('supabase-coupon-member-create-compat.sql'));
  await db.exec(read('supabase-coupon-member-create-compat-verify.sql'));
}));
