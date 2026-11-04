// Isolated PostgreSQL WASM database. Never connects to a supplied database URL.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.resolve(__dirname, '../..', name), 'utf8');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function quoteSource() {
  const source = read('supabase-promotion-gifts-engine.sql');
  const start = source.indexOf('create or replace function public.quote_order_pricing(');
  return source.slice(start, source.indexOf('$$;', start) + 3);
}
test('multi gift migration: actual SQL calculation, editor, compatibility and ACL', {
  skip: !process.env.PGLITE_MODULE, timeout: 120000,
}, async t => {
  const { PGlite } = require(process.env.PGLITE_MODULE);
  const db = new PGlite();
  const query = async (sql, params=[]) => (await db.query(sql, params)).rows;
  const exec = sql => db.exec(sql);
  try {
    await exec(`create role anon; create role authenticated; create schema auth; grant usage on schema auth to authenticated;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create function public.has_backoffice_permission(text) returns boolean language sql as $$select auth.uid()='${uuid(99)}'::uuid$$;
      create table products(id integer primary key,name text,name_zh text,publication_status text);
      create table product_variants(id bigint primary key,product_id integer references products(id),sku text,size text,gift_stock integer,active boolean,gift_enabled boolean);
      create table product_images(id bigint,product_id integer,storage_path text,active boolean,is_primary boolean,sort_order integer);
      create table promotions(id uuid primary key,name text,benefit_type text,activation_type text,active boolean default true,archived_at timestamptz,start_at timestamptz,end_at timestamptz,priority integer default 100,created_at timestamptz default now(),threshold_value numeric,gift_variant_id bigint,gift_quantity integer,repeat_mode text);
      create table coupon_promotions(promotion_id uuid,coupon_campaign_id uuid,sort_order integer);
      create table promotion_gift_reservations(product_variant_id bigint,quantity integer,status text,expires_at timestamptz);
      create function public.promotion_item_matches_scope(uuid,jsonb,text) returns boolean language sql as $$select true$$;
      create function public.quote_order_pricing_discount_v2(jsonb,text,text,text) returns jsonb language sql as $$select jsonb_build_object('items',$1,'adjustments','[]'::jsonb,'pricing_snapshot',jsonb_build_object('items',$1,'coupon',jsonb_build_object('stacking_policy','allow_all')),'coupon_campaign_id',nullif($3,''))$$;
      create function public.assisted_discount_quote(jsonb,text,text,text,uuid,boolean) returns jsonb language sql as $$select public.quote_order_pricing_discount_v2($1,$2,$3,$4)$$;
      create function public.save_discount_promotion(p_payload jsonb) returns uuid language plpgsql as $$declare target uuid:=coalesce(nullif(p_payload->>'id','')::uuid,'${uuid(1)}'); begin
        insert into public.promotions(id,name,benefit_type,activation_type,threshold_value,gift_variant_id,gift_quantity,repeat_mode)
        values(target,p_payload->>'name',p_payload->>'benefit_type',p_payload->>'activation_type',(p_payload->>'threshold_value')::numeric,(p_payload->>'gift_variant_id')::bigint,(p_payload->>'gift_quantity')::integer,coalesce(p_payload->>'repeat_mode','once'))
        on conflict(id) do update set name=excluded.name,benefit_type=excluded.benefit_type,gift_variant_id=excluded.gift_variant_id,gift_quantity=excluded.gift_quantity,threshold_value=excluded.threshold_value,repeat_mode=excluded.repeat_mode;return target;end$$;
      create function public.create_assisted_order(uuid,jsonb) returns void language plpgsql as $$begin
        perform 1 from public.product_variants where id in (select gift_variant_id from public.promotions where active and benefit_type in ('amount_gift','quantity_gift')) order by id for update;
      end$$;
      insert into products values(1,'A','贈品A','active'),(2,'B','贈品B','gift_only'),(3,'C','贈品C','event_only');
      insert into product_variants values(101,1,'A','10ml',1,true,true),(102,2,'B','20ml',5,true,true),(103,3,'C','30ml',0,true,true);
      insert into promotions(id,name,benefit_type,activation_type,threshold_value,gift_variant_id,gift_quantity,repeat_mode)
        values('${uuid(1)}','舊滿額贈','amount_gift','automatic',1000,101,2,'once');`);
    const original = quoteSource();
    await exec(original);
    await exec(original.replace('public.quote_order_pricing(', 'public.assisted_gift_quote(')
      .replace('p_guest_email text\n)', 'p_guest_email text, p_customer_id uuid, p_apply_automatic boolean\n)')
      .replace('public.quote_order_pricing_discount_v2(', 'public.assisted_discount_quote(')
      .replace('p_items, p_fulfillment_method, p_coupon_code, p_guest_email\n', 'p_items, p_fulfillment_method, p_coupon_code, p_guest_email, p_customer_id, p_apply_automatic\n')
      .replace("promotion.activation_type = 'automatic'", "p_apply_automatic and promotion.activation_type = 'automatic'"));
    await exec(read('supabase-promotion-multi-gifts.sql'));
    // Re-running must not restore an edited reward or double-wrap public RPCs.
    await exec(read('supabase-promotion-multi-gifts.sql'));
    const quote = async (items=[{qty:3,line_total:3000}], code='', assisted=false) => {
      const args = [JSON.stringify(items),'delivery',code,'test@example.com'];
      if (assisted) args.push(uuid(99),true);
      const fn = assisted ? 'assisted_gift_quote' : 'quote_order_pricing';
      return (await query(`select public.${fn}($1::jsonb,$2::text,$3::text,$4::text${assisted ? ',$5::uuid,$6::boolean' : ''}) as q`,args))[0].q;
    };
    const payload = {id:uuid(1),name:'多項贈品',benefit_type:'amount_gift',activation_type:'automatic',threshold_value:1000,repeat_mode:'once',gift_rewards:[{variant_id:101,quantity:2},{variant_id:102,quantity:3},{variant_id:103,quantity:1}]};
    const save = p => query('select public.save_discount_promotion($1::jsonb)',[JSON.stringify(p)]);
    await t.test('old single gift migrates, partial quantity granted', async () => {
      const q=await quote();assert.deepEqual(q.gifts.map(g=>[g.variant_id,g.qty]),[[101,1]]);
    });
    await t.test('unauthorized save rejected', async () => { await assert.rejects(save(payload), /authorization/); });
    await query("select set_config('test.uid',$1,false)",[uuid(99)]);
    await save(payload);
    await t.test('multiple rewards cap independently and skip zero stock, storefront and assisted agree', async () => {
      for (const assisted of [false,true]) {
        const q=await quote(undefined,'',assisted);
        assert.deepEqual(q.gifts.map(g=>[g.variant_id,g.qty]),[[101,1],[102,3]]);
        assert.equal(q.adjustments.length,2); assert.deepEqual(q.items,q.pricing_snapshot.items);
      }
    });
    await t.test('below threshold gives nothing', async () => { assert.equal((await quote([{qty:1,line_total:999}])).gifts.length,0); });
    await t.test('repeat reward capped after multiplication and subtracts outstanding reservations', async () => {
      await save({...payload,repeat_mode:'repeat'});
      await exec("insert into promotion_gift_reservations values(102,2,'reserved',now()+interval '1 hour'),(101,9,'released',now()+interval '1 hour'),(102,9,'reserved',now()-interval '1 hour')");
      assert.deepEqual((await quote()).gifts.map(g=>[g.variant_id,g.qty]),[[101,1],[102,3]]);
      await exec('delete from promotion_gift_reservations');
      assert.deepEqual((await quote()).gifts.map(g=>[g.variant_id,g.qty]),[[101,1],[102,5]]);
    });
    await t.test('quantity gifts qualify by item count, not amount, and cap each reward', async () => {
      await save({...payload,benefit_type:'quantity_gift',threshold_value:3});
      assert.equal((await quote([{qty:2,line_total:10000}])).gifts.length,0);
      assert.deepEqual((await quote([{qty:3,line_total:1}])).gifts.map(g=>[g.variant_id,g.qty]),[[101,1],[102,3]]);
      await save({...payload,repeat_mode:'repeat'});
    });
    await t.test('disabled reward skipped without suppressing remaining rewards; cannot save disabled reward', async () => {
      await exec('update product_variants set gift_enabled=false where id=101');
      assert.deepEqual((await quote()).gifts.map(g=>[g.variant_id,g.qty]),[[102,5]]);
      await assert.rejects(save(payload),/已啟用/);
      await exec('update product_variants set gift_enabled=true where id=101');
    });
    await t.test('shared variant across activities cannot spend inventory twice', async () => {
      await save({...payload,id:uuid(2),gift_rewards:[{variant_id:102,quantity:3}]});
      const gifts=(await quote()).gifts;assert.equal(gifts.filter(g=>g.variant_id===102).reduce((s,g)=>s+g.qty,0),5);
      await exec(`delete from promotions where id='${uuid(2)}'`);
    });
    await t.test('invalid/duplicate/disabled rewards and old client overwrite rejected atomically', async () => {
      for (const gift_rewards of [[],null,[{variant_id:101,quantity:1.5}],[{variant_id:101,quantity:0}],[{variant_id:101,quantity:2147483648}],[{variant_id:999,quantity:1}],[{variant_id:101,quantity:1},{variant_id:101,quantity:2}]]) {
        await assert.rejects(save({...payload,gift_rewards}));
      }
      const legacy={...payload,gift_variant_id:101,gift_quantity:1};delete legacy.gift_rewards;
      await assert.rejects(save(legacy),/重新整理/);
      assert.equal((await query('select * from promotion_gift_rewards')).length,3);
      await assert.rejects(query('delete from product_variants where id=102'), /foreign key/);
    });
    await t.test('actual order creator preserves all gift lines and reservations; next order gets remaining stock', async () => {
      await exec(`alter table promotion_gift_reservations add column order_id text,add column promotion_id uuid,add column coupon_campaign_id uuid;
        create table orders(id text primary key,payment_due_at timestamptz,items jsonb);
        create table order_adjustments(order_id text,promotion_id uuid,coupon_campaign_id uuid,adjustment_type text,name_snapshot text,qualification_snapshot jsonb,amount numeric,gift_product_id integer,gift_variant_id bigint,gift_quantity integer,sort_order integer,metadata jsonb);
        create sequence test_order_seq;
        create function public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)
        returns jsonb language plpgsql as $$declare q jsonb; oid text:='TEST-'||nextval('test_order_seq');begin
          q:=public.quote_order_pricing($1,$8,$9,$5);
          insert into public.orders values(oid,now()+interval '1 hour',q->'items');
          if current_setting('test.stale',true)='true' then
            insert into promotion_gift_reservations(product_variant_id,quantity,status,expires_at) values(102,5,'reserved',now()+interval '1 hour');
          end if;
          return q||jsonb_build_object('order_id',oid);end$$;`);
      const source=read('supabase-promotion-gifts-engine.sql');
      const start=source.indexOf('create or replace function public.create_order_with_pricing(');
      await exec(source.slice(start,source.indexOf('$$;',start)+3));
      const create=()=>query("select public.create_order_with_pricing($1::jsonb,'member','address','phone','email','note','card','delivery','') as q",[JSON.stringify([{qty:3,line_total:3000}])]);
      await query("select set_config('test.stale','true',false)");
      await assert.rejects(create(),/贈品已兌換完畢/);
      assert.equal((await query('select * from orders')).length,0,'failed recheck rolls back order and earlier gift reservations');
      assert.equal((await query('select * from promotion_gift_reservations')).length,0);
      await query("select set_config('test.stale','false',false)");
      const first=(await create())[0].q;
      assert.deepEqual(first.gifts.map(g=>[g.variant_id,g.qty]),[[101,1],[102,5]]);
      assert.equal((await query('select * from promotion_gift_reservations')).length,2);
      assert.equal((await query('select * from order_adjustments')).length,2);
      const snapshot=(await query('select items from orders'))[0].items;
      await save({...payload,gift_rewards:[{variant_id:103,quantity:1}]});
      assert.deepEqual((await query('select items from orders'))[0].items,snapshot,'editing activity leaves order snapshot unchanged');
      await save({...payload,repeat_mode:'repeat'});
      assert.equal((await create())[0].q.gifts.length,0);
      await exec('delete from promotion_gift_reservations');
    });
    await t.test('zero inventory allows qualifying gift coupon with no gifts; unmet threshold still rejected', async () => {
      await exec(`update promotions set activation_type='coupon_only';insert into coupon_promotions values('${uuid(1)}','${uuid(50)}',0)`);
      assert.deepEqual((await quote(undefined,uuid(50))).gifts.map(g=>[g.variant_id,g.qty]),[[101,1],[102,5]]);
      await exec('update product_variants set gift_stock=0');
      assert.equal((await quote(undefined,uuid(50))).gifts.length,0);
      await assert.rejects(quote([{qty:1,line_total:999}],uuid(50)), /不適用/);
    });
    await t.test('ACL: reward definitions only readable by backoffice, private save not callable', async () => {
      await exec('set role authenticated');
      assert.equal((await query('select * from promotion_gift_rewards')).length,3);
      await query("select set_config('test.uid','',false)");
      assert.equal((await query('select * from promotion_gift_rewards')).length,0);
      await assert.rejects(query("select public.save_discount_promotion_before_multi_gifts('{}')"),/permission denied/);
      await exec('reset role');
    });
  } finally { await db.close(); }
});
