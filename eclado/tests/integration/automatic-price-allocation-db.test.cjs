const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runStudentPricingDatabaseScenario } = require('./student-pricing-db.test.cjs');
const { solveAutomaticPromotions } = require('../helpers/automatic-promotion-oracle.cjs');

test('automatic price allocation: installed pricing, exact differential reference, persistence and rollback', {
  skip: !process.env.PGLITE_MODULE && !process.env.EMBEDDED_POSTGRES_MODULE, timeout: 180000,
}, () => runStudentPricingDatabaseScenario(async ({ db, read, fn, one, actor, student, ordinaryQuote, ordinaryCreate, base, create }) => {
  const admin = '11111111-1111-4111-8111-111111111111';
  await actor(admin);
  await db.exec('alter table public.promotions add column description text; update public.promotions set active=false; update public.product_variants set stock=10000');
  await db.exec(fn('supabase-promotion-gifts-engine.sql', 'save_discount_promotion'));
  await db.exec(read('supabase-automatic-promotion-audience.sql'));
  await db.exec(read('supabase-buy-x-get-y.sql'));
  // Actual cloud installations retain this SQL-language compatibility overload.
  await db.exec(`create or replace function public.create_order_with_pricing(p_items jsonb,p_member text,p_address text,p_phone text,p_email text,p_note text,p_payment_method text,p_fulfillment_method text)
    returns jsonb language sql security definer set search_path=public,auth,extensions as $$select public.create_order_with_pricing(p_items,p_member,p_address,p_phone,p_email,p_note,p_payment_method,p_fulfillment_method,null);$$`);
  const save = async (config) => (await one('select public.save_discount_promotion($1::jsonb) id', [JSON.stringify({ activation_type: 'automatic', scope_type: 'products', product_ids: [1], ...config })])).id;
  const fixed = await save({ name: 'A折100', benefit_type: 'fixed_discount', discount_amount: 100 });
  await db.exec("update public.profiles set role='consumer' where id='" + student + "'; insert into public.products(id,name_zh,stock) values(3,'B商品',10000); insert into public.product_variants(id,product_id,sku,size,stock,is_default,price,pro_price) values(3,3,'C','100ml',10000,true,1000,1000)");
  const other = await save({ name: 'B折200', benefit_type: 'fixed_discount', discount_amount: 200, product_ids: [3] });
  const items = [{ product_id: 1, variant_id: 1, qty: 1 }, { product_id: 3, variant_id: 3, qty: 1 }];
  await actor(student);
  assert.equal((await ordinaryQuote(items)).discount, 200);
  const signatures = ['public.quote_order_pricing_discount_v2(jsonb,text,text,text)', 'public.assisted_discount_quote(jsonb,text,text,text,uuid,boolean)'];
  const acls = async () => (await db.query('select oid::regprocedure::text signature,proowner,proacl::text acl from pg_proc where oid=any($1::regprocedure[]) order by 1', [signatures])).rows;
  const before = await acls();
  const definition = (await one("select pg_get_functiondef('public.quote_order_pricing_discount_v2(jsonb,text,text,text)'::regprocedure) f")).f;
  await db.exec(definition.replace('  -- Compare every atomic automatic discount', '  -- Unknown installed automatic discount'));
  await assert.rejects(db.exec(read('supabase-automatic-price-allocation.sql')), /Unknown automatic selection block/);
  await db.exec('rollback');
  assert.equal((await one("select to_regclass('public.automatic_price_allocation_settings') t")).t, null);
  await db.exec(definition);
  await db.exec(read('supabase-automatic-price-allocation.sql'));
  await db.exec(read('supabase-automatic-price-allocation.sql'));
  for (const [name, value] of Object.entries(await one(read('supabase-automatic-price-allocation-verify.sql')))) assert.equal(value, true, name);
  assert.deepEqual(await acls(), before);
  assert.equal((await ordinaryQuote(items)).discount, 200, 'Install must remain OFF');
  await db.exec('update public.automatic_price_allocation_settings set enabled=true');
  let quote = await ordinaryQuote(items);
  assert.equal(quote.discount, 300);
  assert.equal(quote.promotion_id, null);
  assert.equal(quote.adjustments.length, 2);
  assert.equal(quote.pricing_snapshot.automatic_allocation_version, 1);
  await assert.rejects(db.query("select public.create_order_with_pricing($1::jsonb,'會員','地址','0911111111','customer@example.test','','atm','delivery','','personal',null,null,0::bigint)", [JSON.stringify(items)]), /重新取得報價/);
  await assert.rejects(db.query("select public.create_order_with_pricing($1::jsonb,'會員','地址','0911111111','customer@example.test','','atm','delivery')", [JSON.stringify(items)]), /重新取得報價/);
  const created = await ordinaryCreate(items, quote);
  assert.equal((await one('select count(*)::integer n from public.order_adjustments where order_id=$1', [created.order_id])).n, 2);
  assert.equal((await one('select pricing_snapshot from public.orders where id=$1', [created.order_id])).pricing_snapshot.automatic_allocations.length, 2);
  const originalSnapshot = (await one('select pricing_snapshot from public.orders where id=$1', [created.order_id])).pricing_snapshot;
  const stale = JSON.parse(JSON.stringify(quote));
  stale.pricing_snapshot.automatic_allocations[0].name = '舊活動名稱';
  const countBeforeStale = (await one('select count(*)::int n from public.orders')).n;
  await assert.rejects(ordinaryCreate(items, stale), /已變動/);
  assert.equal((await one('select count(*)::int n from public.orders')).n, countBeforeStale);
  const reversed = await ordinaryQuote([...items].reverse());
  assert.deepEqual(reversed.pricing_snapshot.automatic_allocations, quote.pricing_snapshot.automatic_allocations);

  // Independent exhaustive unit oracle versus compressed SQL quantities.
  const evaluate = async (units, activities) => {
    const lines = units.map((u) => ({ product_id: Number(u.productId), variant_id: Number(u.id), qty: 1, unit_price: u.price, line_total: u.price }));
    const candidates = activities.map((a) => ({ id: a.id, name: a.id, benefit_type: a.type, discount_amount: a.amount || 0, discount_rate: a.rate,
      buy_quantity: a.buy, gift_quantity: a.get, repeat_mode: a.repeat ? 'repeat' : 'once', discount_order: a.order,
      threshold_type: a.minQuantity ? 'quantity' : 'amount', threshold_value: a.minQuantity || a.minAmount || null,
      q: units.map((u) => !a.qualificationIds || a.qualificationIds.includes(u.productId)),
      b: units.map((u) => !a.benefitIds || a.benefitIds.includes(u.productId)),
      e: units.map((u) => a.type === 'buy_x_get_y'
        ? (!a.qualificationIds || a.qualificationIds.includes(u.productId)) && (!a.benefitIds || a.benefitIds.includes(u.productId))
        : (!a.qualificationIds || a.qualificationIds.includes(u.productId)) || (!a.benefitIds || a.benefitIds.includes(u.productId))),
    }));
    const reference = solveAutomaticPromotions({ units, activities });
    const sql = (await one('select public.solve_automatic_price_component($1::jsonb,$2::jsonb) result', [JSON.stringify(lines), JSON.stringify(candidates)])).result;
    assert.equal(Number(sql.discount), reference.discount, JSON.stringify({ units, activities }));
    assert.deepEqual(sql.adjustments.map((a) => ({ id: a.promotion_id, amount: Number(a.amount) })), reference.allocations.map((a) => ({ id: a.activityId, amount: a.discount })));
    for (const line of sql.lines) assert.ok(Number(line.remaining_total) >= 0);
    assert.ok(Math.abs(sql.lines.reduce((n, l) => n + Number(l.remaining_total), 0) + Number(sql.discount) - units.reduce((n, u) => n + u.price, 0)) < 1e-6);
  };
  for (let seed = 1; seed <= 35; seed++) {
    const units = Array.from({ length: 4 }, (_, i) => ({ id: String(i + 1), productId: String(i % 2 + 1), price: ((seed * (i + 3)) % 23) + 1 }));
    await evaluate(units, [
      { id: 'a', type: 'fixed_discount', amount: seed % 25, minQuantity: seed % 3, qualificationIds: ['1', '2'], benefitIds: ['1', '2'] },
      { id: 'b', type: 'percentage_discount', rate: '0.8', qualificationIds: ['1'], benefitIds: ['1'] },
      { id: 'c', type: 'buy_x_get_y', buy: 1, get: 1, repeat: seed % 2 === 0 },
    ]);
  }
  for (let seed = 1; seed <= 70; seed++) {
    const units = Array.from({ length: 4 }, (_, i) => ({ id: String(i + 1), productId: String(i % 2 + 1), price: (seed * (i + 7)) % 31 }));
    await evaluate(units, [
      { id: 'a', type: 'legacy_discount', amount: seed % 17, rate: ['0', '0.5', '0.67', '0.9', '1'][seed % 5], order: seed % 2 ? 'amount_then_rate' : 'rate_then_amount', benefitIds: ['1', '2'] },
      { id: 'b', type: 'buy_x_get_y', buy: 2, get: 1, repeat: seed % 2 === 0 },
      { id: 'c', type: 'fixed_discount', amount: seed % 11, qualificationIds: ['1'], benefitIds: ['2'], minAmount: seed % 5 },
    ]);
  }
  await evaluate([100, 200, 3000, 3000, 3000, 3000, 3000, 3000].map((price, i) => ({ id: String(i + 1), productId: '1', price })), [{ id: 'a', type: 'buy_x_get_y', buy: 3, get: 1, repeat: true }]);
  await evaluate([1, 1, 1].map((price, i) => ({ id: String(i + 1), productId: '1', price })), [
    { id: 'a', type: 'buy_x_get_y', buy: 2, get: 1, repeat: true }, { id: 'b', type: 'percentage_discount', rate: '0.8' },
  ]);
  await evaluate(Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1).padStart(2, '0'), productId: '1', price: 5 })), [
    { id: 'a', type: 'percentage_discount', rate: '0.9' }, { id: 'b', type: 'percentage_discount', rate: '0.9' },
  ]);
  const pressureLines = Array.from({ length: 20 }, (_, i) => ({ product_id: 1, variant_id: i + 1, qty: 1, unit_price: 1000, line_total: 1000 }));
  const pressureActivities = [0.9, 0.8].map((rate, i) => ({ id: String(i), name: String(i), benefit_type: 'percentage_discount', discount_rate: rate,
    threshold_type: 'amount', q: pressureLines.map(() => true), b: pressureLines.map(() => true), e: pressureLines.map(() => true) }));
  const pressureStart = performance.now();
  const pressure = (await one('select public.solve_automatic_price_component($1::jsonb,$2::jsonb) q', [JSON.stringify(pressureLines), JSON.stringify(pressureActivities)])).q;
  assert.equal(pressure.discount, 4000);
  assert.ok(pressure.search_nodes < 1000);
  console.log(`allocation benchmark: 20 overlapping variants nodes=${pressure.search_nodes} ms=${Math.round(performance.now() - pressureStart)}`);
  await actor(admin);
  const coupon = '30000000-0000-4000-8000-000000000099';
  const couponPct = await save({ name: '券九折', benefit_type: 'percentage_discount', discount_rate: 0.9, scope_type: 'all_regular', activation_type: 'coupon_only' });
  await db.query("insert into public.coupon_campaigns(id,name,code,code_normalized,stacking_policy,audience_mode,audience_roles,allow_guest) values($1,'多活動券','MULTI','MULTI','allow_all','roles',array['consumer'],true)", [coupon]);
  await db.query('insert into public.coupon_promotions(coupon_campaign_id,promotion_id,sort_order) values($1,$2,0)', [coupon, couponPct]);
  await actor(student);
  assert.equal((await ordinaryQuote(items, 'MULTI')).discount, 470, '300 automatic + 10% of 1700 remaining');
  for (const mode of ['coupon_only', 'allow_auto_gifts']) {
    await db.query('update public.coupon_campaigns set stacking_policy=$1 where id=$2', [mode, coupon]);
    const suppressed = await ordinaryQuote(items, 'MULTI');
    assert.equal(suppressed.discount, 200);
    assert.deepEqual(suppressed.pricing_snapshot.automatic_allocations, []);
  }
  await actor(admin);
  const bogo = await save({ name: '買3送1', benefit_type: 'buy_x_get_y', buy_quantity: 3, gift_quantity: 1, repeat_mode: 'repeat' });
  await db.query('update public.promotions set active=false where id=any($1::uuid[])', [[fixed, other]]);
  const mixed = [{ product_id: 1, variant_id: 1, qty: 1 }, { product_id: 1, variant_id: 2, qty: 7 }];
  await actor(student);
  quote = await ordinaryQuote(mixed);
  assert.equal(quote.discount, 3000);
  assert.equal(quote.adjustments[0].qualification.allocation.reduce((n, l) => n + l.quantity, 0), 8);
  await actor(admin);
  const couponBogo = await save({ name: '券買3送1', benefit_type: 'buy_x_get_y', buy_quantity: 3, gift_quantity: 1, repeat_mode: 'repeat', activation_type: 'coupon_only' });
  await db.query('insert into public.coupon_promotions(coupon_campaign_id,promotion_id,sort_order) values($1,$2,1)', [coupon, couponBogo]);
  await db.query("update public.coupon_campaigns set stacking_policy='allow_all' where id=$1", [coupon]);
  await actor(student);
  assert.equal((await ordinaryQuote(mixed, 'MULTI')).discount, 6000, 'Existing coupon percentage then BOGO uses paid remaining units');
  await actor(admin);
  const gift = await save({ name: '滿件贈仍獨立', benefit_type: 'quantity_gift', threshold_value: 4, gift_variant_id: 1, gift_quantity: 1 });
  const giftQuote = await ordinaryQuote(mixed);
  assert.equal(giftQuote.discount, 3000);
  assert.equal(giftQuote.gifts.length, 1);
  await db.query('update public.promotions set active=false where id=$1', [gift]);
  await actor(student);
  // Many units of one variant stay compressed; no row-per-unit expansion.
  const allocateQuantity = async qty => (await one('select public.allocate_automatic_prices($1::jsonb,$2,$3::uuid) q', [
    JSON.stringify([{ product_id: 1, variant_id: 1, qty, unit_price: 1000, line_total: qty * 1000, publication_status: 'active' }]), 'consumer', student,
  ])).q;
  const largeStart = performance.now();
  assert.equal((await allocateQuantity(9999)).discount, 2499000);
  console.log('allocation benchmark: single BOGO 9999 units ms=' + Math.round(performance.now() - largeStart));
  const pct = await save({ name: '八折', benefit_type: 'percentage_discount', discount_rate: 0.8 });
  assert.equal((await ordinaryQuote([{ product_id: 1, variant_id: 1, qty: 5 }])).discount, 1200);
  const budgetStart = performance.now();
  const budgetActivities = [{ id: 'a', name: 'a', benefit_type: 'buy_x_get_y', buy_quantity: 3, gift_quantity: 1, repeat_mode: 'repeat', threshold_type: 'quantity', threshold_value: 4, q: [true], b: [true], e: [true] },
    { id: 'b', name: 'b', benefit_type: 'percentage_discount', discount_rate: 0.8, threshold_type: 'amount', q: [true], b: [true], e: [true] }];
  await assert.rejects(db.query('select public.solve_automatic_price_component($1::jsonb,$2::jsonb,1)', [JSON.stringify([{ product_id: 1, variant_id: 1, qty: 99, unit_price: 1000, line_total: 99000 }]), JSON.stringify(budgetActivities)]), /超出計算範圍/);
  console.log('allocation benchmark: overlap budget rejection ms=' + Math.round(performance.now() - budgetStart));
  await db.query('update public.promotions set active=false where id=$1', [pct]);
  await db.exec('update public.automatic_price_allocation_settings set enabled=false');
  assert.equal((await ordinaryQuote(mixed)).discount, 3000);
  await db.exec('update public.automatic_price_allocation_settings set enabled=true');
  assert.deepEqual((await one('select pricing_snapshot from public.orders where id=$1', [created.order_id])).pricing_snapshot, originalSnapshot, 'Switching must not rewrite historical orders');
  await actor(admin);
  const aq = async (payload) => (await one('select public.quote_assisted_order($1::jsonb) q', [JSON.stringify(payload)])).q;
  const payload = { ...base, apply_automatic: true, shopping_credit_amount: 0, coupon_code: '', items: mixed.map((i) => ({ ...i, unit_price: i.variant_id === 1 ? 1000 : 2000 })) };
  assert.equal((await aq(payload)).discount, 3000);
  assert.equal((await aq({ ...payload, apply_automatic: false })).discount, 0);
  const assisted = await create('88888888-1111-4111-8111-111111111111', { ...payload, expected_quote: (await aq(payload)).confirmation });
  assert.equal((await one('select pricing_snapshot from public.orders where id=$1', [assisted.order_id])).pricing_snapshot.automatic_allocation_version, 1);
  await db.query('update public.promotions set audience_roles=array[\'staff\'],allow_guest=false where id=$1', [bogo]);
  assert.equal((await aq(payload)).discount, 0, 'Audience uses customer, never operator');
  await db.query("update public.promotions set audience_roles=array['consumer'],allow_guest=false where id=$1", [bogo]);
  await actor('');
  assert.equal((await ordinaryQuote(mixed)).discount, 0, 'Guest audience stays enforced');
  await actor(student);
  // Decimal monetary settings preserve numeric arithmetic, including exact
  // residual totals and BOGO rounding credits on paid units.
  await db.query('update public.promotions set active=false where id=$1', [bogo]);
  const decimalFixed = await save({ name: '小數折抵', benefit_type: 'fixed_discount', discount_amount: 12.5 });
  assert.equal((await ordinaryQuote([{ product_id: 1, variant_id: 1, qty: 1 }])).discount, 12.5);
  await db.query('update public.promotions set active=false where id=$1', [decimalFixed]);
  await db.query('update public.promotions set active=true where id=$1', [bogo]);
  await db.exec('update public.product_variants set price=100.4 where id=1');
  assert.equal((await ordinaryQuote([{ product_id: 1, variant_id: 1, qty: 4 }])).discount, 100);
  await db.exec('update public.product_variants set price=1000 where id=1');
  // Legacy benefits participate and persist alongside an unrelated activity.
  await db.query('update public.promotions set active=false where id=$1', [bogo]);
  await db.query('update public.promotions set active=true where id=$1', [other]);
  await db.exec("insert into public.promotions(name,benefit_type,activation_type,product_ids,discount_rate,discount_amount,discount_order,active) values('舊活動','legacy_discount','automatic',array[1],1,50,'rate_then_amount',true)");
  quote = await ordinaryQuote(items);
  assert.equal(quote.discount, 250);
  const legacyOrder = await ordinaryCreate(items, quote);
  assert.equal((await one("select count(*)::int n from public.order_adjustments where order_id=$1 and adjustment_type='legacy_discount'", [legacyOrder.order_id])).n, 1);
  await db.exec('set role authenticated');
  await assert.rejects(db.exec('update public.automatic_price_allocation_settings set enabled=false'), /permission denied/);
  await assert.rejects(db.query('select public.allocate_automatic_prices($1::jsonb,$2,$3::uuid)', ['[]', 'consumer', student]), /permission denied/);
  await db.exec('reset role');
  const authority = (await one("select pg_get_functiondef('public.quote_order_pricing_internal_20260916(jsonb,text)'::regprocedure) f")).f;
  await db.exec(authority.replace('begin\n', 'begin\n-- Simulated later authority revision\n'));
  await assert.rejects(ordinaryQuote(items), /計價版本更新中/);
  await db.exec(authority);
}));

