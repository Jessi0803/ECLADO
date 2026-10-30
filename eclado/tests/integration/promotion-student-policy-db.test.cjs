const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runStudentPricingDatabaseScenario } = require('./student-pricing-db.test.cjs');
const { solveStudentPolicy } = require('../helpers/student-policy-oracle.cjs');

test('student policy: authoritative allocation, mixed rewards, coupons, snapshots and rollback', {
  skip: !process.env.PGLITE_MODULE && !process.env.EMBEDDED_POSTGRES_MODULE, timeout: 180000,
}, () => runStudentPricingDatabaseScenario(async ({ db, read, fn, one, actor, student, teacher, ordinaryQuote, ordinaryCreate, base, quote, create }) => {
  const admin = '11111111-1111-4111-8111-111111111111';
  await actor(admin);
  await db.exec('alter table public.promotions add column description text, add column updated_at timestamptz default now(); update public.promotions set active=false; update public.product_variants set stock=10000');
  await db.exec(fn('supabase-promotion-gifts-engine.sql', 'save_discount_promotion'));
  await db.exec(read('supabase-automatic-promotion-audience.sql'));
  await db.exec(read('supabase-buy-x-get-y.sql'));
  await db.exec(read('supabase-automatic-price-allocation.sql'));
  await db.exec(read('supabase-promotion-storefront-display.sql'));
  await db.exec(read('supabase-student-reward-snapshots.sql'));
  const shipping = read('supabase-professional-shipping-groups.sql');
  await db.exec(shipping.slice(shipping.indexOf('create table'), shipping.indexOf('create or replace function')));
  for (const name of ['is_professional_shipping_role','is_shipping_group_valid_order_status','shipping_group_effective_amount']) await db.exec(fn('supabase-professional-shipping-groups.sql', name));
  await db.query('insert into auth.users values($1)', [teacher]);
  await db.exec(read('supabase-instructor-reward-ledger.sql'));
  await db.exec(read('supabase-instructor-reward-queries.sql'));
  await db.query("select public.save_instructor_student_binding($1,$2,null,'bind')", [student, teacher]);
  await db.exec("update public.automatic_price_allocation_settings set enabled=true; update public.student_pricing_feature_settings set enabled=true; update public.student_pricing_settings set student_1=0.9,student_2=0.9");
  const source = (await one("select pg_get_functiondef('public.quote_order_pricing_discount_v2(jsonb,text,text,text)'::regprocedure) f")).f;
  await db.exec(source.replace("sum((adjustment ->> 'amount')::numeric)","sum(/* unknown source */ (adjustment ->> 'amount')::numeric)"));
  await assert.rejects(db.exec(read('supabase-promotion-student-policy.sql')), /source mismatch/);
  await db.exec('rollback');
  assert.equal((await one("select to_regclass('public.promotion_student_policy_settings') t")).t,null);
  await db.exec(source);
  const originalAcl = await db.query("select oid::regprocedure::text signature,proowner,proacl::text acl from pg_proc where pronamespace='public'::regnamespace and proname in ('allocate_automatic_prices','persist_student_reward_snapshot','quote_assisted_order','save_discount_promotion','instructor_reward_report_internal') order by 1");
  await db.exec(read('supabase-promotion-student-policy.sql'));
  await db.exec(read('supabase-promotion-student-policy.sql'));
  assert.deepEqual((await db.query("select oid::regprocedure::text signature,proowner,proacl::text acl from pg_proc where pronamespace='public'::regnamespace and proname in ('allocate_automatic_prices','persist_student_reward_snapshot','quote_assisted_order','save_discount_promotion','instructor_reward_report_internal') order by 1")).rows,originalAcl.rows);
  for (const [key, value] of Object.entries(await one(read('supabase-promotion-student-policy-verify.sql')))) assert.equal(value, true, key);
  assert.equal((await one('select enabled from public.promotion_student_policy_settings')).enabled, false);
  const save = async config => (await one('select public.save_discount_promotion($1::jsonb) id', [JSON.stringify({
    name: '雙十一', activation_type: 'automatic', scope_type: 'products', product_ids: [1], benefit_type: 'percentage_discount', discount_rate: 0.8,
    allow_student_price_stacking: false, instructor_reward_eligible: false, ...config,
  })])).id;
  const activity = await save({});
  const items = [{ product_id: 1, variant_id: 1, qty: 10 }];
  await actor(student);
  let q = await ordinaryQuote(items);
  assert.equal(q.subtotal, 7200);
  assert.equal(q.discount, 1440, 'OFF keeps original stacking');
  await db.exec('update public.promotion_student_policy_settings set enabled=true');
  q = await ordinaryQuote(items);
  assert.equal(q.discount, 800, '8000 * .8 = 6400, saving 800 over student 7200');
  assert.equal(q.promotion_id, activity, 'restoration is not a second activity');
  assert.equal(q.adjustments.length, 2);
  assert.equal(q.adjustments[1].adjustment_type, 'student_price_restoration');
  assert.equal(q.adjustments[1].amount, 800);
  assert.doesNotMatch(JSON.stringify(q), /_student_policy|instructor_unit_price|total_reward|binding_id/);
  let order = await ordinaryCreate(items, q);
  let snapshot = await one('select * from public.student_reward_snapshots where order_id=$1', [order.order_id]);
  assert.equal(Number(snapshot.total_reward), 0);
  assert.equal(snapshot.items[0].reward_excluded_quantity, 10);
  assert.equal(Number((await one('select amount from public.instructor_reward_order_states where order_id=$1', [order.order_id])).amount), 0);
  assert.equal((await one('select count(*)::int n from public.order_adjustments where order_id=$1', [order.order_id])).n, 2);
  await db.query('update public.promotions set threshold_value=7800,threshold_type=\'amount\' where id=$1',[activity]);
  assert.equal((await ordinaryQuote(items)).discount,800,'non-stacking threshold uses 8000 member basis');
  await db.query('update public.promotions set allow_student_price_stacking=true where id=$1',[activity]);
  assert.equal((await ordinaryQuote(items)).discount,0,'stacking threshold uses 7200 student basis');
  await db.query('update public.promotions set allow_student_price_stacking=false,threshold_value=null where id=$1',[activity]);
  // Policy changes at the same customer price still invalidate confirmation.
  await db.exec(`update public.promotions set instructor_reward_eligible=true where id='${activity}'`);
  const before = (await one('select count(*)::int n from public.orders')).n;
  await assert.rejects(ordinaryCreate(items, q), /已變動/);
  assert.equal((await one('select count(*)::int n from public.orders')).n, before);
  q = await ordinaryQuote(items); order = await ordinaryCreate(items, q);
  assert.equal(Number((await one('select total_reward from public.student_reward_snapshots where order_id=$1', [order.order_id])).total_reward), 1600);
  // Student is cheaper; same price picks activity, including zero net discount.
  await db.exec(`update public.promotions set discount_rate=.95,instructor_reward_eligible=false where id='${activity}'`);
  q = await ordinaryQuote(items); assert.equal(q.discount, 0); assert.equal(q.adjustments.length, 0);
  order = await ordinaryCreate(items, q);
  assert.equal(Number((await one('select total_reward from public.student_reward_snapshots where order_id=$1', [order.order_id])).total_reward), 1600);
  await db.exec(`update public.promotions set discount_rate=.9 where id='${activity}'`);
  q = await ordinaryQuote(items); assert.equal(q.discount, 0); assert.equal(q.adjustments.length, 2);
  order = await ordinaryCreate(items, q);
  assert.equal(Number((await one('select total_reward from public.student_reward_snapshots where order_id=$1', [order.order_id])).total_reward), 0);

  // BOGO whole groups, same-variant remainder, unrelated lines retain rewards.
  await actor(admin); await db.exec('update public.promotions set active=false');
  const bogo = await save({ benefit_type: 'buy_x_get_y', discount_rate: 1, buy_quantity: 3, gift_quantity: 1, repeat_mode: 'repeat' });
  await actor(student);
  const mixed = [{ product_id: 1, variant_id: 1, qty: 5 }, { product_id: 1, variant_id: 2, qty: 2 }];
  // Both variants match product 1; use a separate product for truly unrelated goods.
  await db.exec("insert into public.products(id,name_zh,stock) values(3,'非活動商品',10000); insert into public.product_variants(id,product_id,sku,size,stock,is_default,price,pro_price) values(3,3,'C','100ml',10000,true,1000,800)");
  mixed[1] = { product_id: 3, variant_id: 3, qty: 3 };
  q = await ordinaryQuote(mixed); assert.equal(q.discount, 480);
  order = await ordinaryCreate(mixed, q);
  snapshot = await one('select * from public.student_reward_snapshots where order_id=$1', [order.order_id]);
  assert.equal(Number(snapshot.total_reward), 640, 'one remainder plus three unrelated units');
  assert.deepEqual(snapshot.items.map(i => i.reward_excluded_quantity), [4, 0]);
  await actor(teacher);
  const report = (await one('select public.get_my_instructor_reward_report() r')).r;
  const reported = report.orders.find(o => o.order_id === order.order_id);
  assert.equal(reported.items[0].reward_excluded_quantity, 4);
  assert.doesNotMatch(JSON.stringify(report), /instructor_unit_price|student_multiplier|_student_policy/);
  await actor(student);
  // Repeated input variants are merged for allocation and distributed once for rewards.
  const duplicates = [{ product_id: 1, variant_id: 1, qty: 2 }, { product_id: 1, variant_id: 1, qty: 3 }, mixed[1]];
  const dupq = await ordinaryQuote(duplicates);
  assert.equal(dupq.discount, q.discount);
  const dupo = await ordinaryCreate(duplicates, dupq);
  const dups = await one('select * from public.student_reward_snapshots where order_id=$1', [dupo.order_id]);
  assert.equal(Number(dups.total_reward), 640);
  assert.equal(dups.items.reduce((n, i) => n + i.reward_excluded_quantity, 0), 4);
  const original = JSON.stringify(snapshot);
  await db.exec(`update public.promotions set allow_student_price_stacking=true,instructor_reward_eligible=true where id='${bogo}'`);
  assert.equal(JSON.stringify(await one('select * from public.student_reward_snapshots where order_id=$1', [order.order_id])), original);
  q = await ordinaryQuote(mixed); assert.equal(q.discount, 720, 'allow stacking uses student BOGO price');
  await db.exec(`update public.promotions set allow_student_price_stacking=false,instructor_reward_eligible=false where id='${bogo}'`);

  // Existing ONLY coupon excludes automatic prices and restores full rewards.
  await db.exec("update public.promotions set active=true where id='10000000-0000-4000-8000-000000000003'; update public.coupon_campaigns set stacking_policy='coupon_only',per_member_limit=null");
  q = await ordinaryQuote(items, 'ONLY');
  assert.equal(q.pricing_snapshot.automatic_allocations.length, 0);
  assert.equal(q.adjustments.some(a => a.adjustment_type === 'student_price_restoration'), false);
  const couponCreate = async couponQuote => (await one("select public.create_order_with_pricing($1::jsonb,'學生','地址','0900000000','customer@example.test','','atm','delivery','ONLY','personal',null,null,0::bigint,$2::jsonb) q",[JSON.stringify(items),JSON.stringify(couponQuote)])).q;
  let co = await couponCreate(q);
  assert.equal(Number((await one('select total_reward from public.student_reward_snapshots where order_id=$1',[co.order_id])).total_reward),1600);
  // Production's coupon mode also suppresses automatic price activities.
  await db.exec("update public.coupon_campaigns set stacking_policy='allow_auto_gifts'");
  q = await ordinaryQuote(items, 'ONLY');
  assert.equal(q.discount,50);
  assert.deepEqual(q.pricing_snapshot.automatic_allocations,[]);
  assert.equal(q.adjustments.some(a => a.adjustment_type === 'student_price_restoration'),false);
  co = await couponCreate(q);
  assert.equal(Number((await one('select total_reward from public.student_reward_snapshots where order_id=$1',[co.order_id])).total_reward),1600);
  await db.exec("update public.coupon_campaigns set stacking_policy='allow_all'");
  q = await ordinaryQuote(items,'ONLY');
  assert.equal(q.discount,1010,'960 automatic net saving plus unchanged 50 coupon');
  co = await couponCreate(q);
  assert.equal(Number((await one('select total_reward from public.student_reward_snapshots where order_id=$1',[co.order_id])).total_reward),320);

  // Assisted AUTO shares the policy, explicit MANUAL keeps its existing price/reward.
  await actor(admin);
  const payload = { ...base, apply_automatic: true, items: [{ product_id: 1, variant_id: 1, qty: 5, price_mode: 'AUTO', unit_price: 1 }] };
  let aq = await quote(payload); assert.equal(aq.discount, 480);
  const assisted = await create('10000000-0000-4000-8000-000000000091', { ...payload, expected_quote: aq.confirmation });
  snapshot = await one('select * from public.student_reward_snapshots where order_id=$1', [assisted.order_id]);
  assert.equal(Number(snapshot.total_reward), 160);
  const manual = { ...payload, items: [{ ...payload.items[0], price_mode: 'MANUAL', unit_price: 777 }] };
  aq = await quote(manual); assert.equal(aq.discount, 777);
  const mo = await create('10000000-0000-4000-8000-000000000092', { ...manual, expected_quote: aq.confirmation });
  assert.equal(Number((await one('select total_reward from public.student_reward_snapshots where order_id=$1', [mo.order_id])).total_reward), 1085);
  // OFF allocation has nullable metadata; new snapshot code must preserve old behavior.
  await db.exec('update public.automatic_price_allocation_settings set enabled=false');
  aq = await quote(manual);
  await create('10000000-0000-4000-8000-000000000093', { ...manual, expected_quote: aq.confirmation });
  await db.exec('update public.automatic_price_allocation_settings set enabled=true');
  // Reward cancellation continues to use the frozen mixed-order amount once.
  await db.query("update public.orders set status='cancelled' where id=$1", [order.order_id]);
  await db.query("update public.orders set status='cancelled' where id=$1", [order.order_id]);
  const cancelled = await one("select count(*)::int n,sum(amount)::bigint amount from public.instructor_reward_ledger where order_id=$1 and event_type='cancel'", [order.order_id]);
  assert.equal(cancelled.n, 1); assert.equal(Number(cancelled.amount), 640);
  // A policy-only editor has stale-write protection and preserves all other fields.
  const previous = await one('select *,updated_at::text updated_at from public.promotions where id=$1', [bogo]);
  await db.query('select public.save_promotion_student_policy($1,true,true,$2)', [bogo, previous.updated_at]);
  const saved = await one('select * from public.promotions where id=$1', [bogo]);
  assert.equal(saved.buy_quantity, previous.buy_quantity); assert.deepEqual(saved.product_ids, previous.product_ids);
  assert.equal(saved.label_text,previous.label_text); assert.deepEqual(saved.audience_roles,previous.audience_roles);
  await assert.rejects(db.query('select public.save_promotion_student_policy($1,false,false,$2)', [bogo, previous.updated_at]), /已變更/);

  // Independent exhaustive unit oracle vs SQL compressed allocation, including
  // negative-net individual activities that unlock a better BOGO combination.
  for (let seed = 0; seed < 45; seed++) {
    const units = Array.from({ length: 4 }, (_, i) => { const price = 20 + (seed * (i + 3) % 60); return { id:i + 1, productId:i % 2 + 1, base:price, student:Math.round(price * .9), reward:3 + i }; });
    const activities = [
      { type:'fixed_discount', amount:seed % 15 + 1, stack:false, reward:false, qualificationIds:[1], benefitIds:[2], quantity:true, threshold:1 },
      { type:'buy_x_get_y', buy:2, get:1, repeat:seed % 2 === 0, stack:seed % 3 === 0, reward:false, quantity:true, threshold:3 },
      { type:'percentage_discount', rate:.8, stack:true, reward:seed % 2 === 0, qualificationIds:[1], benefitIds:[1] },
    ];
    const lines = units.map(u => ({ product_id:u.productId, variant_id:u.id, qty:1, unit_price:u.student, line_total:u.student, _student_policy_base:u.base, _student_policy_reward:u.reward }));
    const candidates = activities.map((a, j) => {
      const q = units.map(u => !a.qualificationIds || a.qualificationIds.includes(u.productId));
      const b = units.map(u => !a.benefitIds || a.benefitIds.includes(u.productId));
      return { id:String(j), name:String(j), benefit_type:a.type, discount_amount:a.amount || 0, discount_rate:a.rate || 1,
        buy_quantity:a.buy, gift_quantity:a.get, repeat_mode:a.repeat ? 'repeat' : 'once', threshold_type:a.quantity ? 'quantity' : 'amount', threshold_value:a.threshold || 0,
        allow_student_price_stacking:a.stack, instructor_reward_eligible:a.reward, q,b,e:q.map((x, i) => a.type === 'buy_x_get_y' ? x && b[i] : x || b[i]) };
    });
    const expected = solveStudentPolicy(units, activities);
    const actual = (await one('select public.solve_student_policy_component($1::jsonb,$2::jsonb) r', [JSON.stringify(lines), JSON.stringify(candidates)])).r;
    assert.equal(Number(actual.discount), expected.saving, `seed ${seed}`);
    assert.deepEqual(actual.score.map(Number), expected.score, `tie and ownership seed ${seed}`);
    assert.equal(actual.lines.reduce((n, l) => n + Number(l.remaining_total), 0), units.reduce((n, u) => n + u.student, 0) - expected.saving);
    if (seed < 15) {
      const singleExpected = solveStudentPolicy(units, [activities[1]]);
      const single = (await one('select public.solve_student_policy_component($1::jsonb,$2::jsonb) r', [JSON.stringify(lines), JSON.stringify([candidates[1]])])).r;
      assert.equal(single.discount, singleExpected.saving, `BOGO fast path seed ${seed}`);
      assert.deepEqual(single.score.map(Number), singleExpected.score);
    }
  }
  const largeLine = [{product_id:1,variant_id:1,qty:9999,unit_price:900,line_total:8999100,_student_policy_base:1000,_student_policy_reward:200}];
  const largeBogo = [{id:'a',name:'大件數買3送1',benefit_type:'buy_x_get_y',buy_quantity:3,gift_quantity:1,repeat_mode:'repeat',threshold_type:'quantity',threshold_value:4,
    allow_student_price_stacking:false,instructor_reward_eligible:false,q:[true],b:[true],e:[true]}];
  const started = performance.now();
  const large = (await one('select public.solve_student_policy_component($1::jsonb,$2::jsonb,1) r',[JSON.stringify(largeLine),JSON.stringify(largeBogo)])).r;
  assert.equal(large.search_nodes, 1); assert.equal(large.discount, 1499400);
  console.log(`student policy BOGO 9999 units: ${Math.round(performance.now()-started)}ms, 1 compressed state`);
  await assert.rejects(db.query('select public.solve_student_policy_component($1::jsonb,$2::jsonb,1)',[JSON.stringify(largeLine),JSON.stringify([...largeBogo,...largeBogo])]), e => e.code === '54000');
  // Unsupported policy scopes and malformed values must reject atomically.
  await assert.rejects(save({ activation_type: 'coupon_only' }), /only to automatic/);
  await assert.rejects(save({ allow_student_price_stacking: 'false' }), /Invalid student policy/);
  await db.query('update public.promotions set allow_student_price_stacking=false,instructor_reward_eligible=false where id=$1',[bogo]);
  await save({id:bogo,activation_type:'coupon_only',allow_student_price_stacking:true,instructor_reward_eligible:true});
  const converted = await one('select * from public.promotions where id=$1',[bogo]);
  assert.equal(converted.activation_type,'coupon_only'); assert.equal(converted.allow_student_price_stacking,true);
  await db.exec('set role authenticated');
  await assert.rejects(db.query('select public.student_policy_price_lines($1::jsonb,$2,$3)', ['[]', 'pro', student]), /permission denied/);
  await db.exec('reset role');
}));

