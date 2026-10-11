// Extends the base assisted-order database fixture with the real benefit engines.
const assert=require('node:assert/strict');
module.exports=async function verifyBenefits({db,read,fn,base,create}){
  const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
  await db.exec(`
    alter table public.products add column name text, add column category text, add column series text;
    create table public.product_images(id bigint,product_id integer,storage_path text,active boolean,is_primary boolean,sort_order integer);
    create table public.promotions(id uuid primary key default gen_random_uuid(),name text,active boolean default true,
      benefit_type text,activation_type text,archived_at timestamptz,start_at timestamptz,end_at timestamptz,
      priority integer default 100,created_at timestamptz default now(),threshold_type text default 'amount',threshold_value numeric,
      threshold_basis text default 'before_bundle_discount',discount_rate numeric default 1,discount_amount numeric default 0,
      discount_order text default 'rate_then_amount',product_ids integer[] default array[1],gift_variant_id bigint,gift_quantity integer,repeat_mode text default 'once');
    create table public.coupon_promotions(id bigint generated always as identity,promotion_id uuid,coupon_campaign_id uuid,sort_order integer default 0);
    create table public.coupon_redemptions(coupon_campaign_id uuid,order_id text,user_id uuid,guest_identity_hash text,status text,expires_at timestamptz,
      redeemed_at timestamptz,released_at timestamptz,release_reason text);
    create table public.order_adjustments(order_id text,promotion_id uuid,coupon_campaign_id uuid,adjustment_type text,
      name_snapshot text,qualification_snapshot jsonb,amount numeric,gift_product_id integer,gift_variant_id bigint,gift_quantity integer,sort_order integer,metadata jsonb,
      check(adjustment_type in ('percentage_discount','fixed_discount','amount_gift','quantity_gift','free_shipping')));
    alter table public.promotion_gift_reservations alter column id set default gen_random_uuid(),add column coupon_campaign_id uuid,
      add column released_at timestamptz,add column release_reason text;
    update public.product_variants set stock=20,gift_stock=5,gift_enabled=true where id=1;
    alter table public.order_inventory_allocations drop constraint order_inventory_allocations_source_check;
    alter table public.order_inventory_allocations add constraint order_inventory_allocations_source_check check(source in ('payment_allocation','legacy_snapshot'));
  `);
  const foundation=read('supabase-promotions-coupons-foundation.sql');
  await db.exec(foundation.slice(foundation.indexOf('create table if not exists public.promotion_scopes'),foundation.indexOf('create or replace function public.coupon_campaign_allows_identity')));
  const wallet=read('supabase-shopping-credit-foundation.sql');
  await db.exec(wallet.slice(wallet.indexOf('create table if not exists public.shopping_credit_accounts'),wallet.indexOf('alter table public.shopping_credit_accounts enable')));
  for(const name of ['reserve_order_shopping_credit','consume_order_shopping_credit','release_order_shopping_credit','refund_order_shopping_credit'])await db.exec(fn('supabase-shopping-credit-foundation.sql',name));
  await db.exec(fn('supabase-shopping-credit-checkout.sql','set_order_payment_amount_defaults'));
  await db.exec(fn('supabase-shopping-credit-checkout.sql','sync_shopping_credit_from_order_status'));
  await db.exec(fn('supabase-promotion-gifts-engine.sql','sync_gift_reservation_from_order_status'));
  // Match the merchandise-only allocator supplied from the production DB.
  await db.exec(fn('supabase-order-inventory-allocation.sql','allocate_inventory_for_paid_order'));
  await db.exec(fn('supabase-order-inventory-allocation.sql','release_inventory_for_order'));
  await db.exec(fn('supabase-coupon-discount-engine.sql','sync_coupon_redemption_from_order_status'));
  await db.exec(`create trigger credit_defaults before insert on public.orders for each row execute function public.set_order_payment_amount_defaults();
    create trigger credit_sync after update of status on public.orders for each row execute function public.sync_shopping_credit_from_order_status();
    create trigger gift_sync after update of status on public.orders for each row execute function public.sync_gift_reservation_from_order_status();
    create trigger coupon_sync after update of status on public.orders for each row execute function public.sync_coupon_redemption_from_order_status();
    create function public.calculate_order_shipping(jsonb) returns numeric language sql as $$select 120::numeric$$;
    insert into public.shopping_credit_accounts(user_id,available_balance) values('${base.member_id}',2000);
  `);
  await db.exec(fn('supabase-promotion-gifts-engine.sql','promotion_item_matches_scope'));
  await db.exec(fn('supabase-professional-shipping-groups.sql','quote_order_pricing_discount_v2'));
  await db.exec(fn('supabase-promotion-gifts-engine.sql','quote_order_pricing'));
  const discountSource=(await one("select pg_get_functiondef('public.quote_order_pricing_discount_v2(jsonb,text,text,text)'::regprocedure) as f")).f;
  const migration=read('supabase-assisted-order-benefits.sql');
  const originalInventory=await one("select pg_get_functiondef('public.allocate_inventory_for_paid_order(text,jsonb)'::regprocedure) as allocate,pg_get_functiondef('public.release_inventory_for_order(text)'::regprocedure) as release");
  await db.exec(migration);await db.exec(migration);
  const imageField="'image_storage_path',(select image.storage_path from public.product_images image where image.product_id=product.id and image.active is true order by image.is_primary desc,image.sort_order,image.id limit 1),";
  const quoteDefinition=(await one("select pg_get_functiondef('public.quote_assisted_order(jsonb)'::regprocedure) as f")).f;
  await db.exec(quoteDefinition.replace(imageField,''));
  await db.exec(read('supabase-assisted-order-images.sql'));await db.exec(read('supabase-assisted-order-images.sql'));
  await db.exec("insert into public.product_images values(1,1,'products/test-primary.webp',true,true,0),(2,1,'products/inactive.webp',false,true,-1)");
  assert.deepEqual(await one("select pg_get_functiondef('public.allocate_inventory_for_paid_order(text,jsonb)'::regprocedure) as allocate,pg_get_functiondef('public.release_inventory_for_order(text)'::regprocedure) as release"),originalInventory);
  for(const [name,value] of Object.entries(await one(read('supabase-assisted-order-benefits-verify.sql'))))assert.equal(value,true,name);
  assert.equal((await one("select pg_get_functiondef('public.quote_order_pricing_discount_v2(jsonb,text,text,text)'::regprocedure) as f")).f,discountSource);
  const p={...base,apply_automatic:true,coupon_code:'',shopping_credit_amount:300};
  const quote=payload=>db.query('select public.quote_assisted_order($1::jsonb) as q',[JSON.stringify(payload)]).then(r=>r.rows[0].q);
  assert.equal((await quote(p)).items[0].image_storage_path,'products/test-primary.webp');
  await db.exec(`insert into public.promotions(id,name,benefit_type,activation_type,discount_rate) values
    ('10000000-0000-4000-8000-000000000001','自動九折','percentage_discount','automatic',0.9);
    insert into public.promotions(id,name,benefit_type,activation_type,threshold_value,gift_variant_id,gift_quantity) values
    ('10000000-0000-4000-8000-000000000002','滿額贈','amount_gift','automatic',900,1,1);
    insert into public.promotion_scopes(promotion_id,scope_role,target_type)
    select id,scope,'all_regular' from public.promotions cross join (values('qualification'),('benefit')) as roles(scope);
  `);
  const q=await quote(p);assert.equal(q.subtotal,1000);assert.equal(q.discount,100);assert.equal(q.shipping,120);
  assert.equal(q.payment_amount,720);assert.equal(q.items.length,2);assert.equal(q.items[1].line_type,'gift');
  const off=await quote({...p,apply_automatic:false});assert.equal(off.discount,0);assert.equal(off.items.length,1);
  await assert.rejects(quote({...p,shopping_credit_amount:901}),/購物金/);
  await assert.rejects(quote({...p,customer_type:'guest',member_id:null}),/訪客/);
  await assert.rejects(quote({...p,shipping_mode:'free',shopping_credit_amount:900}),/購物金/);
  const created=await create('12345678-1234-4234-8234-123456789001',p);
  const order=await one('select * from public.orders where id=$1',[created.order_id]);
  assert.equal(order.total,'1020');assert.equal(order.discount,'100');assert.equal(order.payment_amount,'720');
  assert.equal(order.shopping_credit_amount,300);assert.equal(order.items.length,2);
  assert.equal((await one('select available_balance,reserved_balance from public.shopping_credit_accounts')).available_balance,1700);
  assert.equal((await one('select stock,gift_stock from public.product_variants where id=1')).stock,18);
  assert.equal((await one('select stock,gift_stock from public.product_variants where id=1')).gift_stock,5);
  assert.equal((await one('select status from public.promotion_gift_reservations where order_id=$1',[created.order_id])).status,'reserved');
  await create('12345678-1234-4234-8234-123456789001',p);
  assert.equal((await one("select count(*)::integer n from public.shopping_credit_ledger where event_type='reserve'")).n,1);
  const access=(await one('select public.authorize_assisted_link($1,$2) as a',[created.order_id,created.link_token])).a;
  await assert.rejects(db.query('select public.claim_order_payment($1,$2)',[created.order_id,access.payment_token]),/同意/);
  await assert.rejects(db.query('select public.begin_order_payment_retry($1)',[created.order_id]),/同意/);
  await assert.rejects(db.query('select public.confirm_assisted_credit_consent($1,$2,$3)',[created.order_id,created.link_token,1]),/金額/);
  await assert.rejects(db.query('select public.confirm_assisted_credit_consent($1,$2,$3)',[created.order_id,'b'.repeat(64),300]),/Invalid/);
  await db.query('select public.confirm_assisted_credit_consent($1,$2,$3)',[created.order_id,created.link_token,300]);
  await db.query('select public.confirm_assisted_credit_consent($1,$2,$3)',[created.order_id,created.link_token,300]);
  assert.ok((await one('select public.authorize_assisted_link($1,$2) as a',[created.order_id,created.link_token])).a.credit_consent_at);
  const claim=(await one('select public.claim_order_payment($1,$2) as a',[created.order_id,access.payment_token])).a;assert.equal(claim.total,720);
  await db.query("update public.orders set status='paid' where id=$1",[created.order_id]);
  assert.equal((await one('select gift_stock from public.product_variants where id=1')).gift_stock,4);
  assert.equal((await one('select count(*)::integer n from public.order_inventory_allocations where order_id=$1',[created.order_id])).n,2);
  await db.query("update public.orders set status='paid' where id=$1",[created.order_id]);
  assert.equal((await one('select gift_stock from public.product_variants where id=1')).gift_stock,4);
  await db.query("update public.orders set status='cancelled' where id=$1",[created.order_id]);
  await db.query("update public.orders set status='cancelled' where id=$1",[created.order_id]);
  assert.equal((await one('select available_balance,reserved_balance from public.shopping_credit_accounts')).available_balance,2000);
  assert.equal((await one('select gift_stock from public.product_variants where id=1')).gift_stock,5);
  assert.equal((await one("select count(*)::integer n from public.shopping_credit_ledger where event_type='refund'")).n,1);
  // Unpaid cancellation releases (rather than refunds) once.
  const unpaid=await create('12345678-1234-4234-8234-123456789002',p);
  await db.query("update public.orders set status='cancelled' where id=$1",[unpaid.order_id]);
  await db.query("update public.orders set status='cancelled' where id=$1",[unpaid.order_id]);
  assert.equal((await one('select available_balance from public.shopping_credit_accounts')).available_balance,2000);
  assert.equal((await one("select count(*)::integer n from public.shopping_credit_ledger where event_type='release'")).n,1);
  // Member-targeted coupons use the customer, not the logged-in administrator.
  await db.exec(`insert into public.coupon_campaigns(id,name,code,code_normalized,audience_mode,audience_roles,allow_guest,stacking_policy,per_member_limit)
    values('20000000-0000-4000-8000-000000000001','客戶專用','ONLY','ONLY','members','{}',false,'allow_all',1);
    insert into public.coupon_campaign_members(coupon_campaign_id,user_id) values('20000000-0000-4000-8000-000000000001','${base.member_id}');
    insert into public.promotions(id,name,benefit_type,activation_type,discount_amount) values('10000000-0000-4000-8000-000000000003','折50','fixed_discount','coupon_only',50);
    insert into public.coupon_promotions(promotion_id,coupon_campaign_id) values('10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001');
    insert into public.promotion_scopes(promotion_id,scope_role,target_type) values('10000000-0000-4000-8000-000000000003','qualification','all_regular'),('10000000-0000-4000-8000-000000000003','benefit','all_regular');
  `);
  const coupon={...p,coupon_code:'only'};
  assert.equal((await quote(coupon)).discount,150);
  assert.equal((await quote({...coupon,apply_automatic:false})).discount,50);
  await assert.rejects(quote({...coupon,customer_type:'guest',member_id:null,shopping_credit_amount:0}),/優惠碼/);
  const couponOrder=await create('12345678-1234-4234-8234-123456789003',coupon);
  assert.equal((await one('select user_id from public.coupon_redemptions where order_id=$1',[couponOrder.order_id])).user_id,base.member_id);
  await assert.rejects(create('12345678-1234-4234-8234-123456789004',coupon),/使用次數|上限/);
  // Validation errors roll back the whole order and any early inventory mutation.
  const count=(await one('select count(*)::integer n from public.orders')).n;
  await assert.rejects(create('12345678-1234-4234-8234-123456789005',{...p,minimum_reason:''}),/最低訂購額/);
  assert.equal((await one('select count(*)::integer n from public.orders')).n,count);
  await db.query("update public.orders set status='cancelled' where id=$1",[couponOrder.order_id]);
  assert.equal((await one('select status from public.coupon_redemptions where order_id=$1',[couponOrder.order_id])).status,'released');
  assert.equal((await quote(coupon)).discount,150); // Released coupon quota can be used again.
  // Confirmation drift rolls back, instead of silently dropping a promised gift.
  const expected=(await quote(p)).confirmation;
  await db.exec('update public.product_variants set gift_stock=0 where id=1');
  await assert.rejects(create('12345678-1234-4234-8234-123456789006',{...p,expected_quote:expected}),/已變動/);
  assert.equal((await one('select count(*)::integer n from public.orders')).n,count);
  await db.exec('update public.product_variants set gift_stock=5 where id=1');
  const minimum={...p,shipping_mode:'free',shipping_reason:'核准免運',shopping_credit_amount:899};
  assert.equal((await quote(minimum)).payment_amount,1);
  const oneDollar=await create('12345678-1234-4234-8234-123456789007',minimum);
  assert.equal((await one('select payment_amount from public.orders where id=$1',[oneDollar.order_id])).payment_amount,'1');
  await db.query("update public.orders set status='cancelled' where id=$1",[oneDollar.order_id]);
  await db.exec(`insert into public.promotions(id,name,benefit_type,activation_type,discount_rate) values
    ('10000000-0000-4000-8000-000000000004','舊式八折','legacy_discount','automatic',0.8);`);
  assert.equal((await quote(coupon)).discount,250);
  const legacy=await create('12345678-1234-4234-8234-123456789008',coupon);
  assert.equal((await one('select discount from public.orders where id=$1',[legacy.order_id])).discount,'250');
  await db.query("update public.orders set status='cancelled' where id=$1",[legacy.order_id]);
  // Old clients remain no-benefit orders during a staged SQL/API/UI rollout.
  const oldClient=await create('12345678-1234-4234-8234-123456789009',base);
  assert.equal((await one('select discount,shopping_credit_amount from public.orders where id=$1',[oldClient.order_id])).discount,'0');
  await db.query("update public.orders set status='cancelled' where id=$1",[oldClient.order_id]);
  // A restricted order editor cannot use or discover monetary wallet balances.
  await db.exec("create or replace function public.has_backoffice_permission(p text) returns boolean language sql as $$select p<>'shopping_credit.manage'$$");
  await assert.rejects(quote(p),/permission/);
  assert.equal((await quote({...p,shopping_credit_amount:0})).available_credit,0);
  await db.exec("create or replace function public.has_backoffice_permission(p text) returns boolean language sql as $$select true$$");
  // Some installations have not deployed append-order groups yet. Both source
  // quote versions must work, without requiring that unrelated migration.
  await db.exec(fn('supabase-coupon-discount-engine.sql','quote_order_pricing_discount_v2'));
  await db.exec(migration);
  assert.equal((await quote(p)).discount,200);
  assert.equal((await quote({...p,apply_automatic:false})).discount,0);
  // Normal storefront shopping-credit payments do not require assisted consent.
  await db.exec(`select set_config('app.eclado_order_shopping_credit_amount','50',false);
    insert into public.orders(id,user_id,type,items,subtotal,discount,total,status,payment_due_at,order_source)
    values('normal-credit-guard','${base.member_id}','instructor','[]',1000,0,1120,'unpaid',now()+interval '1 day','online');
    select set_config('app.eclado_order_shopping_credit_amount','0',false);
    insert into public.order_payment_authorizations(order_id,token_hash) values('normal-credit-guard',encode(extensions.digest('normal-token','sha256'),'hex'));
  `);
  await db.query('select public.reserve_order_shopping_credit($1,$2,$3)',[base.member_id,'normal-credit-guard',50]);
  assert.equal((await one("select public.claim_order_payment('normal-credit-guard','normal-token') as a")).a.total,1070);
  // Gift-aware installations also remain supported; neither original function
  // is overwritten by the assisted migration in either version.
  await db.exec(fn('supabase-promotion-gifts-engine.sql','allocate_inventory_for_paid_order'));
  await db.exec(fn('supabase-promotion-gifts-engine.sql','release_inventory_for_order'));
  const giftAwareInventory=await one("select pg_get_functiondef('public.allocate_inventory_for_paid_order(text,jsonb)'::regprocedure) as allocate,pg_get_functiondef('public.release_inventory_for_order(text)'::regprocedure) as release");
  await db.exec(migration);
  assert.deepEqual(await one("select pg_get_functiondef('public.allocate_inventory_for_paid_order(text,jsonb)'::regprocedure) as allocate,pg_get_functiondef('public.release_inventory_for_order(text)'::regprocedure) as release"),giftAwareInventory);
  const giftStock=(await one('select gift_stock from public.product_variants where id=1')).gift_stock;
  const compatible=await create('12345678-1234-4234-8234-123456789010',p);
  await db.query("update public.orders set status='paid' where id=$1",[compatible.order_id]);
  assert.equal((await one('select gift_stock from public.product_variants where id=1')).gift_stock,giftStock-1);
  await db.query("update public.orders set status='cancelled' where id=$1",[compatible.order_id]);
  assert.equal((await one('select gift_stock from public.product_variants where id=1')).gift_stock,giftStock);
  // Add staff minimum without touching shipping-group eligibility or old orders.
  const priorOrders=(await db.query('select id,total,status,items from public.orders order by id')).rows;
  const staffMinimum=read('supabase-internal-staff-order-minimum.sql');
  await db.exec(staffMinimum);await db.exec(staffMinimum);
  assert.deepEqual((await db.query('select id,total,status,items from public.orders order by id')).rows,priorOrders);
  await db.exec(`update public.profiles set role='staff';update public.promotions set active=false;
    create or replace function public.quote_order_pricing(p_items jsonb,p_fulfillment_method text) returns jsonb language sql as $$
      select jsonb_build_object('member_role','staff','subtotal',coalesce((p_items->0->>'amount')::numeric,5000),
        'discount',coalesce(nullif(current_setting('test.discount',true),'')::numeric,0),
        'promotion_id','10000000-0000-4000-8000-000000000001','promotion_name','測試折扣',
        'items',jsonb_build_array(jsonb_build_object('product_id',1,'variant_id',1,'qty',1,'line_total',coalesce((p_items->0->>'amount')::numeric,5000))))
    $$;
    create or replace function public.get_my_appendable_shipping_group() returns jsonb language plpgsql as $$begin raise exception 'staff must not request shipping group';end$$;
  `);
  for(const source of ['supabase-coupon-discount-engine.sql','supabase-professional-shipping-groups.sql']){
    await db.exec(fn(source,'quote_order_pricing_discount_v2'));
    await db.exec(staffMinimum);await db.exec(staffMinimum);
    const storefront=amount=>db.query("select public.quote_order_pricing_discount_v2($1::jsonb,'delivery','','') as q",[JSON.stringify([{amount}])]).then(r=>r.rows[0].q);
    await db.exec("select set_config('test.discount','0',false)");
    await assert.rejects(storefront(4999),/5,000/);
    const exact=await storefront(5000);assert.equal(exact.shipping,0);assert.equal(exact.total,5000);
    assert.equal(exact.is_additional_order||false,false);
    await db.exec("select set_config('test.discount','500',false)");await assert.rejects(storefront(5000),/5,000/);
    assert.equal((await storefront(5500)).total,5000);
  }
  const staffPayload={...p,shopping_credit_amount:0,apply_automatic:false,minimum_reason:'',items:[{product_id:1,variant_id:1,qty:1,unit_price:4999}]};
  await assert.rejects(create('12345678-1234-4234-8234-123456789011',staffPayload),/最低訂購額/);
  const staffException=await create('12345678-1234-4234-8234-123456789012',{...staffPayload,minimum_reason:'管理員核准'});
  assert.equal((await one('select total from public.orders where id=$1',[staffException.order_id])).total,'4999');
  await db.query("update public.orders set status='cancelled' where id=$1",[staffException.order_id]);
  const staffExact=await create('12345678-1234-4234-8234-123456789013',{...staffPayload,shopping_credit_amount:1000,items:[{product_id:1,variant_id:1,qty:1,unit_price:5000}]});
  assert.equal((await one('select total from public.orders where id=$1',[staffExact.order_id])).total,'5000');
  assert.equal(Number((await one('select payment_amount from public.orders where id=$1',[staffExact.order_id])).payment_amount),4000);
  await db.query("update public.orders set status='cancelled' where id=$1",[staffExact.order_id]);
  await db.exec("update public.promotions set active=true where id='10000000-0000-4000-8000-000000000003'");
  const staffCoupon={...staffPayload,coupon_code:'ONLY',items:[{product_id:1,variant_id:1,qty:1,unit_price:5000}]};
  await assert.rejects(create('12345678-1234-4234-8234-123456789014',staffCoupon),/最低訂購額/);
  const staffCouponExact=await create('12345678-1234-4234-8234-123456789015',{...staffCoupon,items:[{product_id:1,variant_id:1,qty:1,unit_price:5050}]});
  assert.equal((await one('select total from public.orders where id=$1',[staffCouponExact.order_id])).total,'5000');
  await db.query("update public.orders set status='cancelled' where id=$1",[staffCouponExact.order_id]);
  console.log('PASS assisted benefits: real custom-price discount/gift/coupon/credit engines, consent and cancellation');
};
