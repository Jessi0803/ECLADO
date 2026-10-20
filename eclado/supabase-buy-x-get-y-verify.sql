-- Read-only post-install checks. All values must be true.
select
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
    from unnest(array['public.quote_assisted_order(jsonb)','public.create_assisted_order_base_v1(uuid,jsonb)','public.create_assisted_order(uuid,jsonb)']) signature) as assisted_product_id_bounds;
