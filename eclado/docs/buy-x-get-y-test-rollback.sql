-- TEST ONLY: qqlgqasbmbicnmvnlqbr. Requires test Auth/catalog fixtures.
-- Real RPCs, no bank/network calls. All test data rolls back in a subtransaction.
-- Serial sequence counters can advance despite rollback; no business rows remain.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create or replace function pg_temp.bogo_fingerprint()
returns jsonb language plpgsql as $$
declare t record; h text; result jsonb:='{}';
begin
  for t in select tablename from pg_tables where schemaname='public' order by tablename loop
    execute format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) from public.%I t',t.tablename) into h;
    result:=result||jsonb_build_object(t.tablename,h);
  end loop;
  return result;
end $$;
create or replace function pg_temp.bogo_actor(p_id uuid)
returns void language plpgsql as $$begin
  perform set_config('request.jwt.claim.sub',coalesce(p_id::text,''),true);
  perform set_config('request.jwt.claims',case when p_id is null then '{}' else jsonb_build_object('sub',p_id,'role','authenticated')::text end,true);
end $$;
create or replace function pg_temp.bogo_assert(ok boolean,label text)
returns void language plpgsql as $$begin
  if ok is distinct from true then raise exception 'BOGO acceptance failed: %',label;end if;
end $$;
do $probe$
#variable_conflict use_variable
declare
  admin_id uuid; buyer_id uuid; product_id integer; v1 bigint; v2 bigint; v3 bigint;
  excluded_product integer; excluded_variant bigint;
  promo uuid; coupon_promo uuid; percent_promo uuid; fixed_promo uuid; campaign uuid; gift_promo uuid;
  config jsonb; cart jsonb; q jsonb; created jsonb; payload jsonb; a jsonb; before_stock integer;
  before_data jsonb; results jsonb:='[]'; n integer; expected integer; failed boolean; order_count integer;
  gift_variant bigint;
