-- TEST ONLY qqlgqasbmbicnmvnlqbr. Reusable UI fixture, archived after acceptance.
-- Uses only the existing TEST product. No customer, catalog, stock or order writes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $fixture$
#variable_conflict use_variable
declare admin_id uuid; buyer_id uuid; product_id integer; a bigint; b bigint; activity uuid; q jsonb;
begin
 select id into strict admin_id from auth.users where lower(email)='admin.stage@eclado.test';
 select id into strict buyer_id from auth.users where lower(email)='student.stage@eclado.test';
 perform set_config('request.jwt.claim.sub',admin_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
 if not public.has_backoffice_permission('promotions.manage')
  or (select count(*) from public.orders)<>1
  or exists(select 1 from public.promotions where name<>'TEST｜學生互斥買3送1｜20261030')
  or (select count(*) from public.promotions where name='TEST｜學生互斥買3送1｜20261030')>1
  or exists(select 1 from public.promotions where name='TEST｜學生互斥買3送1｜20261030' and (active or archived_at is null))
  or (select enabled from public.automatic_price_allocation_settings where singleton)
  or (select enabled from public.promotion_student_policy_settings where singleton)
 then raise exception 'TEST baseline differs; stop';end if;
 select id into strict product_id from public.products where slug='reward-system-test-product';
 select id into strict a from public.product_variants v where v.product_id=product_id and v.sku='TEST-REWARD-100';
 select id into strict b from public.product_variants v where v.product_id=product_id and v.sku='TEST-REWARD-200';
 select id into activity from public.promotions where name='TEST｜學生互斥買3送1｜20261030';
 update public.promotions set archived_at=null where id=activity;
 activity:=public.save_discount_promotion(jsonb_build_object(
  'id',activity,'name','TEST｜學生互斥買3送1｜20261030','benefit_type','buy_x_get_y','activation_type','automatic',
  'buy_quantity',3,'gift_quantity',1,'repeat_mode','repeat','scope_type','products','product_ids',jsonb_build_array(product_id),
  'audience_roles',jsonb_build_array('pro'),'allow_guest',false,'active',true,
  'start_at',clock_timestamp()-interval '1 minute','end_at',clock_timestamp()+interval '2 hours',
  'allow_student_price_stacking',false,'instructor_reward_eligible',false));
 update public.promotion_scopes set target_type='variant',product_id=null,product_variant_id=a where promotion_id=activity;
 update public.promotions set storefront_scope_type=null where id=activity;
 update public.automatic_price_allocation_settings set enabled=true where singleton;
 update public.promotion_student_policy_settings set enabled=true where singleton;
 perform set_config('request.jwt.claim.sub',buyer_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',buyer_id,'role','authenticated')::text,true);
 q:=public.quote_order_with_wallets(jsonb_build_array(
  jsonb_build_object('product_id',product_id,'variant_id',a,'qty',5),
  jsonb_build_object('product_id',product_id,'variant_id',b,'qty',3)),'delivery','','',0,0);
 if (q->>'subtotal')::numeric<>8820 or (q->>'discount')::numeric<>600 then
  raise exception 'Unexpected TEST pricing: %',q;end if;
 perform set_config('test.policy_ui_fixture',jsonb_build_object('promotion_id',activity,'product_id',product_id,'activity_variant',a,
  'other_variant',b,'subtotal',q->'subtotal','discount',q->'discount','total',q->'total','shipping',q->'shipping',
  'original_orders',1,'cleanup','archive marker activity and restore both switches false')::text,true);
end $fixture$;
select current_setting('test.policy_ui_fixture')::jsonb as fixture;
commit;
