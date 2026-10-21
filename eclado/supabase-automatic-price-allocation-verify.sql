-- Read-only installation checks. enabled is intentionally not an assertion:
-- a fresh installation remains OFF; staging acceptance enables it explicitly.
select
  to_regclass('public.automatic_price_allocation_settings') is not null as settings_exist,
  (select relrowsecurity from pg_class where oid='public.automatic_price_allocation_settings'::regclass) as settings_rls,
  not has_table_privilege('anon','public.automatic_price_allocation_settings','UPDATE')
    and not has_table_privilege('authenticated','public.automatic_price_allocation_settings','UPDATE') as no_client_switch,
  not has_function_privilege('anon','public.allocate_automatic_prices(jsonb,text,uuid)','EXECUTE')
    and not has_function_privilege('authenticated','public.allocate_automatic_prices(jsonb,text,uuid)','EXECUTE') as private_allocator,
  not has_function_privilege('anon','public.quote_order_pricing_allocation_base(jsonb,text)','EXECUTE') as private_authority,
  not exists(select 1 from pg_proc p where p.pronamespace='public'::regnamespace
    and p.proname='create_order_with_allocation_confirmation_base'
    and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))) as private_creators,
  position('allocation_result jsonb' in pg_get_functiondef('public.quote_order_pricing_discount_v2(jsonb,text,text,text)'::regprocedure))>0 as storefront_connected,
  position('allocation_result jsonb' in pg_get_functiondef('public.assisted_discount_quote(jsonb,text,text,text,uuid,boolean)'::regprocedure))>0 as assisted_connected,
  position('automatic_allocations' in pg_get_functiondef('public.student_price_confirmation(jsonb)'::regprocedure))>0 as confirmation_versioned,
  (select base_source_hash=md5(pg_get_functiondef('public.quote_order_pricing_internal_20260916(jsonb,text)'::regprocedure))
    from public.automatic_price_allocation_settings where singleton) as authority_matches;
