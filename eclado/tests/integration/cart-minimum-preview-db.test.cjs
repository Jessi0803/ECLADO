const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runStudentPricingDatabaseScenario } = require('./student-pricing-db.test.cjs');

test('cart minimum preview keeps rejected quotes and order guards, including student BOGO and append orders', {
  skip: !process.env.PGLITE_MODULE && !process.env.EMBEDDED_POSTGRES_MODULE, timeout:180000,
}, () => runStudentPricingDatabaseScenario(async ({db,read,fn,one,actor,student,teacher,ordinaryQuote,ordinaryCreate}) => {
  await actor('11111111-1111-4111-8111-111111111111');
  await db.exec('alter table public.promotions add column description text,add column updated_at timestamptz default now(); update public.promotions set active=false; update public.product_variants set stock=10000');
  await db.exec(fn('supabase-promotion-gifts-engine.sql','save_discount_promotion'));
  for(const file of ['supabase-automatic-promotion-audience.sql','supabase-buy-x-get-y.sql','supabase-automatic-price-allocation.sql','supabase-promotion-storefront-display.sql','supabase-student-reward-snapshots.sql','supabase-promotion-student-policy.sql']) await db.exec(read(file));
  await db.query("update public.instructor_student_settings set student_price_type='student_1' where instructor_id=$1",[teacher]);
  await db.query("select public.save_instructor_student_binding($1,$2,null,'bind')",[student,teacher]);
  const acl=async()=>one("select proowner,proacl::text acl from pg_proc where oid='public.quote_order_pricing_discount_v2(jsonb,text,text,text)'::regprocedure");
  const beforeAcl=await acl();
  await db.exec(read('supabase-cart-minimum-preview.sql')); await db.exec(read('supabase-cart-minimum-preview.sql'));
  assert.deepEqual(await acl(),beforeAcl);
  await db.exec('update public.automatic_price_allocation_settings set enabled=true; update public.promotion_student_policy_settings set enabled=true; update public.student_pricing_feature_settings set enabled=true; update public.student_pricing_settings set student_1=.9,student_2=.95; update public.product_variants set pro_price=case id when 1 then 930 else 1320 end');
  await one('select public.save_discount_promotion($1::jsonb) id',[JSON.stringify({name:'呼吸系列任5送1',activation_type:'automatic',benefit_type:'buy_x_get_y',buy_quantity:5,gift_quantity:1,repeat_mode:'repeat',scope_type:'products',product_ids:[1],audience_roles:['pro'],allow_guest:false,allow_student_price_stacking:false,instructor_reward_eligible:true})]);
  await actor(student);
  const items=qty=>[{product_id:1,variant_id:1,qty}];
  const countBefore=await one('select count(*)::int n from public.orders');
  let details;
  await assert.rejects(ordinaryQuote(items(6)),error=>{
    assert.equal(error.code,'22023'); details=JSON.parse(error.detail);
    assert.equal(details.kind,'cart_minimum_preview'); assert.equal(details.subtotal,5022); assert.equal(details.discount,372);
    assert.equal(details.merchandise_amount,4650); assert.equal(details.remaining,350); assert.equal(details.minimum,5000);
    assert.deepEqual(details.adjustments.map(a=>a.amount),[930,558]);
    assert.doesNotMatch(JSON.stringify(details),/_student_policy|binding_id|instructor_unit_price|qualification|pricing_snapshot/);
    return true;
  });
  await assert.rejects(ordinaryCreate(items(6),{...details,total:4770}),/最低金額/);
  assert.deepEqual(await one('select count(*)::int n from public.orders'),countBefore);
  const seventh=await ordinaryQuote(items(7)); assert.equal(seventh.subtotal-seventh.discount,5487);
  const serum=await ordinaryQuote([{product_id:1,variant_id:2,qty:6}]);assert.equal(serum.subtotal-serum.discount,6600);
  await assert.rejects(ordinaryQuote(items(1)),error=>{const d=JSON.parse(error.detail);assert.equal(d.remaining,4163);assert.deepEqual(d.adjustments,[]);return true;});
  await db.exec('update public.product_variants set pro_price=1000 where id=1');
  const exact=await ordinaryQuote(items(6));assert.equal(exact.subtotal-exact.discount,5000);
  await db.exec('update public.product_variants set pro_price=930 where id=1');
  await db.exec(`create or replace function public.get_my_appendable_shipping_group() returns jsonb language sql as $$select '{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","effective_total":7000}'::jsonb$$`);
  const append=await ordinaryQuote(items(6)); assert.equal(append.is_additional_order,true); assert.equal(append.subtotal-append.discount,4650);
}));
