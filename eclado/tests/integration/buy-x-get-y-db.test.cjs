// Real pricing/creation/inventory functions in isolated PostgreSQL. No external writes.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runStudentPricingDatabaseScenario}=require('./student-pricing-db.test.cjs');
test('buy X get Y: mixed units, repeat, audience, coupons, snapshots and inventory',{
  skip:!process.env.PGLITE_MODULE&&!process.env.EMBEDDED_POSTGRES_MODULE,timeout:120000,
},()=>runStudentPricingDatabaseScenario(async({db,read,fn,one,actor,student,base,create,ordinaryQuote,ordinaryCreate})=>{
  await actor('11111111-1111-4111-8111-111111111111');
  await db.exec("alter table public.promotions add column description text; alter table public.promotions add constraint promotions_repeat_mode_check check(repeat_mode in ('once','repeat')); update public.promotions set active=false; update public.product_variants set stock=10000;");
  await db.exec(fn('supabase-promotion-gifts-engine.sql','save_discount_promotion'));
  await db.exec(read('supabase-automatic-promotion-audience.sql'));
  const acl=()=>one(`select proowner::text owner,proacl::text acl from pg_proc where oid='public.quote_order_pricing_discount_v2(jsonb,text,text,text)'::regprocedure`);
  const beforeAcl=await acl();
  // Unknown installed source must roll back ALL DDL, not leave a half-install.
  const engine=(await one("select pg_get_functiondef('public.quote_order_pricing_discount_v2(jsonb,text,text,text)'::regprocedure) f")).f;
  await db.exec(engine.replace('  activity_discount numeric;','  activity_discount NUMERIC;'));
  await assert.rejects(db.exec(read('supabase-buy-x-get-y.sql')),/source mismatch/);
  await db.exec('rollback');
  assert.equal((await one("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='promotions' and column_name='buy_quantity'")).n,0);
  await db.exec(engine);
  await db.exec(read('supabase-buy-x-get-y.sql'));await db.exec(read('supabase-buy-x-get-y.sql'));
  for(const [key,value] of Object.entries(await one(read('supabase-buy-x-get-y-verify.sql')))) assert.equal(value,true,key);
  assert.deepEqual(await acl(),beforeAcl);
  const save=async p=>(await one('select public.save_discount_promotion($1::jsonb) id',[JSON.stringify(p)])).id;
  const config={name:'混搭買三送一',benefit_type:'buy_x_get_y',activation_type:'automatic',buy_quantity:3,gift_quantity:1,
    repeat_mode:'repeat',scope_type:'all_regular',audience_roles:['consumer'],allow_guest:true};
  const id=await save(config),saved=await one('select * from public.promotions where id=$1',[id]);
  assert.equal(saved.threshold_value,'4');assert.equal(saved.threshold_type,'quantity');assert.equal(saved.gift_variant_id,null);
  await db.exec(`update public.profiles set role='consumer' where id='${student}';
    insert into public.products(id,name_zh,stock,publication_status) values(3,'不適用商品',10000,'event_only');
    insert into public.product_variants(id,product_id,sku,size,stock,is_default,price,pro_price) values
      (3,1,'C','300ml',10000,false,3000,3000),(4,3,'EVENT','100ml',10000,true,10,10);
    update public.product_variants set price=1000 where id=1;update public.product_variants set price=2000 where id=2;`);
  await actor(student);
  const mixed=[{product_id:1,variant_id:1,qty:1},{product_id:1,variant_id:2,qty:1},{product_id:1,variant_id:3,qty:6}];
  let q=await ordinaryQuote(mixed);
  assert.equal(q.discount,3000); // Lowest 1000 + second-lowest 2000, each once.
  assert.deepEqual(q.adjustments[0].qualification.buy_x_get_y.free_items.map(i=>[Number(i.variant_id),i.quantity]),[[1,1],[2,1]]);
  for(const [qty,discount] of [[3,0],[4,1000],[7,1000],[8,2000],[12,3000],[96,24000]])
    assert.equal((await ordinaryQuote([{product_id:1,variant_id:1,qty}])).discount,discount,`qty=${qty}`);
  await save({...config,id,repeat_mode:'once'});assert.equal((await ordinaryQuote(mixed)).discount,1000);
  await save({...config,id,buy_quantity:2,gift_quantity:2});assert.equal((await ordinaryQuote(mixed)).discount,9000);
  await save({...config,id});
  assert.equal((await ordinaryQuote([{product_id:1,variant_id:1,qty:3},{product_id:3,variant_id:4,qty:10}])).discount,0);
  await save({...config,id,scope_type:'products',product_ids:[3]});
  assert.equal((await ordinaryQuote([{product_id:1,variant_id:1,qty:4},{product_id:3,variant_id:4,qty:4}])).discount,10);
  await save({...config,id,allow_guest:false});await actor('');assert.equal((await ordinaryQuote(mixed)).discount,0);
  await actor(student);assert.equal((await ordinaryQuote(mixed)).discount,3000);
  await save({...config,id,audience_roles:['pro'],allow_guest:false});assert.equal((await ordinaryQuote(mixed)).discount,0);
  await save({...config,id});
  const aq=async payload=>(await one('select public.quote_assisted_order($1::jsonb) q',[JSON.stringify(payload)])).q;
  const assisted={...base,apply_automatic:true,shopping_credit_amount:0,coupon_code:'',
    items:mixed.map(item=>({...item,unit_price:item.variant_id===1?1000:item.variant_id===2?2000:3000}))};
  await actor('11111111-1111-4111-8111-111111111111');
  assert.equal((await aq(assisted)).discount,3000);assert.equal((await aq({...assisted,apply_automatic:false})).discount,0);
  await save({...config,id,audience_roles:['staff'],allow_guest:false});assert.equal((await aq(assisted)).discount,0);
  await save({...config,id});
  const competing=await save({name:'五千折抵',benefit_type:'fixed_discount',activation_type:'automatic',discount_amount:5000,scope_type:'all_regular'});
  assert.equal((await aq(assisted)).discount,5000);await db.query('update public.promotions set active=false where id=$1',[competing]);
  const coupon='20000000-0000-4000-8000-000000000099';
  await db.query(`insert into public.coupon_campaigns(id,name,code,code_normalized,stacking_policy,audience_mode,audience_roles,allow_guest)
    values($1,'混搭券','BOGO','BOGO','coupon_only','roles',array['consumer'],true)`,[coupon]);
  const couponBogo=await save({...config,name:'券買三送一',activation_type:'coupon_only'});
  const pct=await save({name:'券九折',benefit_type:'percentage_discount',activation_type:'coupon_only',discount_rate:0.9,scope_type:'all_regular'});
  await db.query('insert into public.coupon_promotions(coupon_campaign_id,promotion_id,sort_order) values($1,$2,0),($1,$3,1)',[coupon,couponBogo,pct]);
  await actor(student);assert.equal((await ordinaryQuote(mixed,'BOGO')).discount,4800);
  await db.query("update public.coupon_campaigns set stacking_policy='allow_auto_gifts' where id=$1",[coupon]);
  assert.equal((await ordinaryQuote(mixed,'BOGO')).discount,4800);
  await db.query("update public.coupon_campaigns set stacking_policy='allow_all' where id=$1",[coupon]);
  q=await ordinaryQuote(mixed,'BOGO');assert.equal(q.discount,7500);
  assert.deepEqual(q.adjustments.find(a=>a.promotion_id===couponBogo).qualification.buy_x_get_y.free_items.map(i=>Number(i.variant_id)),[3]);
  await db.query('update public.coupon_promotions set sort_order=case when promotion_id=$1 then 1 else 0 end where coupon_campaign_id=$2',[couponBogo,coupon]);
  await db.query("update public.coupon_campaigns set stacking_policy='coupon_only' where id=$1",[coupon]);
  assert.equal((await ordinaryQuote(mixed,'BOGO')).discount,4800);
  // Fractional unit bases after an earlier coupon still produce whole-dollar totals.
  const fixed=await save({name:'券折一元',benefit_type:'fixed_discount',activation_type:'coupon_only',discount_amount:1,scope_type:'all_regular'});
  await db.query('update public.coupon_promotions set sort_order=case when promotion_id=$1 then 1 else 2 end where coupon_campaign_id=$2',[couponBogo,coupon]);
  await db.query('insert into public.coupon_promotions(coupon_campaign_id,promotion_id,sort_order) values($1,$2,0)',[coupon,fixed]);
  const rounded=await ordinaryQuote(mixed,'BOGO');assert.equal(rounded.discount,4801);assert.ok(Number.isInteger(rounded.total));
  assert.notEqual(rounded.adjustments.find(a=>a.promotion_id===couponBogo).qualification.buy_x_get_y.rounding_adjustment,0);
  const arithmetic=(await one('select public.calculate_buy_x_get_y($1,$2::jsonb) result',[couponBogo,JSON.stringify(mixed.map(item=>({...item,line_total:item.qty*(item.variant_id===1?1000:item.variant_id===2?2000:3000),remaining_total:item.qty*(item.variant_id===1?1000:item.variant_id===2?2000:3000)*(21000-1)/21000})))])).result;
  assert.ok(Math.abs(arithmetic.lines.reduce((n,line)=>n+Number(line.remaining_total),0)-(20999-arithmetic.amount))<0.000001);
  assert.ok(arithmetic.lines.every(line=>Number(line.remaining_total)>=0));
  await db.query('delete from public.coupon_promotions where promotion_id=$1',[fixed]);
  await db.query('update public.coupon_promotions set sort_order=case when promotion_id=$1 then 1 else 0 end where coupon_campaign_id=$2',[couponBogo,coupon]);
  // Persist exact free units; free merchandise uses ordinary inventory.
  q=await ordinaryQuote(mixed);const giftStock=await one('select gift_stock from public.product_variants where id=1');
  const created=await ordinaryCreate(mixed,q);
  const stored=await one("select * from public.order_adjustments where order_id=$1 and adjustment_type='buy_x_get_y'",[created.order_id]);
  assert.equal(Number(stored.amount),3000);assert.equal(stored.qualification_snapshot.buy_x_get_y.free_quantity,2);
  assert.equal((await one('select count(*)::int n from public.promotion_gift_reservations where order_id=$1',[created.order_id])).n,0);
  await actor('11111111-1111-4111-8111-111111111111');
  const before=await one('select stock from public.product_variants where id=3');
  const assistedCreated=await create('77777777-7777-4777-8777-777777777777',assisted);
  assert.equal((await one('select stock from public.product_variants where id=3')).stock,before.stock-6);
  assert.deepEqual(await one('select gift_stock from public.product_variants where id=1'),giftStock);
  assert.equal(Number((await one("select amount from public.order_adjustments where order_id=$1 and adjustment_type='buy_x_get_y'",[assistedCreated.order_id])).amount),3000);
  // Actual test catalog IDs have ten digits; preserve positive int32 bounds.
  await db.exec(`insert into public.products(id,name_zh,stock) values(1239098752,'Ten digit product',50);
    insert into public.product_variants(id,product_id,sku,size,stock,is_default,price,pro_price)
      values(88,1239098752,'TEN-DIGIT','100ml',50,true,1000,1000);`);
  const tenDigit={...assisted,items:[{product_id:1239098752,variant_id:88,qty:4,unit_price:1000}]};
  assert.equal((await aq(tenDigit)).subtotal,4000);
  await create('77777777-7777-4777-8777-777777777778',tenDigit);
  assert.equal((await one('select stock from public.product_variants where id=88')).stock,46);
  for(const product_id of [0,-1,2147483648,'not-a-number'])
    await assert.rejects(aq({...tenDigit,items:[{...tenDigit.items[0],product_id}]}),/Invalid item quantity/);
  // Existing designated gifts continue alongside the new price benefit.
  const gift=await save({name:'既有滿件贈',benefit_type:'quantity_gift',activation_type:'automatic',scope_type:'all_regular',threshold_value:4,gift_variant_id:1,gift_quantity:1});
  let gifted=await ordinaryQuote(mixed);assert.equal(gifted.discount,3000);assert.equal(gifted.gifts.length,1);
  await db.query('update public.promotions set active=false where id=$1',[gift]);
  // Coupon order creation must also reserve redemption and persist the discount.
  await actor(student);const couponQuote=await ordinaryQuote(mixed,'BOGO');
  const couponOrder=(await one(`select public.create_order_with_pricing($1::jsonb,'學生','隔離地址','0911111111','customer@example.test','','atm','delivery','BOGO',
    'personal',null,null,0::bigint,$2::jsonb) q`,[JSON.stringify(mixed),JSON.stringify(couponQuote)])).q;
  assert.equal(Number((await one("select amount from public.order_adjustments where order_id=$1 and adjustment_type='buy_x_get_y'",[couponOrder.order_id])).amount),2700);
  assert.equal((await one("select count(*)::int n from public.coupon_redemptions where order_id=$1 and status='reserved'",[couponOrder.order_id])).n,1);
  await actor('11111111-1111-4111-8111-111111111111');
  await save({...config,id,repeat_mode:'once'});await actor(student);await assert.rejects(ordinaryCreate(mixed,q),/已變動/);
  await actor('11111111-1111-4111-8111-111111111111');
  for(const fields of [{buy_quantity:0},{buy_quantity:1.5},{buy_quantity:'3'},{gift_quantity:0},{gift_quantity:1.5},{gift_quantity:null},{buy_quantity:2147483647,gift_quantity:1},{repeat_mode:'other'},{audience_roles:[],allow_guest:false}])
    await assert.rejects(save({...config,id,...fields}),JSON.stringify(fields));
  assert.equal((await one('select repeat_mode from public.promotions where id=$1',[id])).repeat_mode,'once');
  await save({name:'轉回一般折扣',id,benefit_type:'fixed_discount',activation_type:'automatic',discount_amount:100,scope_type:'all_regular'});
  assert.equal((await one('select buy_quantity from public.promotions where id=$1',[id])).buy_quantity,null);
  await db.exec('set role authenticated');await assert.rejects(db.query('select public.calculate_buy_x_get_y($1,$2::jsonb)',[couponBogo,'[]']),/permission denied/);
  await db.exec('reset role');await db.exec("create or replace function public.has_backoffice_permission(p text) returns boolean language sql as $$select false$$");await assert.rejects(save(config),/management access/);
}));

