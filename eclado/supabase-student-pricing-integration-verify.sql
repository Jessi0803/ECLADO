-- Metadata only; do not call create/quote or enable the feature in production.
begin transaction read only;
select jsonb_build_object(
  'feature_off',(select enabled=false from public.student_pricing_feature_settings where singleton),
  'feature_rls',(select relrowsecurity from pg_class where oid='public.student_pricing_feature_settings'::regclass),
  'client_cannot_read_or_write_flag',not has_table_privilege('anon','public.student_pricing_feature_settings','SELECT,INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated','public.student_pricing_feature_settings','SELECT,INSERT,UPDATE,DELETE'),
  'base_integrated',position('public.apply_student_price' in pg_get_functiondef('public.quote_order_pricing_internal_20260916(jsonb,text)'::regprocedure))>0,
  'assisted_quote_integrated',position('public.assisted_auto_unit_price' in pg_get_functiondef('public.quote_assisted_order(jsonb)'::regprocedure))>0,
  'assisted_create_integrated',position('public.assisted_auto_unit_price' in pg_get_functiondef('public.create_assisted_order(uuid,jsonb)'::regprocedure))>0,
  'same_assisted_quote_totals',position('subtotal_amount:=(benefit_quote->>''subtotal'')::numeric' in pg_get_functiondef('public.create_assisted_order(uuid,jsonb)'::regprocedure))>0,
  'internal_helpers_blocked',(select bool_and(not has_function_privilege('anon',sig,'EXECUTE') and not has_function_privilege('authenticated',sig,'EXECUTE'))
    from unnest(array['public.student_pricing_multiplier(uuid)','public.apply_student_price(numeric,numeric)',
      'public.assisted_auto_unit_price(uuid,text,public.products,public.product_variants,numeric)','public.student_price_confirmation(jsonb)']) sig),
  'public_endpoints_allowed',(select bool_and(has_function_privilege('anon',sig,'EXECUTE') and has_function_privilege('authenticated',sig,'EXECUTE'))
    from unnest(array['public.get_my_student_product_prices()',
      'public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint,jsonb)']) sig)
) as verification;
rollback;
