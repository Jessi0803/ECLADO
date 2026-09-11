select jsonb_build_object(
  'quote_rpc', to_regprocedure('public.quote_order_pricing(jsonb,text,text,text)') is not null,
  'order_rpc', to_regprocedure('public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text)') is not null,
  'discount_quote_helper', to_regprocedure('public.quote_order_pricing_discount_v2(jsonb,text,text,text)') is not null,
  'discount_order_helper', to_regprocedure('public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)') is not null,
  'gift_status', exists (
    select 1 from pg_constraint
    where conname='products_publication_status_check'
      and pg_get_constraintdef(oid) like '%gift_only%'
  ),
  'gift_reservation_trigger', exists (
    select 1 from pg_trigger
    where tgname='trg_sync_gift_reservation_from_order_status' and not tgisinternal
  ),
  'gift_inventory_source', exists (
    select 1 from pg_constraint
    where conname='order_inventory_allocations_source_check'
      and pg_get_constraintdef(oid) like '%promotion_gift%'
  ),
  'discount_threshold_type', exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='promotions'
      and column_name='threshold_type'
  )
) as batch_4_status;
