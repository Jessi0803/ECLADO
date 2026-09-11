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
  ),
  'gift_product_columns', (
    select array_agg(required.column_name order by required.column_name) =
      array['name', 'name_zh']::text[]
    from (values ('name'), ('name_zh')) required(column_name)
    where exists (
      select 1 from information_schema.columns actual
      where actual.table_schema='public' and actual.table_name='products'
        and actual.column_name=required.column_name
    )
  ),
  'gift_quote_uses_current_product_schema', coalesce((
    select pg_get_functiondef(procedure.oid) like '%product.name_zh, product.name,%'
      and pg_get_functiondef(procedure.oid) not like '%product.name_en%'
      and pg_get_functiondef(procedure.oid) not like '%product.image_storage_path%'
    from pg_proc procedure
    where procedure.oid=to_regprocedure('public.quote_order_pricing(jsonb,text,text,text)')
  ), false),
  'all_sellable_scope', exists (
    select 1 from pg_constraint
    where conname='promotion_scopes_target_type_check'
      and pg_get_constraintdef(oid) like '%all_sellable%'
  )
) as batch_4_status;
