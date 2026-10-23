-- Read-only production verification. No customer rows are returned.
select jsonb_build_object(
  'rls_enabled', (select relrowsecurity from pg_class where oid = 'public.checkout_events'::regclass),
  'column_count', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'checkout_events'),
  'index_count', (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'checkout_events'),
  'anon_denied', not has_table_privilege('anon', 'public.checkout_events', 'SELECT,INSERT,UPDATE,DELETE'),
  'member_writes_denied', not has_table_privilege('authenticated', 'public.checkout_events', 'INSERT,UPDATE,DELETE'),
  'admin_read_policy', (select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'checkout_events'
    and policyname = 'checkout_events_admin_read' and qual like '%is_eclado_admin%'),
  'rpc_service_only', has_function_privilege('service_role', 'public.ingest_checkout_browser_events(text,jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.ingest_checkout_browser_events(text,jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.ingest_checkout_browser_events(text,jsonb)', 'EXECUTE'),
  'capture_not_public', not has_function_privilege('anon', 'public.capture_checkout_database_event()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.capture_checkout_database_event()', 'EXECUTE'),
  'enabled_triggers', (select count(*) from pg_trigger
    where tgname in ('trg_checkout_order_stored', 'trg_checkout_gateway_recorded') and tgenabled = 'O'),
  'event_count', (select count(*) from public.checkout_events),
  'orders_count', (select count(*) from public.orders),
  'verified_at', clock_timestamp()
) as checkout_verification;
