select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
      and column_name = 'shopping_credit_amount'
  ) as shopping_credit_amount_exists,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
      and column_name = 'payment_amount'
  ) as payment_amount_exists,
  to_regprocedure(
    'public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint)'
  ) is not null as shopping_credit_order_rpc_exists,
  to_regprocedure('public.sync_shopping_credit_from_order_status()') is not null
    as lifecycle_trigger_function_exists,
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.orders'::regclass
      and tgname = 'trg_orders_payment_amount_defaults'
      and not tgisinternal
  ) as payment_snapshot_insert_trigger_exists,
  pg_get_functiondef('public.set_order_payment_amount_defaults()'::regprocedure)
    ilike '%eclado_order_shopping_credit_amount%'
    and pg_get_functiondef('public.set_order_payment_amount_defaults()'::regprocedure)
      ilike '%new.pricing_snapshot%'
    as payment_snapshot_written_on_insert,
  pg_get_functiondef('public.protect_order_pricing_snapshot()'::regprocedure)
    ilike '%new.shopping_credit_amount is distinct from old.shopping_credit_amount%'
    and pg_get_functiondef('public.protect_order_pricing_snapshot()'::regprocedure)
      ilike '%new.payment_amount is distinct from old.payment_amount%'
    as payment_snapshot_is_immutable,
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.orders'::regclass
      and tgname = 'trg_sync_shopping_credit_from_order_status'
      and not tgisinternal
  ) as lifecycle_trigger_exists,
  pg_get_functiondef('public.claim_order_payment(text,text)'::regprocedure)
    ilike '%target_order.payment_amount%'
    as payment_claim_uses_gateway_amount,
  has_function_privilege(
    'authenticated',
    'public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint)',
    'EXECUTE'
  ) as member_can_create_credit_order,
  has_function_privilege(
    'anon',
    'public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint)',
    'EXECUTE'
  ) as guest_can_call_order_rpc;
