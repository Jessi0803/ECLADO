-- TEST ONLY: qqlgqasbmbicnmvnlqbr. Student policy acceptance; never run on production.
-- Real RPCs, no bank/network calls. All test data rolls back in a subtransaction.
-- Serial sequence counters can advance despite rollback; no business rows remain.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create or replace function pg_temp.policy_fingerprint()
returns jsonb language plpgsql as $$
declare t record; h text; result jsonb:='{}';
begin
  for t in select tablename from pg_tables where schemaname='public' order by tablename loop
    execute format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) from public.%I t',t.tablename) into h;
    result:=result||jsonb_build_object(t.tablename,h);
  end loop;
  return result;
end $$;

create or replace function pg_temp.policy_actor(p_id uuid)
returns void language plpgsql as $$begin
  perform set_config('request.jwt.claim.sub',coalesce(p_id::text,''),true);
  perform set_config('request.jwt.claims',case when p_id is null then '{}' else jsonb_build_object('sub',p_id,'role','authenticated')::text end,true);
end $$;
create or replace function pg_temp.policy_assert(ok boolean,label text)
returns void language plpgsql as $$begin
  if ok is distinct from true then raise exception 'Student policy acceptance failed: %',label;end if;
end $$;

do $probe$
#variable_conflict use_variable
declare
 admin_id uuid; buyer_id uuid; teacher_id uuid; product_id integer; other_product integer; v1 bigint; other_variant bigint;
 activity uuid; coupon uuid; campaign uuid; cart jsonb; mixed jsonb; q jsonb; created jsonb; mixed_order text; frozen jsonb; payload jsonb;
 before_data jsonb; results jsonb:='[]'; failed boolean; before_orders integer; original_orders integer; updated timestamptz;