const {runRewardCheckoutDatabaseScenario}=require('./instructor-reward-checkout-db.test.cjs');
test('buy X get Y preserves installed reward-wallet and payment wrappers',{
  skip:!process.env.PGLITE_MODULE&&!process.env.EMBEDDED_POSTGRES_MODULE,timeout:180000,
},()=>runRewardCheckoutDatabaseScenario(async({db,read,fn,one,actor,teacher,admin,walletQuote,create,consistent})=>{
  await actor(admin);
  await db.exec('alter table public.promotions add column description text');
  await db.exec(fn('supabase-promotion-gifts-engine.sql','save_discount_promotion'));
  await db.exec(read('supabase-automatic-promotion-audience.sql'));
  await db.exec(read('supabase-buy-x-get-y.sql'));
  await one('select public.save_discount_promotion($1::jsonb)',[JSON.stringify({name:'師資買三送一',benefit_type:'buy_x_get_y',activation_type:'automatic',
    buy_quantity:3,gift_quantity:1,repeat_mode:'repeat',scope_type:'all_regular',audience_roles:['instructor'],allow_guest:false})]);
  await actor(teacher);await assert.rejects(walletQuote(),/5,000/); // Existing professional minimum still applies after discount.
  await actor(admin);await db.exec("update public.promotions set buy_quantity=9,threshold_value=10 where benefit_type='buy_x_get_y'");
  await actor(teacher);const q=await walletQuote();
  assert.equal(q.discount,q.items[0].unit_price*Math.floor(q.items[0].qty/10));
  const created=await create(0,0,q);
  assert.equal(Number(created.payment_amount),q.total);
  assert.equal((await one("select count(*)::int n from public.order_adjustments where order_id=$1 and adjustment_type='buy_x_get_y'",[created.order_id])).n,1);
  await consistent();
  const verification=await db.exec(read('supabase-instructor-reward-checkout-verify.sql'));
  const row=Array.isArray(verification)?verification.find(v=>v.rows?.[0]?.verification):verification;
  for(const [key,value] of Object.entries(row.rows[0].verification))assert.equal(value,true,key);
}));
