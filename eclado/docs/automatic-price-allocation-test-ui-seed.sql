-- TEST ONLY qqlgqasbmbicnmvnlqbr. Temporary UI fixtures; paired cleanup required.
-- No bank or notification API calls. This deliberately commits UI-visible rows.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
declare admin_id uuid; product_id integer; variant_id bigint; pids integer[]:='{}'; vids bigint[]:='{}';
  promo uuid; cart jsonb:='[]'; q jsonb; created jsonb; i integer; label text;
begin
  if exists(select 1 from public.products where slug like 'allocation-ui-20261021-%') then raise exception 'UI fixtures already exist'; end if;
  select id into strict admin_id from auth.users where lower(email)='admin.stage@eclado.test';
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  update public.automatic_price_allocation_settings set enabled=true where singleton;
  for i in 1..2 loop
    label:=case i when 1 then 'A' else 'B' end;
    insert into public.products(name,name_zh,slug,category,series,size,price,pro_price,stock,min_stock,is_pro_only,active,publication_status,description,apply_tier_multiplier)
      values('TEST Allocation '||label,'TEST 自動優惠商品 '||label,'allocation-ui-20261021-'||i,'toner','TEST','100ml',1000,1000,100,0,false,true,'active','自動活動 UI 驗收暫存商品',false) returning id into product_id;
    insert into public.product_variants(product_id,sku,size,price,pro_price,stock,is_default,sort_order,active,is_custom_order,gift_enabled,gift_stock)
      values(product_id,'__ALLOC_UI_20261021_'||i||'__','100ml',1000,1000,100,true,0,true,false,false,0) returning id into variant_id;
    pids:=array_append(pids,product_id); vids:=array_append(vids,variant_id);
    promo:=public.save_discount_promotion(jsonb_build_object('name','TEST 商品 '||label||' 折'||i*100,'benefit_type','fixed_discount','activation_type','automatic','discount_amount',i*100,'scope_type','products','product_ids',jsonb_build_array(product_id)));
    -- Test admin is staff with authoritative NT$500 units and the installed
    -- NT$5000 minimum. Ten each satisfies that existing rule after discounts.
    cart:=cart||jsonb_build_array(jsonb_build_object('product_id',product_id,'variant_id',variant_id,'qty',10));
  end loop;
  q:=public.quote_order_with_wallets(cart,'delivery','','',0,0);
  if (q->>'discount')::numeric<>300 then raise exception 'UI quote mismatch'; end if;
  created:=public.create_order_with_wallets(cart,'TEST 自動活動驗收','TEST','0900000000','allocation.ui@example.test','__ALLOC_UI_20261021__','atm','delivery','','personal',null,null,0,0,q);
  perform set_config('test.allocation_ui_manifest',jsonb_build_object('products',pids,'variants',vids,'order_id',created->'order_id','discount',q->'discount','total',q->'total','bank_calls',0)::text,true);
end $$;
select current_setting('test.allocation_ui_manifest')::jsonb as manifest;
commit;
