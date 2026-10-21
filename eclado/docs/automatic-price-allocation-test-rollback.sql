-- TEST ONLY: qqlgqasbmbicnmvnlqbr. New allocation acceptance; never run on production.
-- Real RPCs, no bank/network calls. All test data rolls back in a subtransaction.
-- Serial sequence counters can advance despite rollback; no business rows remain.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create or replace function pg_temp.alloc_fingerprint()
returns jsonb language plpgsql as $$
declare t record; h text; result jsonb:='{}';
begin
  for t in select tablename from pg_tables where schemaname='public' order by tablename loop
    execute format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) from public.%I t',t.tablename) into h;
    result:=result||jsonb_build_object(t.tablename,h);
  end loop;
  return result;
end $$;

create or replace function pg_temp.alloc_actor(p_id uuid)
returns void language plpgsql as $$begin
  perform set_config('request.jwt.claim.sub',coalesce(p_id::text,''),true);
  perform set_config('request.jwt.claims',case when p_id is null then '{}' else jsonb_build_object('sub',p_id,'role','authenticated')::text end,true);
end $$;
create or replace function pg_temp.alloc_assert(ok boolean,label text)
returns void language plpgsql as $$begin
  if ok is distinct from true then raise exception 'BOGO acceptance failed: %',label;end if;
end $$;

do $probe$
#variable_conflict use_variable
declare
  admin_id uuid; buyer_id uuid; product_id integer; other_product integer; v1 bigint; v2 bigint; v3 bigint; other_variant bigint;
  a uuid; b uuid; c uuid; gift uuid; campaign uuid; coupon uuid; bogo uuid;
  cart jsonb; mixed jsonb; q jsonb; created jsonb; stale jsonb; payload jsonb; snapshot jsonb;
  before_data jsonb; results jsonb:='[]'; failed boolean; before_orders integer; original_orders integer; n integer; start_at timestamptz;
