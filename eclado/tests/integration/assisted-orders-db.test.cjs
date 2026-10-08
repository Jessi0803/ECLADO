const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../..');const read=name=>fs.readFileSync(path.join(root,name),'utf8');
function fn(file,name){const source=read(file);const start=source.indexOf(`create or replace function public.${name}(`);assert.ok(start>=0);return source.slice(start,source.indexOf('$$;',source.indexOf('as $$',start))+3);}
test('assisted SQL: atomic creation/recovery, owner/roles, immutable snapshots, reservation/payment/cancel/count', {skip:!process.env.PGLITE_MODULE},async()=>{
  const moduleUrl=pathToFileURL(process.env.PGLITE_MODULE);
  const {PGlite}=await import(moduleUrl.href);const {pgcrypto}=await import(new URL('./contrib/pgcrypto.js',moduleUrl).href);
  const db=new PGlite({extensions:{pgcrypto}});
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema extensions;
      create extension pgcrypto with schema extensions;
      create table auth.users(id uuid primary key);
      insert into auth.users values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create function auth.role() returns text language sql as $$select coalesce(nullif(current_setting('test.role',true),''),'authenticated')$$;
      create function auth.jwt() returns jsonb language sql as $$select '{"email":"admin@example.test"}'::jsonb$$;
      create function public.has_backoffice_permission(p text) returns boolean language sql as $$select current_setting('test.access',true)='admin'$$;
      create table public.profiles(id uuid primary key,role text);
      create table public.admin_users(user_id uuid,active boolean,role text);
      insert into public.admin_users values ('11111111-1111-4111-8111-111111111111',true,'super_admin');
      insert into public.profiles values ('22222222-2222-4222-8222-222222222222','instructor');
      create table public.membership_tiers(role text primary key,professional_price_multiplier numeric,active boolean default true);
      insert into public.membership_tiers values ('instructor',0.7,true),('staff',0.5,true);
      create table public.products(id integer primary key,name_zh text,stock integer,is_pro_only boolean default false,active boolean default true,publication_status text default 'active',
        instructor_price_multiplier numeric,distributor_price_multiplier numeric,staff_price_multiplier numeric);
      insert into public.products(id,name_zh,stock) values (1,'商品',10);
      create table public.product_variants(id bigint primary key,product_id integer references public.products(id),sku text,size text,stock integer,is_default boolean,active boolean default true,
        sort_order integer default 0,price numeric,pro_price numeric,is_custom_order boolean default false,gift_stock integer default 5,gift_enabled boolean default false);
      insert into public.product_variants(id,product_id,sku,size,stock,is_default,price,pro_price) values (1,1,'A','100ml',10,true,1000,800),(2,1,'B','200ml',4,false,2000,1600);
      create table public.orders(id text primary key,user_id uuid,member text,type text,items jsonb,subtotal numeric,discount numeric,total numeric,payment_amount numeric,shopping_credit_amount bigint,
        status text,date text,address text,phone text,email text,note text,fulfillment_method text,invoice_type text,invoice_company_name text,invoice_tax_id text,invoice_number text,
        pricing_snapshot jsonb,order_source text default 'online',payment_due_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now(),
        shipping_group_id uuid,promotion_id uuid,promotion_name text,coupon_campaign_id uuid,coupon_name text,coupon_code_mask text,
        public_lookup_code text default 'ABCDE-12345',constraint orders_order_source_check check(order_source in ('online','historical_manual')));
      create table public.order_payment_authorizations(order_id text primary key references public.orders(id),token_hash text,provider_order_no text,attempt_no integer,claimed_at timestamptz,gateway_created_at timestamptz);
      create table public.order_payment_instructions(order_id text primary key,payment_state text,payment_method text,attempt_no integer,provider_order_no text);
      create table public.order_payment_attempts(order_id text,provider_order_no text unique,attempt_no integer,payment_method text,payment_state text);
      create table public.backoffice_role_permissions(role text,permission text,constraint backoffice_role_permissions_permission_check check(permission in ('orders.write')));
      create table public.promotion_gift_reservations(id uuid,order_id text,promotion_id uuid,product_variant_id bigint,status text,expires_at timestamptz,quantity integer,consumed_at timestamptz);
      select set_config('test.uid','11111111-1111-4111-8111-111111111111',false);select set_config('test.access','admin',false);
    `);
    const allocation=read('supabase-order-inventory-allocation.sql');
    await db.exec(allocation.slice(allocation.indexOf('create table'),allocation.indexOf('create or replace function public.order_consumes_inventory')));
    await db.exec("alter table public.order_inventory_allocations add column line_type text default 'merchandise', add column promotion_id uuid, add column coupon_campaign_id uuid;");
    for(const name of ['order_consumes_inventory','sync_product_stock_mirror','release_inventory_for_order','close_backorders_for_fulfillment','sync_inventory_allocation_for_order']) await db.exec(fn('supabase-order-inventory-allocation.sql',name));
    await db.exec(fn('supabase-promotion-gifts-engine.sql','allocate_inventory_for_paid_order'));
    await db.exec(fn('supabase-member-pricing.sql','resolve_product_price_multiplier'));
    await db.exec(fn('supabase-shopping-credit-checkout.sql','protect_order_pricing_snapshot'));
    await db.exec(fn('supabase-payment-retry.sql','begin_order_payment_retry'));
    await db.exec(fn('supabase-shopping-credit-checkout.sql','claim_order_payment'));
    await db.exec('create trigger pricing_lock before update on public.orders for each row execute function public.protect_order_pricing_snapshot();');
    await db.exec(read('supabase-inventory-counts.sql'));
    // The actual combined-shipping function is patched but would fail below the
    // minimum if the assisted early-return were missing. Test its runtime path.
    await db.exec(fn('supabase-professional-shipping-groups.sql','prepare_shipping_group_for_order_status'));
    await db.exec('create trigger shipping_prepare before update of status on public.orders for each row execute function public.prepare_shipping_group_for_order_status();');
    const migration=read('supabase-assisted-orders.sql');await db.exec(migration);
    await db.exec("alter table public.orders drop constraint orders_assisted_payment_method_check;alter table public.orders add constraint orders_assisted_payment_method_check check(assisted_payment_method in ('card','atm'))");
    await db.exec(migration); // Upgrade the original card/ATM-only installation.
    const verification=(await db.query(read('supabase-assisted-orders-verify.sql'))).rows[0];
    for(const [name,value] of Object.entries(verification))assert.equal(value,true,name);
    const base={customer_type:'member',member_id:'22222222-2222-4222-8222-222222222222',member:'客戶',phone:'0911111111',email:'customer@example.test',address:'台北市測試路',note:'客戶備註',
      payment_method:'atm',fulfillment_method:'delivery',invoice_type:'company',invoice_company_name:'測試公司',invoice_tax_id:'62076004',shipping_mode:'default',shipping_amount:null,
      shipping_reason:'',minimum_reason:'特殊報價',items:[{product_id:1,variant_id:1,qty:2,unit_price:500}]};
    const create=(key,payload=base)=>db.query('select public.create_assisted_order($1::uuid,$2::jsonb) as result',[key,JSON.stringify(payload)]).then(data=>data.rows[0].result);
    const one=async sql=>(await db.query(sql)).rows[0];
    const key='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';const created=await create(key);assert.ok(created.order_id);assert.equal(created.link_token.length,64);
    const order=await one(`select * from public.orders where id='${created.order_id}'`);
    assert.equal(order.user_id,base.member_id);assert.equal(order.status,'awaiting_confirm');assert.equal(order.total,'1120');assert.equal(order.items[0].unit_price,500);
    assert.equal((await one('select stock from public.product_variants where id=1')).stock,8);
    assert.equal((await one('select count(*)::integer as n from public.order_inventory_allocations')).n,1);
    const recovered=await create(key);assert.equal(recovered.order_id,created.order_id);assert.equal(recovered.recovered,true);
    assert.equal((await one('select stock from public.product_variants where id=1')).stock,8);
    await assert.rejects(create(key,{...base,items:[{...base.items[0],unit_price:900}]}),/內容不同/);
    await assert.rejects(create('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',{...base,minimum_reason:''}),/最低訂購額/);
    await assert.rejects(create('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',{...base,shipping_mode:'free'}),/運費異動/);
    await assert.rejects(create('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',{...base,shopping_credit_amount:100}),/payload/);
    await assert.rejects(create('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',{...base,items:[{...base.items[0],qty:9999}]}),/現貨不足/);
    assert.equal((await one('select count(*)::integer as n from public.assisted_order_requests')).n,1);
    const countId=(await one("select public.create_inventory_count('盤點') as id")).id;
    const counted=await one(`select * from public.inventory_count_items where session_id='${countId}' and product_variant_id=1 and inventory_type='sale'`);
    assert.equal(counted.expected_physical_snapshot,10);assert.equal(counted.onsite_allocated_snapshot,2);
    await db.exec(`update public.inventory_count_items set actual_quantity=expected_physical_snapshot,variance=0,counted_at=now() where session_id='${countId}'`);
    await db.query('select public.complete_inventory_count($1::uuid)',[countId]);
    assert.equal((await one('select stock from public.product_variants where id=1')).stock,8);
    await db.exec(`update public.orders set status='paid' where id='${created.order_id}'`);
    assert.equal((await one('select stock from public.product_variants where id=1')).stock,8);
    assert.equal((await one(`select shipping_group_id from public.orders where id='${created.order_id}'`)).shipping_group_id,null);
    await assert.rejects(db.exec(`update public.orders set total=1 where id='${created.order_id}'`),/immutable/);
    await assert.rejects(db.exec(`update public.orders set address='changed' where id='${created.order_id}'`),/locked/);
    await assert.rejects(db.exec(`update public.orders set fulfillment_method='onsite_pickup' where id='${created.order_id}'`),/locked/);
    await assert.rejects(db.exec(`update public.orders set date='2000-01-01' where id='${created.order_id}'`),/locked/);
    await db.exec(`update public.orders set status='cancelled' where id='${created.order_id}'`);
    assert.equal((await one('select stock from public.product_variants where id=1')).stock,10);
    await db.exec(`update public.orders set status='cancelled' where id='${created.order_id}'`);
    assert.equal((await one('select stock from public.product_variants where id=1')).stock,10);
    await assert.rejects(db.exec(`update public.orders set status='paid' where id='${created.order_id}'`),/reopened/);
    await assert.rejects(db.exec(`delete from public.orders where id='${created.order_id}'`),/audit/);
    await db.exec("select set_config('test.access','editor',false)");await assert.rejects(create(key),/authorization/);
    await db.exec("select set_config('test.access','admin',false);select set_config('test.uid','22222222-2222-4222-8222-222222222222',false)");await assert.rejects(create(key),/owner/);
    await db.exec("select set_config('test.uid','11111111-1111-4111-8111-111111111111',false)");
    const guest=await create('cccccccc-cccc-4ccc-8ccc-cccccccccccc',{...base,customer_type:'guest',member_id:null,payment_method:'card',invoice_type:'personal'});
    assert.equal((await one(`select user_id from public.orders where id='${guest.order_id}'`)).user_id,null);
    assert.equal((await one(`select status from public.orders where id='${guest.order_id}'`)).status,'unpaid');
    assert.equal((await one("select has_function_privilege('anon','public.create_assisted_order(uuid,jsonb)','execute') as allowed")).allowed,false);
    assert.equal((await one("select has_function_privilege('authenticated','public.authorize_assisted_link(text,text)','execute') as allowed")).allowed,false);
    assert.equal((await one("select has_table_privilege('authenticated','public.assisted_order_requests','select') as allowed")).allowed,false);
    await assert.rejects(db.query('select public.authorize_assisted_link($1,$2)',[guest.order_id,'0'.repeat(64)]),/Invalid/);
    const link=(await db.query('select public.authorize_assisted_link($1,$2) as result',[guest.order_id,guest.link_token])).rows[0].result;
    assert.equal(link.payment_method,'card');assert.equal(link.payment_token.length,64);
    await db.query('select public.claim_order_payment($1,$2)',[guest.order_id,link.payment_token]);
    await assert.rejects(db.query('select public.claim_order_payment($1,$2)',[guest.order_id,link.payment_token]),/progress/);
    await db.query('select public.resolve_assisted_payment_claim($1,$2,$3)',[guest.order_id,link.payment_token,'rejected']);
    await db.query('select public.claim_order_payment($1,$2)',[guest.order_id,link.payment_token]);
    await db.query('select public.resolve_assisted_payment_claim($1,$2,$3)',[guest.order_id,link.payment_token,'success']);
    await db.exec(`insert into public.order_payment_instructions values ('${guest.order_id}','failed','card',1,'${guest.order_id}')`);
    await db.query('select public.begin_order_payment_retry($1)',[guest.order_id]);
    await assert.rejects(db.query('select public.begin_order_payment_retry($1)',[guest.order_id]),/unresolved/);
    const shortageId=(await one("select public.create_inventory_count('突發盤虧') as id")).id;
    await db.exec(`update public.inventory_count_items set actual_quantity=case when product_variant_id=1 then 0 else expected_physical_snapshot end,
      variance=case when product_variant_id=1 then -expected_physical_snapshot else 0 end,counted_at=now() where session_id='${shortageId}'`);
    await db.query('select public.complete_inventory_count($1::uuid)',[shortageId]);
    const shortage=await one(`select allocated_qty,backorder_qty from public.order_inventory_allocations where order_id='${guest.order_id}'`);
    assert.equal(shortage.allocated_qty,0);assert.equal(shortage.backorder_qty,2);
    await db.exec(`update public.orders set status='cancelled' where id='${guest.order_id}'`);
    assert.equal((await one('select stock from public.product_variants where id=1')).stock,0);
    await db.exec(`select set_config('test.role','service_role',false);update public.orders set status='paid' where id='${guest.order_id}'`);
    assert.equal((await one(`select backorder_qty from public.order_inventory_allocations where order_id='${guest.order_id}'`)).backorder_qty,2);
    await db.exec(`update public.orders set status='paid' where id='${guest.order_id}'`);
    assert.equal((await one('select stock from public.product_variants where id=1')).stock,0);
    await db.exec("select set_config('test.role','authenticated',false)");
    await db.exec("insert into public.orders(id,status,items,order_source) values('normal-unpaid','unpaid','[]','online')");
    await assert.rejects(db.exec("update public.orders set order_source='admin_assisted' where id='normal-unpaid'"),/cannot become/);
    assert.equal((await one("select count(*)::integer as n from public.order_inventory_allocations where order_id='normal-unpaid'")).n,0);
    await db.exec("insert into public.product_variants(id,product_id,sku,size,stock,is_default,price,pro_price,is_custom_order) values(3,1,'C','客訂',0,false,1000,800,true)");
    const custom=await create('dddddddd-dddd-4ddd-8ddd-dddddddddddd',{...base,customer_type:'guest',member_id:null,
      fulfillment_method:'onsite_pickup',invoice_type:'personal',items:[{product_id:1,variant_id:3,qty:2,unit_price:500}]});
    assert.equal((await one(`select total from public.orders where id='${custom.order_id}'`)).total,'1000');
    assert.equal((await one(`select backorder_qty from public.order_inventory_allocations where order_id='${custom.order_id}'`)).backorder_qty,2);
    await db.exec(`update public.orders set status='cancelled' where id='${custom.order_id}'`);
    assert.equal((await one('select stock from public.product_variants where id=3')).stock,0);
    for(const [method,key] of [['apple','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'],['google','ffffffff-ffff-4fff-8fff-ffffffffffff']]){
      const wallet=await create(key,{...base,customer_type:'guest',member_id:null,payment_method:method,
        invoice_type:'personal',items:[{product_id:1,variant_id:3,qty:1,unit_price:500}]});
      const walletOrder=await one(`select status,assisted_payment_method from public.orders where id='${wallet.order_id}'`);
      assert.equal(walletOrder.status,'unpaid');assert.equal(walletOrder.assisted_payment_method,method);
      const access=(await db.query('select public.authorize_assisted_link($1,$2) as result',[wallet.order_id,wallet.link_token])).rows[0].result;
      assert.equal(access.payment_method,method);
      await db.exec(`update public.orders set status='cancelled' where id='${wallet.order_id}'`);
    }
    await db.exec(migration);assert.equal((await one('select stock from public.product_variants where id=1')).stock,0);
    console.log('PASS assisted order migration and real inventory lifecycle/count compatibility');
  }finally{await db.close();}
});
