-- LOCAL REPLAY ONLY. Synthetic fixtures; never execute on a Supabase project.
-- Adapted from the saved activity-audience regression; no external providers.
-- All temporary activity changes roll back inside a PL/pgSQL subtransaction.
-- SQL Editor must run the entire file. Any failed assertion aborts the query.
begin;

-- Synthetic data exists only in the disposable local cluster.
insert into auth.users(id,email) values ('88888888-8888-4888-8888-888888888888','local-admin@example.test');
insert into public.admin_users(user_id,role,active) values ('88888888-8888-4888-8888-888888888888','super_admin',true);
insert into public.products(id,name,name_zh,category,slug,price,pro_price,active,publication_status)
 values(900002,'local-audience-product','隔離活動商品','face','local-audience-product',800,500,true,'active');
insert into public.product_variants(id,product_id,sku,size,price,pro_price,stock,is_default,gift_enabled,gift_stock)
 values(900002,900002,'LOCAL-AUDIENCE-ONLY','100ml',800,500,10000,true,true,1000);

set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $probe$
declare
  operator_id uuid;
  synthetic_customer uuid := '00000000-0000-4000-8000-000020261017';
  target_product integer;
  target_variant bigint;
  gift_variant bigint;
  probe_id uuid;
  payload jsonb;
  cart jsonb;
  base jsonb;
  quote jsonb;
  benefit text;
  role_name text;
  expected boolean;
  invalid_accepted boolean;
  original_hash text;
  original_stock_hash text;
  original_reservation_count bigint;
