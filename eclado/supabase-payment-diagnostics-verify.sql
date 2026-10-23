-- Read-only; no customer/payment records returned.
select jsonb_build_object(
  'rls_enabled', (select relrowsecurity from pg_class where oid='public.order_payment_diagnostics'::regclass),
  'column_count', (select count(*) from information_schema.columns where table_schema='public' and table_name='order_payment_diagnostics'),
  'anon_direct_denied', not has_table_privilege('anon','public.order_payment_diagnostics','SELECT,INSERT,UPDATE,DELETE'),
  'member_direct_denied', not has_table_privilege('authenticated','public.order_payment_diagnostics','SELECT,INSERT,UPDATE,DELETE'),
  'service_insert', has_table_privilege('service_role','public.order_payment_diagnostics','INSERT'),
  'service_update_denied', not has_table_privilege('service_role','public.order_payment_diagnostics','UPDATE'),
  'anon_rpc_denied', not has_function_privilege('anon','public.get_admin_order_payment_diagnostics(text)','EXECUTE'),
  'authenticated_rpc', has_function_privilege('authenticated','public.get_admin_order_payment_diagnostics(text)','EXECUTE'),
  'orders_permission_guard', position('has_backoffice_permission(''orders.read'')' in pg_get_functiondef('public.get_admin_order_payment_diagnostics(text)'::regprocedure))>0,
  'record_count', (select count(*) from public.order_payment_diagnostics),
  'verified_at', clock_timestamp()
) as payment_diagnostics_verification;
