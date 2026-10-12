const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../..');const read=name=>fs.readFileSync(path.join(root,name),'utf8');
function fn(file,name){const source=read(file);const start=source.indexOf(`create or replace function public.${name}(`);assert.ok(start>=0);return source.slice(start,source.indexOf('$$;',source.indexOf('as $$',start))+3);}
async function isolatedDb(){
  if(!process.env.EMBEDDED_POSTGRES_MODULE){
    const moduleUrl=pathToFileURL(process.env.PGLITE_MODULE);
    const {PGlite}=await import(moduleUrl.href);const {pgcrypto}=await import(new URL('./contrib/pgcrypto.js',moduleUrl).href);
    return new PGlite({extensions:{pgcrypto}});
  }
  const os=require('node:os'),net=require('node:net');
  const server=net.createServer();await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));
  const {default:EmbeddedPostgres}=await import(pathToFileURL(process.env.EMBEDDED_POSTGRES_MODULE));
  const cluster=new EmbeddedPostgres({databaseDir:fs.mkdtempSync(path.join(os.tmpdir(),'eclado-1c-pg-')),port,
    user:'postgres',password:'isolated-test-only',persistent:false,createPostgresUser:false,
    postgresFlags:['-h','127.0.0.1','-c','deadlock_timeout=100ms'],onLog:()=>{},onError:()=>{}});
  await cluster.initialise();await cluster.start();
  const connections=[];
  const connect=async()=>{const c=cluster.getPgClient('postgres','127.0.0.1');await c.connect();connections.push(c);await c.query("set statement_timeout='8s';set lock_timeout='6s'");return c;};
  const primary=await connect();
  const query=async(...args)=>{
    const result=await primary.query(...args);
    for(const part of Array.isArray(result)?result:[result])for(const field of part.fields||[]){
      if(field.dataTypeID===20)for(const row of part.rows)if(row[field.name]!==null)row[field.name]=Number(row[field.name]);
    }
    return result;
  };
  return {query,exec:sql=>query(sql),connect,
    close:async()=>{await Promise.allSettled(connections.map(c=>c.end()));await cluster.stop();}};
}
test('1C: real existing engines plus student prices and AUTO/MANUAL', {skip:!process.env.PGLITE_MODULE&&!process.env.EMBEDDED_POSTGRES_MODULE,timeout:120000},async()=>{
  const db=await isolatedDb();
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

    const base={customer_type:'member',member_id:'22222222-2222-4222-8222-222222222222',member:'隔離客戶',phone:'0911111111',email:'customer@example.test',address:'隔離地址',note:'',payment_method:'atm',fulfillment_method:'delivery',invoice_type:'personal',shipping_mode:'default',shipping_amount:null,shipping_reason:'',minimum_reason:'特殊報價',items:[{product_id:1,variant_id:1,qty:2,unit_price:500}]};
    const create=(key,payload=base)=>db.query('select public.create_assisted_order($1::uuid,$2::jsonb) as result',[key,JSON.stringify(payload)]).then(r=>r.rows[0].result);
    const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
    await require('./assisted-benefits-fixture.cjs')({db,read,fn,base,create});
    await db.exec(`alter table public.profiles add column name text;
      alter table public.products add column apply_tier_multiplier boolean default true,add column image_url text;
      alter table public.membership_tiers add column can_buy_pro_products boolean default true;
      create table public.backoffice_roles(role text primary key,active boolean);
      insert into public.backoffice_roles values('admin',true),('super_admin',true);
      create unique index permissions_key on public.backoffice_role_permissions(role,permission);
      insert into public.membership_tiers values('consumer',null,true,false),('pending',null,true,false),('pro',1,true,true),('distributor',0.65,true,true);
      update public.profiles set role='pro';
      insert into public.profiles values('33333333-3333-4333-8333-333333333333','instructor','老師');
      insert into public.profiles values('11111111-1111-4111-8111-111111111111','consumer','管理員');
      update public.product_variants set stock=100,gift_stock=20;
      update public.promotions set active=false;
      create or replace function public.get_my_appendable_shipping_group() returns jsonb language sql as $$select null::jsonb$$;
    `);
    await db.exec(fn('supabase-backoffice-permissions.sql','is_eclado_admin'));
    await db.exec(fn('supabase-promotion-pricing-engine.sql','quote_order_pricing').replace('public.quote_order_pricing(','public.quote_order_pricing_internal_20260916('));
    const memberSQL=read('supabase-member-pricing.sql');
    const patch=memberSQL.slice(memberSQL.indexOf('do $migration$'),memberSQL.indexOf('end $migration$;')+'end $migration$;'.length);
    await db.exec(patch);
    await db.exec(fn('supabase-professional-price-quote-hardening.sql','sanitize_public_order_quote'));
    await db.exec(fn('supabase-professional-price-quote-hardening.sql','quote_order_pricing'));
    await db.exec(read('supabase-instructor-student-foundation.sql'));
    const teacher='33333333-3333-4333-8333-333333333333',student=base.member_id;
    await db.query("select public.set_instructor_student_price_type($1,'student_1',0)",[teacher]);
    await db.query("select public.save_instructor_student_binding($1,$2,null,'bind')",[student,teacher]);
    const quote=payload=>db.query('select public.quote_assisted_order($1::jsonb) as q',[JSON.stringify(payload)]).then(r=>r.rows[0].q);
    const normal=async()=> (await one('select public.quote_order_pricing($1::jsonb) as q',[JSON.stringify([{product_id:1,variant_id:1,qty:10}])])).q;
    const actor=async uid=>db.query("select set_config('test.uid',$1,false)",[uid]);
    const roles=['consumer','pending','pro','instructor','distributor','staff'];
    const prior=[];
    for(const role of roles){await db.query('update public.profiles set role=$1 where id=$2',[role,student]);await actor(student);prior.push((await normal()).items[0].unit_price);}
    await actor('11111111-1111-4111-8111-111111111111');
    await db.exec(fn('supabase-coupon-discount-engine.sql','create_order_with_pricing')
      .replace('public.create_order_with_pricing(', 'public.create_order_with_pricing_discount_v2('));
    await db.exec(fn('supabase-promotion-gifts-engine.sql','create_order_with_pricing'));
    await db.exec(fn('supabase-member-invoice-order-info.sql','create_order_with_pricing'));
    await db.exec(fn('supabase-shopping-credit-checkout.sql','create_order_with_pricing'));
    await db.exec("alter table public.orders alter column payment_due_at set default(now()+interval '48 hours')");
    await db.exec(read('supabase-student-pricing-integration.sql'));
    for(let i=0;i<roles.length;i++){await db.query('update public.profiles set role=$1 where id=$2',[roles[i],student]);await actor(student);assert.equal((await normal()).items[0].unit_price,prior[i]);}
    await db.query("update public.profiles set role='pro' where id=$1",[student]);
    assert.equal((await one('select public.get_my_student_product_prices() as q')).q.enabled,false);
    await db.exec('update public.student_pricing_feature_settings set enabled=true');
    assert.equal((await normal()).items[0].unit_price,720);
    const merchandise=[{product_id:1,variant_id:1,qty:10,expected_unit_price:720}];
    const ordinaryQuote=async (items,code='')=>(await one('select public.quote_order_pricing($1::jsonb,$2,$3,$4) as q',
      [JSON.stringify(items),'delivery',code,'customer@example.test'])).q;
    const ordinaryCreate=async (items,expected,credit=0)=>(await one(`select public.create_order_with_pricing(
      $1::jsonb,'學生','隔離地址','0911111111','customer@example.test','','atm','delivery','',
      'personal',null,null,$2::bigint,$3::jsonb) as q`,[JSON.stringify(items),credit,JSON.stringify(expected)])).q;
    const confirmed=await ordinaryQuote(merchandise);
    const normalOrder=await ordinaryCreate(merchandise,confirmed,100);
    assert.equal(normalOrder.items[0].unit_price,720);
    assert.equal(Number(normalOrder.subtotal),Number(confirmed.subtotal));
    assert.equal(Number(normalOrder.payment_amount),Number(normalOrder.total)-100);
    const countBefore=(await one('select count(*)::int n from public.orders')).n;
    const creditBefore=await one('select available_balance,reserved_balance from public.shopping_credit_accounts where user_id=$1',[student]);
    await assert.rejects(ordinaryCreate(merchandise,{...confirmed,total:confirmed.total+1},100),/已變動/);
    assert.equal((await one('select count(*)::int n from public.orders')).n,countBefore);
    assert.deepEqual(await one('select available_balance,reserved_balance from public.shopping_credit_accounts where user_id=$1',[student]),creditBefore);
    await assert.rejects(ordinaryQuote([{...merchandise[0],expected_unit_price:1}]),/商品價格已更新/);
    await assert.rejects(ordinaryQuote([{product_id:1,variant_id:1,qty:6}]),/5000/);

    assert.equal((await ordinaryQuote([{product_id:1,variant_id:1,qty:30}])).shipping,0);
    for(const role of roles.filter(role=>role!=='pro')) {
      await db.query('update public.profiles set role=$1 where id=$2',[role,student]);
      assert.equal((await normal()).items[0].unit_price,prior[roles.indexOf(role)]);
      assert.equal((await one('select public.get_my_student_product_prices() as q')).q.enabled,false);
    }
    await db.query("update public.profiles set role='pro' where id=$1",[student]);
    assert.equal((await normal()).items[0].unit_price,720);
    await db.exec("update public.product_variants set pro_price=801 where id=1");
    assert.equal((await normal()).items[0].unit_price,721);
    await db.exec("update public.product_variants set pro_price=800 where id=1");
    // Promotions/coupons operate on student sale prices, with existing engines.
    await db.exec("update public.promotions set active=true where id='10000000-0000-4000-8000-000000000001'");
    const discounted=await ordinaryQuote(merchandise);
    assert.equal(discounted.subtotal,7200);assert.equal(discounted.discount,720);
    await db.exec("update public.promotions set active=false");
    await db.exec(fn('supabase-promotions-coupons-foundation.sql','coupon_campaign_allows_identity'));
    await db.exec("update public.promotions set active=true where id='10000000-0000-4000-8000-000000000003'");
    const coupon=await ordinaryQuote(merchandise,'ONLY');
    assert.equal(coupon.subtotal,7200);assert.equal(coupon.discount,50);
    await db.exec("update public.promotions set active=false");
    // Gift threshold uses discounted student merchandise; no reward data exists.
    await db.exec("update public.promotions set active=true where id='10000000-0000-4000-8000-000000000002'");
    const giftQuote=await ordinaryQuote(merchandise);
    assert.equal(giftQuote.gifts.length,1);
    await db.exec("update public.promotions set active=false");
    let catalog=(await one('select public.get_my_student_product_prices() as q')).q;
    assert.equal(catalog.prices.find(x=>x.variant_id===1).unit_price,720);
    assert.equal(catalog.prices.find(x=>x.variant_id===2).unit_price,1440);
    assert.doesNotMatch(JSON.stringify(catalog),/instructor|rebate|teacher|phone|email/);
    for(const role of ['consumer','pro']){await db.query('update public.profiles set role=$1 where id=$2',[role,teacher]);assert.equal((await normal()).items[0].unit_price,800);}
    await db.query("update public.profiles set role='instructor' where id=$1",[teacher]);
    await actor('11111111-1111-4111-8111-111111111111');
    const auto={...base,apply_automatic:false,shopping_credit_amount:0,items:[{...base.items[0],price_mode:'AUTO',unit_price:1}]};
    assert.equal((await quote(auto)).subtotal,1440);
    const manual={...auto,items:[{...auto.items[0],price_mode:'MANUAL',unit_price:777}]};
    assert.equal((await quote(manual)).subtotal,1554);
    assert.equal((await quote(base)).subtotal,1000); // Missing mode stays legacy MANUAL.
    await assert.rejects(quote({...auto,items:[{...auto.items[0],price_mode:'automatic'}]}),/price mode/);
    const price=(await quote(auto));
    const created=await create('00000000-0000-4000-8000-000000000001',{...auto,expected_quote:price.confirmation});
    const order=await one('select * from public.orders where id=$1',[created.order_id]);
    assert.equal(order.subtotal,'1440');assert.equal(order.items[0].unit_price,720);
    assert.equal((await create('00000000-0000-4000-8000-000000000001',{...auto,expected_quote:price.confirmation})).order_id,created.order_id);
    await db.query("select public.set_instructor_student_price_type($1,'student_2',1)",[teacher]);
    assert.equal((await quote(auto)).subtotal,1520);
    await assert.rejects(create('00000000-0000-4000-8000-000000000002',{...auto,expected_quote:price.confirmation}),/已變動/);
    assert.equal((await one("select count(*)::int n from public.assisted_order_requests where request_key='00000000-0000-4000-8000-000000000002'")).n,0);
    if(db.connect){
      const manager=await db.connect(),buyer=await db.connect();
      await manager.query("select set_config('test.uid','11111111-1111-4111-8111-111111111111',false);select set_config('test.access','admin',false)");
      await buyer.query("select set_config('test.uid','22222222-2222-4222-8222-222222222222',false)");
      assert.notEqual((await manager.query('select pg_backend_pid() pid')).rows[0].pid,(await buyer.query('select pg_backend_pid() pid')).rows[0].pid);
      const beforeQuote=(await buyer.query('select public.quote_order_pricing($1::jsonb) q',[JSON.stringify([{product_id:1,variant_id:1,qty:10}])])).rows[0].q;
      await manager.query('begin');
      await manager.query("select public.set_instructor_student_price_type($1,'student_1',2)",[teacher]);
      // Other backend sees only committed type_2; each quote remains homogeneous.
      assert.equal((await buyer.query('select public.quote_order_pricing($1::jsonb) q',[JSON.stringify([{product_id:1,variant_id:1,qty:10},{product_id:1,variant_id:2,qty:10}])])).rows[0].q.items[0].unit_price,760);
      await manager.query('commit');
      const currentQuote=(await buyer.query('select public.quote_order_pricing($1::jsonb) q',[JSON.stringify([{product_id:1,variant_id:1,qty:10}])])).rows[0].q;
      assert.equal(currentQuote.items[0].unit_price,720);
      await actor(student);
      const beforeCount=(await one('select count(*)::int n from public.orders')).n;
      await assert.rejects(ordinaryCreate([{product_id:1,variant_id:1,qty:10}],beforeQuote),/已變動/);
      assert.equal((await one('select count(*)::int n from public.orders')).n,beforeCount);
      await actor('11111111-1111-4111-8111-111111111111');
      await db.query("select public.set_instructor_student_price_type($1,'student_2',3)",[teacher]);
      assert.equal((await one('select deadlocks::int n from pg_stat_database where datname=current_database()')).n,0);
      console.log('PASS PostgreSQL independent manager/buyer sessions: uncommitted type isolation, stale creation rollback, no deadlocks');
    }
    await db.query("select public.save_student_pricing_settings($1::jsonb,0)",[JSON.stringify({student_1:0.9,student_2:0.94})]);
    assert.equal((await quote(auto)).subtotal,1504);
    await db.query("select public.save_student_pricing_settings($1::jsonb,1)",[JSON.stringify({student_1:0.9,student_2:0.95})]);
    await db.exec("insert into public.profiles values('44444444-4444-4444-8444-444444444444','instructor','另一老師')");
    await db.query("select public.set_instructor_student_price_type('44444444-4444-4444-8444-444444444444','student_1',0)");
    const binding=(await one('select id from public.instructor_student_bindings where student_id=$1 and ended_at is null',[student])).id;
    await db.query("select public.save_instructor_student_binding($1,'44444444-4444-4444-8444-444444444444',$2,'rebind')",[student,binding]);
    assert.equal((await quote(auto)).subtotal,1440);
    const rebound=(await one('select id from public.instructor_student_bindings where student_id=$1 and ended_at is null',[student])).id;
    await db.query("select public.save_instructor_student_binding($1,null,$2,'unbind')",[student,rebound]);
    assert.equal((await quote(auto)).subtotal,1600); // Unbound pro unaffected even ON.
    await actor(student);await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from public.student_pricing_feature_settings'),error=>error.code==='42501');
    await assert.rejects(db.query('select public.student_pricing_multiplier($1)',[student]),error=>error.code==='42501');
    await db.exec('reset role');await actor('11111111-1111-4111-8111-111111111111');
    await db.exec('update public.student_pricing_feature_settings set enabled=false');
    assert.equal((await quote(auto)).subtotal,1600);
    assert.equal((await quote(manual)).subtotal,1554);
    assert.equal((await quote(base)).subtotal,1000);
    await db.exec(read('supabase-student-pricing-integration.sql'));
    assert.equal((await one('select enabled from public.student_pricing_feature_settings')).enabled,false);
    const verified=await db.exec(read('supabase-student-pricing-integration-verify.sql'));
    for(const [key,value] of Object.entries(verified[1].rows[0].verification))assert.equal(value,true,key);
    assert.equal((await one("select has_function_privilege('authenticated','public.student_pricing_multiplier(uuid)','EXECUTE') as allowed")).allowed,false);
    assert.equal((await one("select has_table_privilege('authenticated','public.student_pricing_feature_settings','UPDATE') as allowed")).allowed,false);
    console.log('PASS 1C existing engines, OFF role regression, student variants, AUTO/MANUAL, stale rollback and recovery');
  }finally{await db.close();}
});