begin
  select id into strict admin_id from auth.users where lower(email)='admin.stage@eclado.test';
  select id into strict buyer_id from auth.users where lower(email)='student.stage@eclado.test';
  select id into strict product_id from public.products where slug='reward-system-test-product';
  perform pg_temp.alloc_actor(admin_id);
  perform pg_temp.alloc_assert(public.has_backoffice_permission('promotions.manage'),'test administrator');
  before_data:=pg_temp.alloc_fingerprint(); select count(*) into original_orders from public.orders;
  begin
    update public.automatic_price_allocation_settings set enabled=true where singleton;
    update public.promotions set active=false where active;
    update public.student_pricing_feature_settings set enabled=false where singleton;
    update public.profiles set role='consumer' where id=buyer_id;
    update public.products set active=true,publication_status='active',is_pro_only=false,apply_tier_multiplier=false where id=product_id;
    insert into public.product_variants(product_id,sku,size,price,pro_price,stock,is_default,sort_order,active,is_custom_order,gift_enabled,gift_stock)
      values(product_id,'__ALLOC_A_20261021__','1000',1000,1000,1000,false,100,true,false,true,10) returning id into v1;
    insert into public.product_variants(product_id,sku,size,price,pro_price,stock,is_default,sort_order,active,is_custom_order,gift_enabled,gift_stock)
      values(product_id,'__ALLOC_B_20261021__','2000',2000,2000,1000,false,101,true,false,false,0) returning id into v2;
    insert into public.product_variants(product_id,sku,size,price,pro_price,stock,is_default,sort_order,active,is_custom_order,gift_enabled,gift_stock)
      values(product_id,'__ALLOC_C_20261021__','3000',3000,3000,1000,false,102,true,false,false,0) returning id into v3;
    insert into public.products(name,name_zh,slug,category,series,size,price,pro_price,stock,min_stock,is_pro_only,active,publication_status,description,apply_tier_multiplier)
      values('__ALLOC_OTHER__','ALLOC OTHER','allocation-rollback-20261021','toner','TEST','100ml',1000,1000,1000,0,false,true,'active','TEST',false) returning id into other_product;
    insert into public.product_variants(product_id,sku,size,price,pro_price,stock,is_default,sort_order,active,is_custom_order,gift_enabled,gift_stock)
      values(other_product,'__ALLOC_OTHER_20261021__','100ml',1000,1000,1000,true,0,true,false,false,0) returning id into other_variant;
    a:=public.save_discount_promotion(jsonb_build_object('name','__ALLOC_A__','benefit_type','fixed_discount','activation_type','automatic','discount_amount',100,'scope_type','products','product_ids',jsonb_build_array(product_id)));
    b:=public.save_discount_promotion(jsonb_build_object('name','__ALLOC_B__','benefit_type','fixed_discount','activation_type','automatic','discount_amount',200,'scope_type','products','product_ids',jsonb_build_array(other_product)));
    cart:=jsonb_build_array(jsonb_build_object('product_id',product_id,'variant_id',v1,'qty',1),jsonb_build_object('product_id',other_product,'variant_id',other_variant,'qty',1));
    perform pg_temp.alloc_actor(buyer_id); q:=public.quote_order_with_wallets(cart,'delivery','','',0,0);
    perform pg_temp.alloc_assert((q->>'discount')::numeric=300 and jsonb_array_length(q->'adjustments')=2 and q->>'promotion_id' is null,'disjoint activities total 300');
    created:=public.create_order_with_wallets(cart,'ALLOC TEST','TEST','0900000000','allocation.rollback@example.test','','atm','delivery','','personal',null,null,0,0,q);
    perform pg_temp.alloc_assert((select count(*)=2 from public.order_adjustments where order_id=created->>'order_id'),'two persisted adjustments');
    select pricing_snapshot into snapshot from public.orders where id=created->>'order_id';
    perform pg_temp.alloc_assert(snapshot->>'automatic_allocation_version'='1' and jsonb_array_length(snapshot->'automatic_allocations')=2,'versioned immutable snapshot');
    results:=results||jsonb_build_array('disjoint_300_real_wallet_order_snapshots');
    stale:=jsonb_set(q,'{pricing_snapshot,automatic_allocations,0,name}','"STALE"'); select count(*) into before_orders from public.orders;
    failed:=false; begin
      perform public.create_order_with_wallets(cart,'ALLOC TEST','TEST','0900000000','allocation.rollback@example.test','','atm','delivery','','personal',null,null,0,0,stale);
    exception when sqlstate '40001' then failed:=true; end;
    perform pg_temp.alloc_assert(failed and (select count(*)=before_orders from public.orders),'same-amount stale allocation rejects atomically');
    failed:=false; begin perform public.create_order_with_pricing(cart,'ALLOC TEST','TEST','0900000000','allocation.rollback@example.test','','atm','delivery'); exception when sqlstate '40001' then failed:=true; end;
    perform pg_temp.alloc_assert(failed,'legacy SQL overload requires confirmation');
    results:=results||jsonb_build_array('stale_same_amount_and_legacy_client_rejected');
    perform pg_temp.alloc_actor(admin_id);
    perform public.adjust_member_shopping_credit(buyer_id,'grant',1000,'other','ALLOC rollback test',extensions.gen_random_uuid());
    perform pg_temp.alloc_actor(buyer_id);
    q:=public.quote_order_with_wallets(cart,'delivery','','',100,0);
    created:=public.create_order_with_wallets(cart,'ALLOC TEST','TEST','0900000000','allocation.rollback@example.test','','atm','delivery','','personal',null,null,100,0,q);
    perform pg_temp.alloc_assert((created->>'payment_amount')::numeric+100=(created->>'total')::numeric,'actual shopping-credit net payment');
    perform pg_temp.alloc_assert((select reserved_balance>=100 from public.shopping_credit_accounts where user_id=buyer_id),'shopping-credit real reservation');
    results:=results||jsonb_build_array('shopping_credit_reservation_and_net_bank_amount');
    perform pg_temp.alloc_actor(admin_id);
    coupon:=public.save_discount_promotion(jsonb_build_object('name','__ALLOC_COUPON__','benefit_type','percentage_discount','activation_type','coupon_only','discount_rate',0.9,'scope_type','products','product_ids',jsonb_build_array(product_id,other_product)));
    campaign:=public.save_coupon_campaign(jsonb_build_object('name','__ALLOC_CAMPAIGN__','code','ALLOC_ROLLBACK_20261021','audience_mode','roles','audience_roles',jsonb_build_array('consumer'),'allow_guest',true,'stacking_policy','allow_all','promotion_ids',jsonb_build_array(coupon)));
    perform pg_temp.alloc_actor(buyer_id); q:=public.quote_order_pricing(cart,'delivery','ALLOC_ROLLBACK_20261021','');
    perform pg_temp.alloc_assert((q->>'discount')::numeric=470,'allow_all consumes actual remaining total');
    foreach payload in array array['"coupon_only"'::jsonb,'"allow_auto_gifts"'::jsonb] loop
      update public.coupon_campaigns set stacking_policy=payload#>>'{}' where id=campaign;
      q:=public.quote_order_pricing(cart,'delivery','ALLOC_ROLLBACK_20261021','');
      perform pg_temp.alloc_assert((q->>'discount')::numeric=200 and q#>'{pricing_snapshot,automatic_allocations}'='[]'::jsonb,'coupon suppression modes');
    end loop;
    results:=results||jsonb_build_array('coupon_three_stacking_modes');
    perform pg_temp.alloc_actor(admin_id);
    update public.promotions set discount_amount=150 where id in(a,b);
    c:=public.save_discount_promotion(jsonb_build_object('name','__ALLOC_GREEDY_TRAP__','benefit_type','fixed_discount','activation_type','automatic','discount_amount',250,'threshold_type','quantity','threshold_value',2,'scope_type','products','product_ids',jsonb_build_array(product_id,other_product)));
    perform pg_temp.alloc_actor(buyer_id); q:=public.quote_order_pricing(cart,'delivery','','');
    perform pg_temp.alloc_assert((q->>'discount')::numeric=300,'global best exceeds single 250');
    results:=results||jsonb_build_array('global_best_and_allocated_threshold');
    perform pg_temp.alloc_actor(admin_id); update public.promotions set active=false where activation_type='automatic';
    a:=public.save_discount_promotion(jsonb_build_object('name','__ALLOC_NINE__','benefit_type','percentage_discount','activation_type','automatic','discount_rate',0.9,'scope_type','products','product_ids',jsonb_build_array(product_id)));
    b:=public.save_discount_promotion(jsonb_build_object('name','__ALLOC_EIGHT__','benefit_type','percentage_discount','activation_type','automatic','discount_rate',0.8,'scope_type','products','product_ids',jsonb_build_array(product_id)));
    perform pg_temp.alloc_actor(buyer_id); q:=public.quote_order_pricing(jsonb_build_array(cart->0),'delivery','','');
    perform pg_temp.alloc_assert((q->>'discount')::numeric=200,'same unit selects eight tenths');
    results:=results||jsonb_build_array('same_unit_best_percentage');
    perform pg_temp.alloc_actor(admin_id); update public.promotions set active=false where id=a;
    bogo:=public.save_discount_promotion(jsonb_build_object('name','__ALLOC_BOGO__','benefit_type','buy_x_get_y','activation_type','automatic','buy_quantity',3,'gift_quantity',1,'repeat_mode','repeat','scope_type','products','product_ids',jsonb_build_array(product_id)));
    perform pg_temp.alloc_actor(buyer_id);q:=public.quote_order_pricing(jsonb_build_array((cart->0)||'{"qty":5}'::jsonb),'delivery','','');
    perform pg_temp.alloc_assert((q->>'discount')::numeric=1200,'same variant split four BOGO and one percentage');
    results:=results||jsonb_build_array('same_variant_split_and_whole_group_occupancy');
    update public.promotions set active=false where id=b;
    mixed:=jsonb_build_array(jsonb_build_object('product_id',product_id,'variant_id',v1,'qty',1),jsonb_build_object('product_id',product_id,'variant_id',v2,'qty',1),jsonb_build_object('product_id',product_id,'variant_id',v3,'qty',6));
    q:=public.quote_order_pricing(mixed,'delivery','','');
    perform pg_temp.alloc_assert((q->>'discount')::numeric=3000 and (q#>>'{adjustments,0,qualification,buy_x_get_y,free_quantity}')::integer=2,'eight frees lowest and second lowest');
    perform pg_temp.alloc_assert((select sum((x->>'quantity')::integer)=8 from jsonb_array_elements(q#>'{adjustments,0,qualification,allocation}') x),'eight units occupied');
    update public.promotions set repeat_mode='once' where id=bogo; q:=public.quote_order_pricing(mixed,'delivery','','');
    perform pg_temp.alloc_assert((q->>'discount')::numeric=1000,'once only one gift');
    q:=public.quote_order_pricing(jsonb_build_array((cart->0),jsonb_build_object('product_id',product_id,'variant_id',v3,'qty',4)),'delivery','','');
    perform pg_temp.alloc_assert((q->>'discount')::numeric=1000,'cheap remainder cannot be omitted');
    results:=results||jsonb_build_array('repeat_second_cheapest_once_and_cheap_remainder');
    perform pg_temp.alloc_actor(admin_id); update public.promotions set repeat_mode='repeat' where id=bogo;
    payload:=jsonb_build_object('customer_type','member','member_id',buyer_id,'member','ALLOC TEST','phone','0900000000','email','allocation.rollback@example.test','address','TEST','note','','payment_method','atm','fulfillment_method','delivery','invoice_type','personal','shipping_mode','default','shipping_amount',null,'shipping_reason','','minimum_reason','','apply_automatic',true,'shopping_credit_amount',0,'coupon_code','','items',
      jsonb_build_array(jsonb_build_object('product_id',product_id,'variant_id',v1,'qty',1,'unit_price',1000),jsonb_build_object('product_id',product_id,'variant_id',v2,'qty',1,'unit_price',2000),jsonb_build_object('product_id',product_id,'variant_id',v3,'qty',6,'unit_price',3000)));
    q:=public.quote_assisted_order(payload); perform pg_temp.alloc_assert((q->>'discount')::numeric=3000,'assisted quote');
    payload:=payload||jsonb_build_object('expected_quote',q->'confirmation');
    created:=public.create_assisted_order(extensions.gen_random_uuid(),payload);
    perform pg_temp.alloc_assert((select pricing_snapshot->>'automatic_allocation_version'='1' from public.orders where id=created->>'order_id'),'assisted immutable allocation snapshot');
    perform pg_temp.alloc_assert((select count(*)=1 from public.order_adjustments where order_id=created->>'order_id' and adjustment_type='buy_x_get_y'),'assisted persists adjustment');
    q:=public.quote_assisted_order(payload||'{"apply_automatic":false}'::jsonb); perform pg_temp.alloc_assert((q->>'discount')::numeric=0,'assisted automatic switch');
    update public.promotions set audience_roles=array['staff'],allow_guest=false where id=bogo;
    q:=public.quote_assisted_order(payload); perform pg_temp.alloc_assert((q->>'discount')::numeric=0,'customer identity instead of staff');
    perform pg_temp.alloc_actor(null);q:=public.quote_order_pricing(mixed,'delivery','','');perform pg_temp.alloc_assert((q->>'discount')::numeric=0,'guest disallowed');
    results:=results||jsonb_build_array('assisted_real_order_and_customer_guest_identity');
    perform pg_temp.alloc_actor(admin_id); update public.promotions set audience_roles=array['consumer'],allow_guest=true where id=bogo;
    gift:=public.save_discount_promotion(jsonb_build_object('name','__ALLOC_GIFT__','benefit_type','quantity_gift','activation_type','automatic','threshold_value',4,'gift_variant_id',v1,'gift_quantity',1,'scope_type','products','product_ids',jsonb_build_array(product_id)));
    perform pg_temp.alloc_actor(buyer_id);q:=public.quote_order_pricing(mixed,'delivery','','');perform pg_temp.alloc_assert((q->>'discount')::numeric=3000 and jsonb_array_length(q->'gifts')=1,'designated gift independent');
    results:=results||jsonb_build_array('designated_gift_keeps_original_eligibility');
    update public.promotions set active=false where activation_type='automatic';
    perform pg_temp.alloc_actor(admin_id);
    insert into public.promotions(name,benefit_type,activation_type,product_ids,discount_rate,discount_amount,discount_order,active)
      values('__ALLOC_LEGACY__','legacy_discount','automatic',array[product_id],1,50,'rate_then_amount',true);
    b:=public.save_discount_promotion(jsonb_build_object('name','__ALLOC_OTHER_FIXED__','benefit_type','fixed_discount','activation_type','automatic','discount_amount',200,'scope_type','products','product_ids',jsonb_build_array(other_product)));
    perform pg_temp.alloc_actor(buyer_id);q:=public.quote_order_with_wallets(cart,'delivery','','',0,0);perform pg_temp.alloc_assert((q->>'discount')::numeric=250,'legacy plus unrelated activity');
    created:=public.create_order_with_wallets(cart,'ALLOC TEST','TEST','0900000000','allocation.rollback@example.test','','atm','delivery','','personal',null,null,0,0,q);
    perform pg_temp.alloc_assert((select count(*)=1 from public.order_adjustments where order_id=created->>'order_id' and adjustment_type='legacy_discount'),'legacy persisted');
    results:=results||jsonb_build_array('legacy_combines_and_persists');
    update public.automatic_price_allocation_settings set enabled=false where singleton;
    perform pg_temp.alloc_assert((select pricing_snapshot=snapshot from public.orders where id=(select id from public.orders where pricing_snapshot=snapshot limit 1)),'switch keeps prior snapshot');
    results:=results||jsonb_build_array('switch_keeps_historical_snapshots');
    select jsonb_agg(jsonb_build_object('product_id',1,'variant_id',i,'qty',1,'unit_price',1000,'line_total',1000) order by i) into cart from generate_series(1,20) i;
    select jsonb_build_array(jsonb_build_object('id','a','name','a','benefit_type','percentage_discount','discount_rate',0.9,'threshold_type','amount','q',flags,'b',flags,'e',flags),
      jsonb_build_object('id','b','name','b','benefit_type','percentage_discount','discount_rate',0.8,'threshold_type','amount','q',flags,'b',flags,'e',flags)) into payload
      from (select jsonb_agg(true) flags from generate_series(1,20)) s;
    start_at:=clock_timestamp(); q:=public.solve_automatic_price_component(cart,payload);
    perform pg_temp.alloc_assert((q->>'discount')::numeric=4000 and (q->>'search_nodes')::integer<1000,'twenty overlapping variants exact result');
    results:=results||jsonb_build_array(jsonb_build_object('case','overlap_20_variants','search_nodes',q->'search_nodes','elapsed_ms',round(extract(epoch from clock_timestamp()-start_at)*1000,2)));
    raise exception 'Completed allocation test; revert all rows' using errcode='P9001';
  exception when sqlstate 'P9001' then null;
  end;
  perform pg_temp.alloc_assert(pg_temp.alloc_fingerprint()=before_data,'all public table rows restored');
  perform set_config('test.allocation_acceptance',jsonb_build_object('passed',true,'cases',results,'case_count',jsonb_array_length(results),
    'all_public_table_rows_unchanged',true,'original_order_count',original_orders,'retained_test_orders',0,'bank_calls',0)::text,true);
end $probe$;
select current_setting('test.allocation_acceptance')::jsonb as report;
rollback;