const { runRewardCheckoutDatabaseScenario } = require('./instructor-reward-checkout-db.test.cjs');
test('student policy migration preserves installed double-wallet checkout and bank amount', {
  skip: !process.env.PGLITE_MODULE && !process.env.EMBEDDED_POSTGRES_MODULE, timeout: 180000,
}, () => runRewardCheckoutDatabaseScenario(async ({ db, read, fn, one, actor, admin, teacher, student, ordinaryQuote, ordinaryCreate, status, walletQuote, create, consistent }) => {
  await actor(admin);
  await db.exec('alter table public.promotions add column description text, add column updated_at timestamptz default now(); update public.promotions set active=false');
  await db.exec(fn('supabase-promotion-gifts-engine.sql','save_discount_promotion'));
  await db.exec(read('supabase-automatic-promotion-audience.sql'));
  await db.exec(read('supabase-buy-x-get-y.sql'));
  await db.exec(read('supabase-automatic-price-allocation.sql'));
  await db.exec(read('supabase-promotion-storefront-display.sql'));
  await db.exec(read('supabase-promotion-student-policy.sql'));
  await db.exec('update public.automatic_price_allocation_settings set enabled=true; update public.promotion_student_policy_settings set enabled=true');
  await db.exec('update public.student_pricing_feature_settings set enabled=true');
  await actor(student);
  const incomeItems = [{product_id:1,variant_id:1,qty:10}];
  const income = await ordinaryCreate(incomeItems,await ordinaryQuote(incomeItems));
  await actor(admin);
  await db.query('select public.confirm_admin_instructor_reward_payment($1,true)',[income.order_id]);
  await status(income.order_id,'delivered');
  await db.exec('update public.student_pricing_feature_settings set enabled=false');
  await db.query('select public.save_discount_promotion($1::jsonb)', [JSON.stringify({name:'師資折100',benefit_type:'fixed_discount',activation_type:'automatic',discount_amount:100,
    scope_type:'all_regular',audience_roles:['instructor'],allow_guest:false,allow_student_price_stacking:false,instructor_reward_eligible:false})]);
  await actor(teacher);
  const q = await walletQuote(100,300);
  assert.equal(q.discount,100); assert.equal(q.payment_amount,q.total-400);
  const result = await create(100,300,q);
  assert.equal(Number(result.payment_amount),q.payment_amount);
  await consistent();
}));