const { runRewardCheckoutDatabaseScenario } = require('./instructor-reward-checkout-db.test.cjs');
test('automatic allocation preserves double-wallet reservation and authoritative payment amount', {
  skip: !process.env.PGLITE_MODULE && !process.env.EMBEDDED_POSTGRES_MODULE, timeout: 180000,
}, () => runRewardCheckoutDatabaseScenario(async ({ db, read, fn, one, actor, student, teacher, admin, ordinaryQuote, ordinaryCreate, status, walletQuote, create, consistent }) => {
  await actor(admin);
  await db.exec('alter table public.promotions add column description text; update public.promotions set active=false');
  await db.exec(fn('supabase-promotion-gifts-engine.sql', 'save_discount_promotion'));
  await db.exec(read('supabase-automatic-promotion-audience.sql'));
  await db.exec(read('supabase-buy-x-get-y.sql'));
  await db.exec(read('supabase-automatic-price-allocation.sql'));
  await db.exec('update public.student_pricing_feature_settings set enabled=true');
  await actor(student);
  const incomeItems = [{ product_id: 1, variant_id: 1, qty: 50 }];
  const income = await ordinaryCreate(incomeItems, await ordinaryQuote(incomeItems));
  await actor(admin);
  await db.query('select public.confirm_admin_instructor_reward_payment($1,true)', [income.order_id]);
  await status(income.order_id, 'delivered');
  await db.exec('update public.student_pricing_feature_settings set enabled=false');
  await one('select public.save_discount_promotion($1::jsonb)', [JSON.stringify({ name: '師資折100', benefit_type: 'fixed_discount',
    activation_type: 'automatic', discount_amount: 100, scope_type: 'all_regular', audience_roles: ['instructor'], allow_guest: false })]);
  await db.exec('update public.automatic_price_allocation_settings set enabled=true');
  await actor(teacher);
  const quote = await walletQuote(100, 300);
  assert.equal(quote.discount, 100);
  assert.equal(quote.payment_amount, quote.total - 400);
  const result = await create(100, 300, quote);
  assert.equal(Number(result.payment_amount), quote.payment_amount);
  assert.equal((await one("select count(*)::int n from public.order_adjustments where order_id=$1 and adjustment_type='fixed_discount'", [result.order_id])).n, 1);
  await consistent();
}));