begin
 select id into strict admin_id from auth.users where lower(email)='admin.stage@eclado.test';
 select id into strict buyer_id from auth.users where lower(email)='student.stage@eclado.test';
 select id into strict teacher_id from auth.users where lower(email)='instructor.stage@eclado.test';
 select id into strict product_id from public.products where slug='reward-system-test-product';
 perform pg_temp.policy_actor(admin_id);
 perform pg_temp.policy_assert(public.has_backoffice_permission('promotions.manage'),'TEST admin identity');
 perform pg_temp.policy_assert(not (select enabled from public.promotion_student_policy_settings where singleton),'feature OFF baseline');
 before_data:=pg_temp.policy_fingerprint(); select count(*) into original_orders from public.orders;
 begin
  update public.automatic_price_allocation_settings set enabled=true where singleton;
  update public.promotion_student_policy_settings set enabled=true where singleton;
  update public.student_pricing_feature_settings set enabled=true where singleton;
  update public.student_pricing_settings set student_1=.9,student_2=.9 where singleton;
  update public.membership_tiers set professional_price_multiplier=.7 where role='instructor';
  perform pg_temp.policy_assert(exists(select 1 from public.instructor_student_bindings where student_id=buyer_id and instructor_id=teacher_id and ended_at is null),'existing TEST student binding');
  update public.products set active=true,publication_status='active',is_pro_only=false,apply_tier_multiplier=false,instructor_price_multiplier=null where id=product_id;
  insert into public.product_variants(product_id,sku,size,price,pro_price,stock,is_default,sort_order,active,is_custom_order,gift_enabled,gift_stock)
   values(product_id,'__POLICY_A_20261030__','POLICY1000',1200,1000,1000,false,100,true,false,false,0) returning id into v1;
  insert into public.products(name,name_zh,slug,category,series,size,price,pro_price,stock,min_stock,is_pro_only,active,publication_status,description,apply_tier_multiplier)
   values('__POLICY_OTHER__','POLICY OTHER','student-policy-rollback-20261030','toner','TEST','100ml',1200,1000,1000,0,false,true,'active','TEST',false) returning id into other_product;
  insert into public.product_variants(product_id,sku,size,price,pro_price,stock,is_default,sort_order,active,is_custom_order,gift_enabled,gift_stock)
   values(other_product,'__POLICY_OTHER_20261030__','100ml',1200,1000,1000,true,0,true,false,false,0) returning id into other_variant;
  activity:=public.save_discount_promotion(jsonb_build_object('name','__POLICY_PERCENT__','benefit_type','percentage_discount','activation_type','automatic','discount_rate',.8,'scope_type','products','product_ids',jsonb_build_array(product_id),'allow_student_price_stacking',false,'instructor_reward_eligible',false));
  cart:=jsonb_build_array(jsonb_build_object('product_id',product_id,'variant_id',v1,'qty',10));
  perform pg_temp.policy_actor(buyer_id);q:=public.quote_order_with_wallets(cart,'delivery','','',0,0);
  perform pg_temp.policy_assert((q->>'subtotal')::numeric=9000 and (q->>'discount')::numeric=1000 and jsonb_array_length(q->'adjustments')=2,'80 percent uses original 1000 basis and restores 100 student reduction');
  perform pg_temp.policy_assert(q::text !~ 'instructor_unit_price|total_reward|_student_policy','public quote hides private reward basis');
  created:=public.create_order_with_wallets(cart,'POLICY TEST','TEST','0900000000','policy.rollback@example.test','','atm','delivery','','personal',null,null,0,0,q);
  perform pg_temp.policy_assert((select total_reward=0 and (items->0->>'reward_excluded_quantity')::integer=10 from public.student_reward_snapshots where order_id=created->>'order_id'),'all activity units exclude rewards');
  results:=results||jsonb_build_array('real_wallet_order_nonstacking_restoration_zero_reward');
  update public.promotions set instructor_reward_eligible=true where id=activity;
  select count(*) into before_orders from public.orders; failed:=false;
  begin perform public.create_order_with_wallets(cart,'POLICY TEST','TEST','0900000000','policy.rollback@example.test','','atm','delivery','','personal',null,null,0,0,q);
  exception when sqlstate '40001' then failed:=true;end;
  perform pg_temp.policy_assert(failed and (select count(*)=before_orders from public.orders),'same price policy change invalidates quote atomically');
  update public.promotions set discount_rate=.95,instructor_reward_eligible=false where id=activity;
  q:=public.quote_order_with_wallets(cart,'delivery','','',0,0);
  perform pg_temp.policy_assert((q->>'discount')::numeric=0 and jsonb_array_length(q->'adjustments')=0,'student cheaper keeps student scheme');
  created:=public.create_order_with_wallets(cart,'POLICY TEST','TEST','0900000000','policy.rollback@example.test','','atm','delivery','','personal',null,null,0,0,q);
  perform pg_temp.policy_assert((select total_reward=2000 from public.student_reward_snapshots where order_id=created->>'order_id'),'student scheme normal reward');
  update public.promotions set discount_rate=.9 where id=activity;q:=public.quote_order_with_wallets(cart,'delivery','','',0,0);
  perform pg_temp.policy_assert((q->>'discount')::numeric=0 and jsonb_array_length(q->'adjustments')=2,'tie chooses activity');
  created:=public.create_order_with_wallets(cart,'POLICY TEST','TEST','0900000000','policy.rollback@example.test','','atm','delivery','','personal',null,null,0,0,q);
  perform pg_temp.policy_assert((select total_reward=0 from public.student_reward_snapshots where order_id=created->>'order_id'),'tie activity excludes reward');
  results:=results||jsonb_build_array('stale_policy_rejected_student_cheaper_and_activity_tie');
  perform pg_temp.policy_actor(admin_id);update public.promotions set active=false where id=activity;
  activity:=public.save_discount_promotion(jsonb_build_object('name','__POLICY_BOGO__','benefit_type','buy_x_get_y','activation_type','automatic','buy_quantity',3,'gift_quantity',1,'repeat_mode','repeat','scope_type','products','product_ids',jsonb_build_array(product_id),'allow_student_price_stacking',false,'instructor_reward_eligible',false));
  mixed:=jsonb_build_array(jsonb_build_object('product_id',product_id,'variant_id',v1,'qty',5),jsonb_build_object('product_id',other_product,'variant_id',other_variant,'qty',3));
  perform pg_temp.policy_actor(buyer_id);q:=public.quote_order_with_wallets(mixed,'delivery','','',0,0);
  perform pg_temp.policy_assert((q->>'subtotal')::numeric=7200 and (q->>'discount')::numeric=600,'mixed order merchandise payable 6600');
  created:=public.create_order_with_wallets(mixed,'POLICY TEST','TEST','0900000000','policy.rollback@example.test','','atm','delivery','','personal',null,null,0,0,q);mixed_order:=created->>'order_id';
  select to_jsonb(s) into frozen from public.student_reward_snapshots s where order_id=mixed_order;
  perform pg_temp.policy_assert((frozen->>'total_reward')::numeric=800 and frozen#>>'{items,0,reward_excluded_quantity}'='4' and frozen#>>'{items,1,reward_excluded_quantity}'='0','whole group four excluded; remainder plus unrelated four rewarded');
  cart:=jsonb_build_array(jsonb_build_object('product_id',product_id,'variant_id',v1,'qty',2),jsonb_build_object('product_id',product_id,'variant_id',v1,'qty',3),mixed->1);
  q:=public.quote_order_with_wallets(cart,'delivery','','',0,0);
  created:=public.create_order_with_wallets(cart,'POLICY TEST','TEST','0900000000','policy.rollback@example.test','','atm','delivery','','personal',null,null,0,0,q);
  perform pg_temp.policy_assert((select total_reward=800 from public.student_reward_snapshots where order_id=created->>'order_id'),'duplicate variant exclusion counted once');
  perform pg_temp.policy_actor(teacher_id);q:=public.get_my_instructor_reward_report();
  perform pg_temp.policy_assert(exists(select 1 from jsonb_array_elements(q->'orders') o where o->>'order_id'=mixed_order and o#>>'{items,0,reward_excluded_quantity}'='4') and q::text !~ 'instructor_unit_price|student_multiplier|_student_policy','instructor report excluded quantity with private basis hidden');
  perform pg_temp.policy_actor(admin_id);select updated_at into updated from public.promotions where id=activity;
  perform public.save_promotion_student_policy(activity,true,true,updated);
  perform pg_temp.policy_assert((select to_jsonb(s)=frozen from public.student_reward_snapshots s where order_id=mixed_order),'policy edit preserves historical snapshot');
  perform pg_temp.policy_actor(buyer_id);q:=public.quote_order_with_wallets(mixed,'delivery','','',0,0);
  perform pg_temp.policy_assert((q->>'discount')::numeric=900,'stacking uses student basis');
  failed:=false;begin perform public.save_promotion_student_policy(activity,false,false,null);exception when insufficient_privilege then failed:=true;end;
  perform pg_temp.policy_assert(failed,'student cannot edit policy');
  perform pg_temp.policy_actor(admin_id);select updated_at into updated from public.promotions where id=activity;perform public.save_promotion_student_policy(activity,false,false,updated);
  results:=results||jsonb_build_array('mixed_bogo_remainder_unrelated_duplicate_report_immutable_snapshot_and_acl');
  payload:=jsonb_build_object('customer_type','member','member_id',buyer_id,'member','POLICY TEST','phone','0900000000','email','policy.rollback@example.test','address','TEST','note','','payment_method','atm','fulfillment_method','delivery','invoice_type','personal','shipping_mode','default','shipping_amount',null,'shipping_reason','','minimum_reason','TEST rollback minimum override','apply_automatic',true,'shopping_credit_amount',0,'coupon_code','','items',jsonb_build_array(jsonb_build_object('product_id',product_id,'variant_id',v1,'qty',5,'price_mode','AUTO','unit_price',1)));
  q:=public.quote_assisted_order(payload);perform pg_temp.policy_assert((q->>'discount')::numeric=600,'assisted AUTO policy quote');
  created:=public.create_assisted_order(extensions.gen_random_uuid(),payload||jsonb_build_object('expected_quote',q->'confirmation'));
  perform pg_temp.policy_assert((select total_reward=200 from public.student_reward_snapshots where order_id=created->>'order_id'),'assisted AUTO reward remainder');
  payload:=jsonb_set(payload,'{items,0,price_mode}','"MANUAL"');payload:=jsonb_set(payload,'{items,0,unit_price}','777');q:=public.quote_assisted_order(payload);
  perform pg_temp.policy_assert((q->>'discount')::numeric=777,'MANUAL retains existing activity behavior');
  created:=public.create_assisted_order(extensions.gen_random_uuid(),payload||jsonb_build_object('expected_quote',q->'confirmation'));
  perform pg_temp.policy_assert((select total_reward=385 from public.student_reward_snapshots where order_id=created->>'order_id'),'MANUAL retains old reward basis');
  results:=results||jsonb_build_array('real_assisted_auto_manual_orders');
  coupon:=public.save_discount_promotion(jsonb_build_object('name','__POLICY_COUPON__','benefit_type','fixed_discount','activation_type','coupon_only','discount_amount',50,'scope_type','products','product_ids',jsonb_build_array(product_id,other_product)));
  campaign:=public.save_coupon_campaign(jsonb_build_object('name','__POLICY_CAMPAIGN__','code','POLICY_ROLLBACK_20261030','audience_mode','roles','audience_roles',jsonb_build_array('pro'),'allow_guest',false,'stacking_policy','coupon_only','promotion_ids',jsonb_build_array(coupon)));
  perform pg_temp.policy_actor(buyer_id);q:=public.quote_order_with_wallets(mixed,'delivery','POLICY_ROLLBACK_20261030','',0,0);
  perform pg_temp.policy_assert((q->>'discount')::numeric=50 and q#>'{pricing_snapshot,automatic_allocations}'='[]'::jsonb,'coupon-only restores student scheme');
  begin
  created:=public.create_order_with_wallets(mixed,'POLICY TEST','TEST','0900000000','policy.rollback@example.test','','atm','delivery','POLICY_ROLLBACK_20261030','personal',null,null,0,0,q);
  perform pg_temp.policy_assert((select total_reward=1600 from public.student_reward_snapshots where order_id=created->>'order_id'),'suppressed activity restores all rewards');
  raise exception 'Rollback isolated coupon order and its normal rate-limit consumption' using errcode='P9002';
  exception when sqlstate 'P9002' then null;end;
  update public.coupon_campaigns set stacking_policy='allow_all' where id=campaign;
  q:=public.quote_order_with_wallets(mixed,'delivery','POLICY_ROLLBACK_20261030','',0,0);
  perform pg_temp.policy_assert((q->>'discount')::numeric=650,'allow_all nets restoration plus coupon');
  begin
  created:=public.create_order_with_wallets(mixed,'POLICY TEST','TEST','0900000000','policy.rollback@example.test','','atm','delivery','POLICY_ROLLBACK_20261030','personal',null,null,0,0,q);
  perform pg_temp.policy_assert((select total_reward=800 from public.student_reward_snapshots where order_id=created->>'order_id'),'allow_all excludes just active group');
  raise exception 'Rollback isolated coupon order and its normal rate-limit consumption' using errcode='P9002';
  exception when sqlstate 'P9002' then null;end;
  results:=results||jsonb_build_array('real_coupon_only_allow_all_orders_and_rewards');
  update public.orders set status='cancelled' where id=mixed_order;update public.orders set status='cancelled' where id=mixed_order;
  perform pg_temp.policy_assert((select count(*)=1 and sum(amount)=800 from public.instructor_reward_ledger where order_id=mixed_order and event_type='cancel'),'cancellation frozen amount once');
  update public.promotion_student_policy_settings set enabled=false where singleton;
  q:=public.quote_order_with_wallets(mixed,'delivery','','',0,0);perform pg_temp.policy_assert((q->>'discount')::numeric=900,'OFF restores old price behavior');
  update public.automatic_price_allocation_settings set enabled=false where singleton;
  q:=public.quote_order_with_wallets(mixed,'delivery','','',0,0);
  created:=public.create_order_with_wallets(mixed,'POLICY TEST','TEST','0900000000','policy.rollback@example.test','','atm','delivery','','personal',null,null,0,0,q);
  perform pg_temp.policy_assert((select total_reward=1600 from public.student_reward_snapshots where order_id=created->>'order_id'),'both switches OFF old snapshot compatible');
  results:=results||jsonb_build_array('cancel_once_and_both_flags_off_regression');
  raise exception 'Completed policy acceptance; revert all rows' using errcode='P9001';
 exception when sqlstate 'P9001' then null;end;
 perform pg_temp.policy_assert(pg_temp.policy_fingerprint()=before_data,'all public table rows restored');
 perform set_config('test.policy_acceptance',jsonb_build_object('passed',true,'cases',results,'case_count',jsonb_array_length(results),'all_public_table_rows_unchanged',true,'original_order_count',original_orders,'retained_test_orders',0,'bank_calls',0)::text,true);
end $probe$;
select current_setting('test.policy_acceptance')::jsonb as report;
rollback;