begin
  select id into strict admin_id from auth.users where lower(email)='admin.stage@eclado.test';
  select id into strict buyer_id from auth.users where lower(email)='student.stage@eclado.test';
  select id into strict product_id from public.products where slug='reward-system-test-product';
  perform pg_temp.bogo_actor(admin_id);
  perform pg_temp.bogo_assert(public.has_backoffice_permission('promotions.manage'),'test admin permission');
  before_data:=pg_temp.bogo_fingerprint();
  select count(*) into order_count from public.orders;
  begin
    update public.promotions set active=false where active;
    update public.student_pricing_feature_settings set enabled=false where singleton;
    update public.profiles set role='consumer' where id=buyer_id;
    update public.products set active=true,publication_status='active',is_pro_only=false,apply_tier_multiplier=false where id=product_id;
    insert into public.product_variants(product_id,sku,size,price,pro_price,stock,is_default,sort_order,active,is_custom_order,gift_enabled,gift_stock)
      values(product_id,'__BOGO_TEST_A_20261020__','BOGO1000',1000,1000,100,false,100,true,false,false,0) returning id into v1;
    insert into public.product_variants(product_id,sku,size,price,pro_price,stock,is_default,sort_order,active,is_custom_order,gift_enabled,gift_stock)
      values(product_id,'__BOGO_TEST_B_20261020__','BOGO2000',2000,2000,100,false,101,true,false,false,0) returning id into v2;
    insert into public.product_variants(product_id,sku,size,price,pro_price,stock,is_default,sort_order,active,is_custom_order,gift_enabled,gift_stock)
      values(product_id,'__BOGO_TEST_C_20261020__','BOGO3000',3000,3000,100,false,102,true,false,false,0) returning id into v3;
    config:=jsonb_build_object('name','__BOGO_ROLLBACK_PROBE__','benefit_type','buy_x_get_y','activation_type','automatic',
      'buy_quantity',3,'gift_quantity',1,'repeat_mode','repeat','scope_type','products','product_ids',jsonb_build_array(product_id),
      'audience_roles',jsonb_build_array('consumer'),'allow_guest',true,'active',true);
    promo:=public.save_discount_promotion(config);config:=config||jsonb_build_object('id',promo);
    cart:=jsonb_build_array(jsonb_build_object('product_id',product_id,'variant_id',v1,'qty',1),
      jsonb_build_object('product_id',product_id,'variant_id',v2,'qty',1),jsonb_build_object('product_id',product_id,'variant_id',v3,'qty',6));
    perform pg_temp.bogo_actor(buyer_id);
    q:=public.quote_order_pricing(cart,'delivery','','');
    perform pg_temp.bogo_assert((q->>'discount')::numeric=3000,'mixed eight frees lowest and second lowest');
    a:=q->'adjustments'->0->'qualification'->'buy_x_get_y';
    perform pg_temp.bogo_assert((a->>'free_quantity')::integer=2 and jsonb_array_length(a->'free_items')=2,'distinct free unit snapshots');
    results:=results||jsonb_build_array(jsonb_build_object('case','mixed_8_second_cheapest','discount',q->'discount','passed',true));
    foreach n in array array[3,4,7,8,12,96] loop
      q:=public.quote_order_pricing(jsonb_build_array(jsonb_build_object('product_id',product_id,'variant_id',v1,'qty',n)),'delivery','','');
      expected:=(n/4)*1000;
      perform pg_temp.bogo_assert((q->>'discount')::numeric=expected,'quantity boundary '||n);
    end loop;
    results:=results||jsonb_build_array(jsonb_build_object('case','repeat_boundaries_3_4_7_8_12_96','passed',true));
    perform pg_temp.bogo_actor(admin_id);perform public.save_discount_promotion(config||jsonb_build_object('repeat_mode','once'));
    perform pg_temp.bogo_actor(buyer_id);q:=public.quote_order_pricing(cart,'delivery','','');
    perform pg_temp.bogo_assert((q->>'discount')::numeric=1000,'once mode');
    results:=results||jsonb_build_array(jsonb_build_object('case','once_8_only_1_free','passed',true));
    perform pg_temp.bogo_actor(admin_id);perform public.save_discount_promotion(config||jsonb_build_object('buy_quantity',2,'gift_quantity',2));
    perform pg_temp.bogo_actor(buyer_id);q:=public.quote_order_pricing(cart,'delivery','','');
    perform pg_temp.bogo_assert((q->>'discount')::numeric=9000,'buy two get two');
    results:=results||jsonb_build_array(jsonb_build_object('case','buy_2_get_2_repeat','passed',true));
    perform pg_temp.bogo_actor(admin_id);perform public.save_discount_promotion(config);
    insert into public.products(name,name_zh,slug,category,series,size,price,pro_price,stock,min_stock,is_pro_only,active,publication_status,description,apply_tier_multiplier)
      values('__BOGO_EXCLUDED__','BOGO OUT OF SCOPE','bogo-rollback-excluded-20261020','toner','TEST','100ml',10,10,100,0,false,true,'active','TEST',false)
      returning id into excluded_product;
    insert into public.product_variants(product_id,sku,size,price,pro_price,stock,is_default,sort_order,active,is_custom_order,gift_enabled,gift_stock)
      values(excluded_product,'__BOGO_EXCLUDED_20261020__','100ml',10,10,100,true,0,true,false,false,0) returning id into excluded_variant;
    perform pg_temp.bogo_actor(buyer_id);
    q:=public.quote_order_pricing(jsonb_build_array(jsonb_build_object('product_id',product_id,'variant_id',v1,'qty',3),
      jsonb_build_object('product_id',excluded_product,'variant_id',excluded_variant,'qty',4)),'delivery','','');
    perform pg_temp.bogo_assert((q->>'discount')::numeric=0,'out of scope units do not qualify');
    results:=results||jsonb_build_array(jsonb_build_object('case','product_scope','passed',true));
    perform pg_temp.bogo_actor(admin_id);perform public.save_discount_promotion(config||jsonb_build_object('allow_guest',false));
    perform pg_temp.bogo_actor(null);q:=public.quote_order_pricing(cart,'delivery','','');
    perform pg_temp.bogo_assert((q->>'discount')::numeric=0,'guest disallowed');
    perform pg_temp.bogo_actor(admin_id);update public.profiles set role='pro' where id=buyer_id;
    perform pg_temp.bogo_actor(buyer_id);q:=public.quote_order_pricing(cart,'delivery','','');
    perform pg_temp.bogo_assert((q->>'discount')::numeric=0,'unselected member role');
    perform pg_temp.bogo_actor(admin_id);update public.profiles set role='consumer' where id=buyer_id;
    perform public.save_discount_promotion(config||jsonb_build_object('audience_roles','[]'::jsonb,'allow_guest',true));
    perform pg_temp.bogo_actor(null);q:=public.quote_order_pricing(cart,'delivery','','');
    perform pg_temp.bogo_assert((q->>'discount')::numeric=3000,'guest-only included');
    perform pg_temp.bogo_actor(buyer_id);q:=public.quote_order_pricing(cart,'delivery','','');
    perform pg_temp.bogo_assert((q->>'discount')::numeric=0,'guest-only excludes member');
    results:=results||jsonb_build_array(jsonb_build_object('case','member_roles_guest_and_guest_only','passed',true));
    perform pg_temp.bogo_actor(admin_id);perform public.save_discount_promotion(config);
    perform public.save_discount_promotion(config||jsonb_build_object('start_at','2020-01-01T00:00:00Z','end_at','2021-01-01T00:00:00Z'));
    perform pg_temp.bogo_actor(buyer_id);q:=public.quote_order_pricing(cart,'delivery','','');
    perform pg_temp.bogo_assert((q->>'discount')::numeric=0,'expired activity');
    perform pg_temp.bogo_actor(admin_id);perform public.save_discount_promotion(config);
    results:=results||jsonb_build_array(jsonb_build_object('case','activity_period','passed',true));
    fixed_promo:=public.save_discount_promotion(jsonb_build_object('name','__BOGO_COMPETE__','benefit_type','fixed_discount','activation_type','automatic',
      'discount_amount',5000,'scope_type','products','product_ids',jsonb_build_array(product_id)));
    perform pg_temp.bogo_actor(buyer_id);q:=public.quote_order_pricing(cart,'delivery','','');
    perform pg_temp.bogo_assert((q->>'discount')::numeric=5000,'single best automatic discount');
    update public.promotions set active=false where id=fixed_promo;
    results:=results||jsonb_build_array(jsonb_build_object('case','best_automatic_discount','passed',true));
    -- Full storefront order RPC. No payment API is called.
    q:=public.quote_order_with_wallets(cart,'delivery','','',0::bigint,0::bigint);
    created:=public.create_order_with_wallets(cart,'BOGO TEST','TEST','0900000000','bogo.rollback@example.test','','atm','delivery','','personal',null,null,0::bigint,0::bigint,q);
    perform pg_temp.bogo_assert(exists(select 1 from public.order_adjustments where order_id=created->>'order_id' and adjustment_type='buy_x_get_y'
      and amount=3000 and (qualification_snapshot#>>'{buy_x_get_y,free_quantity}')::integer=2),'storefront immutable adjustment');
    perform pg_temp.bogo_assert(not exists(select 1 from public.promotion_gift_reservations where order_id=created->>'order_id'),'no designated gift reservations');
    results:=results||jsonb_build_array(jsonb_build_object('case','storefront_creation_snapshot_and_wallet_wrapper','passed',true));
    -- Full assisted order RPC, actual inventory allocation and customer identity.
    perform pg_temp.bogo_actor(admin_id);
    payload:=jsonb_build_object('customer_type','member','member_id',buyer_id,'member','BOGO TEST','phone','0900000000','email','bogo.rollback@example.test',
      'address','TEST','payment_method','atm','fulfillment_method','delivery','invoice_type','personal','shipping_mode','default',
      'apply_automatic',true,'coupon_code','','shopping_credit_amount',0,'items',jsonb_build_array(
        jsonb_build_object('product_id',product_id,'variant_id',v1,'qty',1,'unit_price',1000,'price_source','manual'),
        jsonb_build_object('product_id',product_id,'variant_id',v2,'qty',1,'unit_price',2000,'price_source','manual'),
        jsonb_build_object('product_id',product_id,'variant_id',v3,'qty',6,'unit_price',3000,'price_source','manual')));
    q:=public.quote_assisted_order(payload);perform pg_temp.bogo_assert((q->>'discount')::numeric=3000,'assisted customer audience');
    q:=public.quote_assisted_order(payload||jsonb_build_object('apply_automatic',false));
    perform pg_temp.bogo_assert((q->>'discount')::numeric=0,'assisted automatic switch');
    select stock into before_stock from public.product_variants where id=v3;
    created:=public.create_assisted_order(gen_random_uuid(),payload);
    perform pg_temp.bogo_assert((select stock=before_stock-6 and gift_stock=0 from public.product_variants where id=v3),'free units use ordinary inventory');
    perform pg_temp.bogo_assert(exists(select 1 from public.order_adjustments where order_id=created->>'order_id' and adjustment_type='buy_x_get_y' and amount=3000),'assisted snapshot');
    results:=results||jsonb_build_array(jsonb_build_object('case','assisted_creation_inventory_and_snapshot','passed',true));
    -- Coupon-only activity belongs to PRICE discount stacking.
    coupon_promo:=public.save_discount_promotion(config||jsonb_build_object('id',null,'name','__BOGO_COUPON__','activation_type','coupon_only'));
    percent_promo:=public.save_discount_promotion(jsonb_build_object('name','__BOGO_PERCENT__','benefit_type','percentage_discount','activation_type','coupon_only',
      'discount_rate',0.9,'scope_type','products','product_ids',jsonb_build_array(product_id)));
    campaign:=public.save_coupon_campaign(jsonb_build_object('name','__BOGO_CAMPAIGN__','code','BOGO_ROLLBACK_20261020','audience_mode','roles',
      'audience_roles',jsonb_build_array('consumer'),'allow_guest',true,'stacking_policy','coupon_only','promotion_ids',jsonb_build_array(coupon_promo,percent_promo)));
    perform pg_temp.bogo_actor(buyer_id);q:=public.quote_order_pricing(cart,'delivery','BOGO_ROLLBACK_20261020','');
    perform pg_temp.bogo_assert((q->>'discount')::numeric=4800,'coupon bogo then percent');
    update public.coupon_campaigns set stacking_policy='allow_auto_gifts' where id=campaign;
    q:=public.quote_order_pricing(cart,'delivery','BOGO_ROLLBACK_20261020','');
    perform pg_temp.bogo_assert((q->>'discount')::numeric=4800,'gift stacking must not include automatic bogo');
    update public.coupon_campaigns set stacking_policy='allow_all' where id=campaign;
    q:=public.quote_order_pricing(cart,'delivery','BOGO_ROLLBACK_20261020','');
    perform pg_temp.bogo_assert((q->>'discount')::numeric=7500,'all stacking never awards the same unit again');
    results:=results||jsonb_build_array(jsonb_build_object('case','coupon_only_gift_and_all_stacking','passed',true));
    update public.coupon_campaigns set stacking_policy='coupon_only' where id=campaign;
    update public.coupon_promotions set sort_order=case when promotion_id=percent_promo then 0 else 1 end where coupon_campaign_id=campaign;
    q:=public.quote_order_pricing(cart,'delivery','BOGO_ROLLBACK_20261020','');
    perform pg_temp.bogo_assert((q->>'discount')::numeric=4800,'coupon percent first uses remaining unit prices');
    perform pg_temp.bogo_actor(admin_id);
    fixed_promo:=public.save_discount_promotion(jsonb_build_object('name','__BOGO_ONE_DOLLAR__','benefit_type','fixed_discount','activation_type','coupon_only',
      'discount_amount',1,'scope_type','products','product_ids',jsonb_build_array(product_id)));
    update public.coupon_promotions set sort_order=case when promotion_id=coupon_promo then 1 else 2 end where coupon_campaign_id=campaign;
    insert into public.coupon_promotions(coupon_campaign_id,promotion_id,sort_order) values(campaign,fixed_promo,0);
    perform pg_temp.bogo_actor(buyer_id);q:=public.quote_order_with_wallets(cart,'delivery','BOGO_ROLLBACK_20261020','',0::bigint,0::bigint);
    perform pg_temp.bogo_assert((q->>'discount')::numeric=4801 and (q->>'total')::numeric=trunc((q->>'total')::numeric),'coupon rounding stays whole dollar');
    created:=public.create_order_with_wallets(cart,'BOGO TEST','TEST','0900000000','bogo.rollback@example.test','','atm','delivery','BOGO_ROLLBACK_20261020','personal',null,null,0::bigint,0::bigint,q);
    perform pg_temp.bogo_assert(exists(select 1 from public.coupon_redemptions where order_id=created->>'order_id' and status='reserved'),'coupon redemption persists');
    results:=results||jsonb_build_array(jsonb_build_object('case','coupon_order_rounding_and_redemption','passed',true));
    -- Regress the original four types through the installed storefront engine.
    perform pg_temp.bogo_actor(admin_id);update public.promotions set active=false where active;
    fixed_promo:=public.save_discount_promotion(jsonb_build_object('name','__OLD_FIXED__','benefit_type','fixed_discount','activation_type','automatic','discount_amount',100,'scope_type','products','product_ids',jsonb_build_array(product_id)));
    perform pg_temp.bogo_actor(buyer_id);q:=public.quote_order_pricing(cart,'delivery','','');perform pg_temp.bogo_assert((q->>'discount')::numeric=100,'existing fixed');
    update public.promotions set active=false where id=fixed_promo;
    perform pg_temp.bogo_actor(admin_id);
    percent_promo:=public.save_discount_promotion(jsonb_build_object('name','__OLD_PERCENT__','benefit_type','percentage_discount','activation_type','automatic','discount_rate',0.9,'scope_type','products','product_ids',jsonb_build_array(product_id)));
    perform pg_temp.bogo_actor(buyer_id);q:=public.quote_order_pricing(cart,'delivery','','');perform pg_temp.bogo_assert((q->>'discount')::numeric=2100,'existing percentage');
    update public.promotions set active=false where id=percent_promo;
    update public.product_variants set gift_enabled=true,gift_stock=10 where id=v1;
    perform pg_temp.bogo_actor(admin_id);
    foreach a in array array[jsonb_build_object('benefit_type','amount_gift','threshold_value',1000),jsonb_build_object('benefit_type','quantity_gift','threshold_value',4)] loop
      gift_promo:=public.save_discount_promotion(a||jsonb_build_object('name','__OLD_GIFT__','activation_type','automatic','gift_variant_id',v1,'gift_quantity',1,'scope_type','products','product_ids',jsonb_build_array(product_id)));
      perform pg_temp.bogo_actor(buyer_id);q:=public.quote_order_pricing(cart,'delivery','','');
      perform pg_temp.bogo_assert(jsonb_array_length(q->'gifts')=1,'existing designated gift');
      perform pg_temp.bogo_actor(admin_id);update public.promotions set active=false where id=gift_promo;
    end loop;
    results:=results||jsonb_build_array(jsonb_build_object('case','original_four_benefits_regression','passed',true));
    -- Invalid quantities and an unauthorised editor cannot save.
    foreach a in array array[jsonb_build_object('buy_quantity',0),jsonb_build_object('buy_quantity',1.5),jsonb_build_object('gift_quantity',0),jsonb_build_object('gift_quantity',1.5)] loop
      failed:=false;begin perform public.save_discount_promotion(config||a);exception when others then failed:=true;end;
      perform pg_temp.bogo_assert(failed,'reject invalid counts');
    end loop;
    perform pg_temp.bogo_actor(null);failed:=false;
    begin perform public.save_discount_promotion(config);exception when insufficient_privilege then failed:=true;end;
    perform pg_temp.bogo_assert(failed,'reject unauthorised editor');
    results:=results||jsonb_build_array(jsonb_build_object('case','invalid_counts_and_authorisation','passed',true));
    raise exception 'Completed BOGO test; revert all test rows' using errcode='P9001';
  exception when sqlstate 'P9001' then null;
  end;
  perform pg_temp.bogo_assert(pg_temp.bogo_fingerprint()=before_data,'all public table rows restored');
  perform pg_temp.bogo_assert((select count(*) from public.orders)=order_count,'original order count restored');
  perform set_config('test.bogo_acceptance',jsonb_build_object('passed',true,'cases',results,'case_count',jsonb_array_length(results),
    'all_public_table_rows_unchanged',true,'original_order_count',order_count,'retained_test_orders',0,'bank_calls',0)::text,true);
end $probe$;
select jsonb_build_object('verification',(select to_jsonb(v) from (select
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='promotions' and column_name='buy_quantity') as buy_quantity_installed,
  exists(select 1 from pg_constraint where conrelid='public.promotions'::regclass and conname='promotions_buy_x_get_y_check') as configuration_constraint,
  pg_get_constraintdef((select oid from pg_constraint where conrelid='public.order_adjustments'::regclass and conname='order_adjustments_adjustment_type_check')) like '%buy_x_get_y%' as snapshots_accept_benefit,
  position('public.calculate_buy_x_get_y' in pg_get_functiondef('public.quote_order_pricing_discount_v2(jsonb,text,text,text)'::regprocedure))>0 as storefront_engine,
  position('public.calculate_buy_x_get_y' in pg_get_functiondef('public.assisted_discount_quote(jsonb,text,text,text,uuid,boolean)'::regprocedure))>0 as assisted_engine,
  position('buy_x_get_y' in pg_get_functiondef('public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)'::regprocedure))>0 as storefront_persists_adjustment,
  position('public.save_discount_promotion_before_audience_20261017(p_payload)' in pg_get_functiondef('public.save_discount_promotion(jsonb)'::regprocedure))>0 as audience_editor_preserved,
  position('public.automatic_promotion_allows_identity' in pg_get_functiondef('public.quote_order_pricing_discount_v2(jsonb,text,text,text)'::regprocedure))>0 as storefront_audience_preserved,
  position('public.automatic_promotion_allows_identity(promotion.id, member_role, current_user_id)' in pg_get_functiondef('public.assisted_discount_quote(jsonb,text,text,text,uuid,boolean)'::regprocedure))>0 as assisted_customer_audience_preserved,
  not has_function_privilege('anon','public.calculate_buy_x_get_y(uuid,jsonb)','execute')
    and not has_function_privilege('authenticated','public.calculate_buy_x_get_y(uuid,jsonb)','execute') as calculator_private,
  (select bool_and(position('then (entry->>''product_id'')::bigint not between 1 and 2147483647 else true end' in pg_get_functiondef(signature::regprocedure))>0)
    from unnest(array['public.quote_assisted_order(jsonb)','public.create_assisted_order_base_v1(uuid,jsonb)','public.create_assisted_order(uuid,jsonb)']) signature) as assisted_product_id_bounds) v),'acceptance',current_setting('test.bogo_acceptance')::jsonb) as report;
rollback;
