-- Read-only deployment checks. All values should be true after the migration.
select
  to_regprocedure('public.create_assisted_order(uuid,jsonb)') is not null as create_rpc_exists,
  to_regprocedure('public.get_admin_assisted_request(uuid)') is not null as recover_rpc_exists,
  to_regprocedure('public.get_admin_assisted_link(text)') is not null as admin_link_rpc_exists,
  to_regprocedure('public.authorize_assisted_link(text,text)') is not null as private_link_rpc_exists,
  exists(select 1 from information_schema.columns where table_schema='public' and table_name='orders'
    and column_name='assisted_payment_method') as payment_method_exists,
  exists(select 1 from pg_constraint where conrelid='public.orders'::regclass
    and conname='orders_assisted_payment_method_check'
    and position('apple' in pg_get_constraintdef(oid))>0 and position('google' in pg_get_constraintdef(oid))>0) as wallets_allowed,
  exists(select 1 from pg_constraint where conrelid='public.orders'::regclass
    and conname='orders_order_source_check' and position('admin_assisted' in pg_get_constraintdef(oid))>0) as source_allowed,
  exists(select 1 from pg_class where oid=to_regclass('public.assisted_order_requests') and relrowsecurity) as private_requests_rls,
  not has_table_privilege('anon','public.assisted_order_requests','select') as anon_cannot_read_requests,
  not has_table_privilege('authenticated','public.assisted_order_requests','select') as members_cannot_read_requests,
  not has_function_privilege('anon','public.create_assisted_order(uuid,jsonb)','execute') as anon_cannot_create,
  has_function_privilege('authenticated','public.create_assisted_order(uuid,jsonb)','execute') as admins_use_checked_rpc,
  not has_function_privilege('authenticated','public.authorize_assisted_link(text,text)','execute') as link_exchange_server_only,
  not has_function_privilege('authenticated','public.resolve_assisted_payment_claim(text,text,text)','execute') as claim_resolution_server_only,
  has_function_privilege('service_role','public.authorize_assisted_link(text,text)','execute') as server_can_exchange_link,
  exists(select 1 from pg_trigger where tgrelid='public.orders'::regclass and tgname='trg_protect_assisted_order' and not tgisinternal) as snapshot_guard_installed,
  exists(select 1 from pg_trigger where tgrelid='public.orders'::regclass and tgname='trg_assisted_inventory' and not tgisinternal) as early_reservation_installed,
  exists(select 1 from pg_trigger where tgrelid='public.orders'::regclass and tgname='trg_orders_inventory_allocation_sync'
    and position('admin_assisted' in pg_get_triggerdef(oid))>0) as no_second_payment_allocation,
  position('admin_assisted' in pg_get_functiondef('public.create_inventory_count(text)'::regprocedure))>0 as count_includes_pending_reservations,
  position('admin_assisted' in pg_get_functiondef('public.complete_inventory_count(uuid)'::regprocedure))>0 as count_shortage_includes_pending_reservations,
  position('Assisted payment retry result unresolved' in pg_get_functiondef('public.begin_order_payment_retry(text)'::regprocedure))>0 as retry_guard_installed,
  not exists(select 1 from pg_proc where oid in (
    to_regprocedure('public.assign_shipping_group_to_additional_order()'),
    to_regprocedure('public.prepare_shipping_group_for_order_status()'),
    to_regprocedure('public.sync_shipping_group_from_order_status()'))
    and position('admin_assisted' in pg_get_functiondef(oid))=0) as excluded_from_combined_shipping;