begin
  select md5(jsonb_agg(to_jsonb(p) order by p.id)::text) into original_hash from public.promotions p;
  select md5(jsonb_agg(jsonb_build_array(v.id,v.stock,v.gift_stock) order by v.id)::text)
    into original_stock_hash from public.product_variants v;
  select count(*) into original_reservation_count from public.promotion_gift_reservations;
  select user_id into strict operator_id from public.admin_users where active and role='super_admin' order by user_id limit 1;
  select p.id,v.id into strict target_product,target_variant
    from public.products p join public.product_variants v on v.product_id=p.id
    where p.active and p.publication_status='active' and not p.is_pro_only
      and v.active and v.price>=500 and v.pro_price>=500 order by p.id,v.id limit 1;
  select v.id into strict gift_variant from public.product_variants v join public.products p on p.id=v.product_id
    where v.active and v.gift_enabled and p.publication_status in ('active','event_only','gift_only')
      and v.gift_stock>coalesce((select sum(r.quantity) from public.promotion_gift_reservations r
        where r.product_variant_id=v.id and r.status='reserved' and r.expires_at>now()),0)
    order by v.id limit 1;
  cart := jsonb_build_array(jsonb_build_object('product_id',target_product,'variant_id',target_variant,'qty',50));
  begin
    perform set_config('request.jwt.claim.sub',operator_id::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',operator_id,'role','authenticated')::text,true);
    if not public.has_backoffice_permission('promotions.manage') then raise exception 'Probe admin authorization failed'; end if;
    -- Only this transaction sees these changes; concurrent shoppers keep seeing
    -- the committed activities. Changes are rolled back before the probe ends.
    update public.promotions set active=false where active and activation_type='automatic';
    foreach benefit in array array['percentage_discount','fixed_discount','amount_gift','quantity_gift'] loop
      perform set_config('request.jwt.claim.sub',operator_id::text,true);
      perform set_config('request.jwt.claims',jsonb_build_object('sub',operator_id,'role','authenticated')::text,true);
      payload := jsonb_build_object('name','__audience_probe_20261017__','benefit_type',benefit,
        'activation_type','automatic','scope_type','products','product_ids',jsonb_build_array(target_product),
        'discount_rate',0.9,'discount_amount',500,'active',true,'audience_roles',jsonb_build_array('consumer'),'allow_guest',false);
      if benefit in ('amount_gift','quantity_gift') then
        payload := payload || jsonb_build_object('threshold_value',case when benefit='quantity_gift' then 1 else 1000 end,
          'gift_variant_id',gift_variant,'gift_quantity',1,'repeat_mode','once');
      end if;
      probe_id := public.save_discount_promotion(payload);
      foreach role_name in array array['consumer','pro','instructor','distributor','staff'] loop
        expected := role_name='consumer';
        if public.automatic_promotion_allows_identity(probe_id,role_name,synthetic_customer) is distinct from expected then
          raise exception 'Role eligibility failed: %, %',benefit,role_name;
        end if;
      end loop;
      if public.automatic_promotion_allows_identity(probe_id,'consumer',null) then raise exception 'Guest exclusion failed'; end if;
      perform set_config('request.jwt.claim.sub',synthetic_customer::text,true);
      perform set_config('request.jwt.claims',jsonb_build_object('sub',synthetic_customer,'role','authenticated')::text,true);
      quote := public.quote_order_pricing(cart,'delivery','','');
      if benefit='percentage_discount' and (quote->>'discount')::numeric <> round((quote->>'subtotal')::numeric*0.1) then
        raise exception 'Storefront percentage failed';
      elsif benefit='fixed_discount' and (quote->>'discount')::numeric <> 500 then raise exception 'Storefront fixed failed';
      elsif benefit in ('amount_gift','quantity_gift') and jsonb_array_length(quote->'gifts') <> 1 then raise exception 'Storefront gift failed'; end if;
      perform set_config('request.jwt.claim.sub','',true);
      perform set_config('request.jwt.claims','{}',true);
      quote := public.quote_order_pricing(cart,'delivery','','');
      if (quote->>'discount')::numeric <> 0 or jsonb_array_length(quote->'gifts') <> 0 then raise exception 'Storefront guest exclusion failed'; end if;
      base := quote;
      perform set_config('request.jwt.claim.sub',operator_id::text,true);
      perform set_config('request.jwt.claims',jsonb_build_object('sub',operator_id,'role','authenticated')::text,true);
      -- Operator signed in, customer a guest: must still reject the activity.
      quote := public.assisted_gift_quote(base,'delivery','','',null,true);
      if (quote->>'discount')::numeric <> 0 or jsonb_array_length(quote->'gifts') <> 0 then raise exception 'Assisted guest identity failed'; end if;
      payload := payload || jsonb_build_object('id',probe_id,'audience_roles',jsonb_build_array('pro','instructor'),'allow_guest',false);
      perform public.save_discount_promotion(payload);
      foreach role_name in array array['consumer','pro','instructor','distributor','staff'] loop
        quote := public.assisted_gift_quote(base || jsonb_build_object('member_role',role_name),'delivery','','',synthetic_customer,true);
        expected := role_name in ('pro','instructor');
        if benefit in ('amount_gift','quantity_gift') then
          if (jsonb_array_length(quote->'gifts')=1) is distinct from expected then raise exception 'Assisted gift role failed: %',role_name; end if;
        elsif ((quote->>'discount')::numeric>0) is distinct from expected then raise exception 'Assisted discount role failed: %',role_name; end if;
      end loop;
      -- A guest-only activity must reject authenticated members.
      payload := payload || jsonb_build_object('audience_roles','[]'::jsonb,'allow_guest',true);
      perform public.save_discount_promotion(payload);
      if not public.automatic_promotion_allows_identity(probe_id,'consumer',null)
        or public.automatic_promotion_allows_identity(probe_id,'consumer',synthetic_customer) then raise exception 'Guest-only eligibility failed'; end if;
      -- Older clients omit audience fields. Saving must preserve the audience.
      perform public.save_discount_promotion(payload - 'audience_roles' - 'allow_guest');
      if not exists(select 1 from public.promotions where id=probe_id and audience_roles='{}'::text[] and allow_guest) then
        raise exception 'Older client reset audience'; end if;
      invalid_accepted := false;
      begin
        perform public.save_discount_promotion(payload || jsonb_build_object('audience_roles','[]'::jsonb,'allow_guest',false));
        invalid_accepted := true;
      exception when check_violation then null;
      end;
      if invalid_accepted then raise exception 'Empty audience accepted'; end if;
      update public.promotions set active=false where id=probe_id;
    end loop;
    -- Expected exception rolls back every test activity, audit row and scope.
    raise exception 'Completed probe; revert test changes' using errcode='P9001';
  exception when sqlstate 'P9001' then null;
  end;
  if (select md5(jsonb_agg(to_jsonb(p) order by p.id)::text) from public.promotions p) is distinct from original_hash then
    raise exception 'Activity rollback mismatch'; end if;
  if (select md5(jsonb_agg(jsonb_build_array(v.id,v.stock,v.gift_stock) order by v.id)::text) from public.product_variants v) is distinct from original_stock_hash then
    raise exception 'Inventory mismatch'; end if;
  if (select count(*) from public.promotion_gift_reservations) <> original_reservation_count then raise exception 'Reservation mismatch'; end if;
end $probe$;
commit;
