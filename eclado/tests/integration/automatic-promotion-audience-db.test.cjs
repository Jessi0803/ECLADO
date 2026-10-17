// Isolated PostgreSQL/WASM; no Supabase credentials or external writes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const read = file => fs.readFileSync(path.resolve(__dirname,'../..',file),'utf8');
function fn(file,name) {
  const s=read(file), start=s.indexOf(`create or replace function public.${name}(`);
  assert(start>=0,name); return s.slice(start,s.indexOf('$$;',s.indexOf('as $$',start))+3);
}
test('automatic audience: real pricing, gifts, assisted identity, atomic saves and rerun', {skip:!process.env.PGLITE_MODULE}, async()=>{
  const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);
  const db=new PGlite(), member='11111111-1111-4111-8111-111111111111';
  const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth; create schema extensions;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create function public.has_backoffice_permission(text) returns boolean language sql as $$select current_setting('test.admin',true)='yes'$$;
      create table public.profiles(id uuid primary key,role text);
      insert into public.profiles values('${member}','consumer');
      create table public.membership_tiers(role text,active boolean,professional_price_multiplier numeric,can_buy_pro_products boolean);
      insert into public.membership_tiers values('consumer',true,null,false),('pro',true,1,true),('instructor',true,1,true),('distributor',true,1,true),('staff',true,1,true);
      create table public.products(id integer primary key,name text,name_zh text,publication_status text,active boolean default true,
        apply_tier_multiplier boolean,is_pro_only boolean,image_url text,category text,series text);
      insert into public.products values(1,'Test','測試商品','active',true,true,false,null,'test','test');
      create table public.product_variants(id bigint primary key,product_id integer,sku text,size text,price numeric,pro_price numeric,stock integer,
        active boolean,is_default boolean,sort_order integer,is_custom_order boolean,gift_stock integer,gift_enabled boolean);
      insert into public.product_variants values(1,1,'SKU','100ml',1000,1000,100,true,true,0,false,100,true);
      create table public.product_images(product_id integer,storage_path text,active boolean,is_primary boolean,sort_order integer,id bigint);
      create table public.promotions(id uuid primary key default gen_random_uuid(),name text,description text,product_ids integer[] default array[1],
        discount_rate numeric default 1,discount_amount numeric default 0,discount_order text default 'rate_then_amount',
        active boolean default true,benefit_type text,activation_type text default 'automatic',archived_at timestamptz,start_at timestamptz,end_at timestamptz,
        created_at timestamptz default now(),priority integer default 100,threshold_value numeric,threshold_type text default 'amount',threshold_basis text,
        gift_variant_id bigint,gift_quantity integer,repeat_mode text default 'once');
      create table public.coupon_campaign_members(coupon_campaign_id uuid,user_id uuid);
      create table public.coupon_promotions(id bigint,promotion_id uuid,coupon_campaign_id uuid,sort_order integer);
      create table public.coupon_redemptions(coupon_campaign_id uuid,status text,expires_at timestamptz,user_id uuid,guest_identity_hash text);
      create table public.promotion_gift_reservations(product_variant_id bigint,status text,expires_at timestamptz,quantity integer);
      create function public.calculate_order_shipping(jsonb) returns numeric language sql as $$select 120::numeric$$;
      create function public.get_my_appendable_shipping_group() returns jsonb language sql as $$select null::jsonb$$;
      create function public.coupon_campaign_allows_identity(uuid,text) returns boolean language sql as $$select true$$;
    `);
    const foundation=read('supabase-promotions-coupons-foundation.sql');
    await db.exec(foundation.slice(foundation.indexOf('create table if not exists public.promotion_scopes'),foundation.indexOf('create or replace function public.normalize_coupon_campaign_code')));
    for(const [file,name] of [
      ['supabase-promotion-pricing-engine.sql','quote_order_pricing'],
      ['supabase-professional-shipping-groups.sql','quote_order_pricing_discount_v2'],
      ['supabase-promotion-gifts-engine.sql','promotion_item_matches_scope'],
      ['supabase-promotion-gifts-engine.sql','quote_order_pricing'],
      ['supabase-promotion-gifts-engine.sql','save_discount_promotion'],
    ]) await db.exec(fn(file,name));
    const assisted=read('supabase-assisted-order-benefits.sql');
    await db.exec('create table public.assisted_order_requests(id integer)');
    await db.exec(assisted.slice(0,assisted.indexOf('create or replace function public.quote_assisted_order'))+'\ncommit;');
    await db.exec(fn('supabase-assisted-order-benefits.sql','quote_assisted_order'));
    await db.exec("insert into public.promotions(name,benefit_type,discount_rate) values('Legacy','legacy_discount',0.95)");
    const migration=read('supabase-automatic-promotion-audience.sql');
    await db.exec(migration); await db.exec(migration);
    const legacy=await one("select * from public.promotions where name='Legacy'");
    assert.deepEqual(legacy.audience_roles,['consumer','pro','instructor','distributor','staff']); assert.equal(legacy.allow_guest,true);
    await db.exec("select set_config('test.admin','yes',false)");
    const save=p=>one('select public.save_discount_promotion($1::jsonb) id',[JSON.stringify(p)]);
    const config={name:'Pro discount',benefit_type:'percentage_discount',activation_type:'automatic',scope_type:'all_regular',discount_rate:0.9,audience_roles:['pro','instructor'],allow_guest:false};
    const {id:discount}=await save(config);
    const {id:gift}=await save({...config,name:'Pro gift',benefit_type:'quantity_gift',threshold_value:1,gift_variant_id:1,gift_quantity:1});
    const items=[{product_id:1,variant_id:1,qty:10}];
    const quote=async()=>(await one("select public.quote_order_pricing($1::jsonb,'delivery','','') q",[JSON.stringify(items)])).q;
    assert.equal((await quote()).discount,500); assert.equal((await quote()).gifts.length,0);
    await db.exec(`select set_config('test.uid','${member}',false)`);
    for(const role of ['consumer','pro','instructor','distributor','staff']) {
      await db.query('update public.profiles set role=$1',[role]); const q=await quote();
      assert.equal(q.discount,['pro','instructor'].includes(role)?1000:500,role);
      assert.equal(q.gifts.length,['pro','instructor'].includes(role)?1:0,role);
    }
    await db.query("update public.promotions set audience_roles=array['pro'],allow_guest=false where id=$1",[legacy.id]);
    assert.equal((await quote()).discount,0);
    const base={items:[{product_id:1,variant_id:1,qty:10,line_total:10000}],subtotal:10000,discount:0,member_role:'pro'};
    const aq=async(customer,role,automatic=true)=>(await one("select public.assisted_gift_quote($1::jsonb,'delivery','','',$2::uuid,$3) q",[JSON.stringify({...base,member_role:role}),customer,automatic])).q;
    assert.equal((await aq(member,'pro')).discount,1000); assert.equal((await aq(member,'pro')).gifts.length,1);
    assert.equal((await aq(member,'consumer')).discount,0); assert.equal((await aq(null,'consumer')).gifts.length,0);
    assert.equal((await aq(member,'pro',false)).discount,0);
    await save({...config,id:discount,audience_roles:[],allow_guest:true});
    await db.exec("select set_config('test.uid','',false)"); assert.equal((await quote()).discount,1000);
    await db.exec(`select set_config('test.uid','${member}',false)`); assert.equal((await quote()).discount,0);
    const old={...config,id:discount}; delete old.audience_roles; delete old.allow_guest; await save(old);
    assert.deepEqual((await one('select audience_roles from public.promotions where id=$1',[discount])).audience_roles,[]);
    for(const fields of [{audience_roles:[],allow_guest:false},{audience_roles:['admin']},{audience_roles:[null]},{allow_guest:'false'},{audience_roles:null}]) await assert.rejects(save({...config,id:discount,name:'Must roll back',...fields}));
    assert.equal((await one('select name from public.promotions where id=$1',[discount])).name,config.name);
    // Rebuilt assisted engines inherit storefront predicates: rebind to customer.
    await db.exec(assisted.slice(0,assisted.indexOf('create or replace function public.quote_assisted_order'))+'\ncommit;');
    await db.exec(migration);
    assert.equal((await aq(member,'pro')).gifts.length,1);
    assert.equal((await aq(member,'consumer')).gifts.length,0);
    await db.exec(fn('supabase-promotion-gifts-engine.sql','save_discount_promotion'));
    await db.exec(migration);
    await save({...config,id:discount,audience_roles:['pro'],allow_guest:false});
    await db.exec("update public.profiles set role='pro'");
    await db.query("update public.promotions set benefit_type='fixed_discount',discount_amount=300 where id=$1",[discount]);
    await db.query("update public.promotions set benefit_type='amount_gift',threshold_type='amount',threshold_value=5000 where id=$1",[gift]);
    assert.equal((await quote()).discount,500); // Eligible legacy 5% beats fixed 300.
    assert.equal((await quote()).gifts.length,1);
    await db.exec("update public.profiles set role='consumer'");
    assert.equal((await quote()).discount,0); assert.equal((await quote()).gifts.length,0);
    // Coupon-only audiences remain governed by the campaign, not the activity.
    await db.exec(`insert into public.coupon_campaigns(id,name,code,code_normalized,stacking_policy)
      values('22222222-2222-4222-8222-222222222222','Coupon','ONLY','ONLY','coupon_only')`);
    await db.query("update public.promotions set activation_type='coupon_only' where id=any($1::uuid[])",[[discount,gift]]);
    await db.query("insert into public.coupon_promotions(id,promotion_id,coupon_campaign_id,sort_order) values(1,$1,'22222222-2222-4222-8222-222222222222',0),(2,$2,'22222222-2222-4222-8222-222222222222',1)",[discount,gift]);
    const coupon=(await one("select public.quote_order_pricing($1::jsonb,'delivery','ONLY','') q",[JSON.stringify(items)])).q;
    assert.equal(coupon.discount,300); assert.equal(coupon.gifts.length,1);
    await db.exec("select set_config('test.admin','no',false)"); await assert.rejects(save(config),/management access/);
    const acl=await one("select has_function_privilege('authenticated','public.automatic_promotion_allows_identity(uuid,text,uuid)','execute') helper,has_function_privilege('authenticated','public.save_discount_promotion_before_audience_20261017(jsonb)','execute') editor");
    assert.equal(acl.helper,false); assert.equal(acl.editor,false);
  } finally {await db.close();}
});
