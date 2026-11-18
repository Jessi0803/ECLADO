-- REVIEW ONLY: restore captured functions ONLY before the supplement is granted.
-- After supplementation, keep compatibility for future cancellation/return; rollback is refused.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.orders in access exclusive mode;
do $undo$
begin
  if md5(pg_get_functiondef('public.release_inventory_for_order(text)'::regprocedure)) <> 'f29fbe0faea2e8b746eca6765306f853'
    or md5(pg_get_functiondef('public.allocate_inventory_for_paid_order(text,jsonb)'::regprocedure)) <> '5774550558ba91ac5035411099145937' then
    raise exception 'Rollback requires exact compatible definitions; never overwrite later changes';
  end if;
  if not exists(select 1 from public.orders where id='ECL-20261103-155424-8308FA6E' and jsonb_array_length(items)=7)
    or exists(select 1 from public.order_adjustments where order_id='ECL-20261103-155424-8308FA6E' and metadata->>'operation_key'='one_off_1111_phase2_20261105_8308FA6E')
    or exists(select 1 from public.audit_logs where entity_id='ECL-20261103-155424-8308FA6E' and metadata->>'operation_key'='one_off_1111_phase2_20261105_8308FA6E')
    or exists(select 1 from public.order_inventory_allocations where order_id='ECL-20261103-155424-8308FA6E' and item_index>=7)
    or exists(select 1 from public.promotion_gift_reservations where order_id='ECL-20261103-155424-8308FA6E'
      and promotion_id in('6a03c582-3102-4b0a-a063-229ea1e28b21','44478b76-3cee-4157-918f-ecb4fc15f275')) then
    raise exception 'Rollback refused after supplement; preserve compatible release and reopen guard';
  end if;
  execute $original_release$CREATE OR REPLACE FUNCTION public.release_inventory_for_order(target_order_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  allocation record;
begin
  -- Match the payment/FIFO lock order: variants first, allocations second.
  perform 1
  from public.product_variants variant
  where variant.id in (
    select item.product_variant_id
    from public.order_inventory_allocations item
    where item.order_id = target_order_id
      and item.state <> 'released'
  )
  order by variant.id
  for update;

  for allocation in
    select *
    from public.order_inventory_allocations
    where order_id = target_order_id
      and state <> 'released'
    order by product_variant_id, item_index
    for update
  loop
    if allocation.stock_deducted_qty > 0 then
      update public.product_variants
      set stock = stock + allocation.stock_deducted_qty
      where id = allocation.product_variant_id;

      insert into public.inventory_allocation_events (
        allocation_id, order_id, product_variant_id, event_type, quantity, actor_user_id
      ) values (
        allocation.id, target_order_id, allocation.product_variant_id,
        'release', allocation.stock_deducted_qty, auth.uid()
      );
    end if;

    update public.order_inventory_allocations
    set
      released_qty = released_qty + allocated_qty,
      allocated_qty = 0,
      backorder_qty = 0,
      stock_deducted_qty = 0,
      state = 'released',
      released_at = now(),
      updated_at = now()
    where id = allocation.id;

    perform public.sync_product_stock_mirror(allocation.product_id);
  end loop;
end;
$function$
$original_release$;
  execute $original_allocate$CREATE OR REPLACE FUNCTION public.allocate_inventory_for_paid_order(target_order_id text, order_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  item record;
  item_qty integer;
  variant_id bigint;
  available_qty integer;
  allocated integer;
  missing integer;
  allocation_id bigint;
  product_id integer;
  sku text;
  product_name text;
  variant_name text;
begin
  if order_items is null or jsonb_typeof(order_items) <> 'array' then
    raise exception 'Order items must be an array' using errcode = '22023';
  end if;

  -- Lock every referenced variant in deterministic order. This prevents two
  -- multi-item payments from taking the same row locks in opposite order.
  perform 1
  from public.product_variants variant
  where variant.id in (
    select (entry.value ->> 'variant_id')::bigint
    from jsonb_array_elements(order_items) entry
    where coalesce(entry.value ->> 'variant_id', '') ~ '^[0-9]+$'
  )
  order by variant.id
  for update;

  for item in
    select value, (ordinality - 1)::integer as item_index
    from jsonb_array_elements(order_items) with ordinality
  loop
    item_qty := coalesce(nullif(item.value ->> 'qty', '')::integer, 0);
    if item_qty <= 0 then
      raise exception 'Invalid quantity on order % item %', target_order_id, item.item_index
        using errcode = '22023';
    end if;

    variant_id := case
      when coalesce(item.value ->> 'variant_id', '') ~ '^[0-9]+$'
        then (item.value ->> 'variant_id')::bigint
      else null
    end;
    if variant_id is null then
      select variant.id into variant_id
      from public.product_variants variant
      where variant.product_id = nullif(item.value ->> 'product_id', '')::integer
        and variant.is_default is true
      order by variant.id
      limit 1
      for update;
    end if;

    select
      variant.product_id,
      variant.sku,
      variant.size,
      variant.stock,
      product.name_zh
    into product_id, sku, variant_name, available_qty, product_name
    from public.product_variants variant
    join public.products product on product.id = variant.product_id
    where variant.id = variant_id
    for update of variant;

    if not found then
      raise exception 'Product variant is missing for order % item %', target_order_id, item.item_index
        using errcode = 'P0002';
    end if;

    allocated := least(item_qty, greatest(coalesce(available_qty, 0), 0));
    missing := item_qty - allocated;

    if allocated > 0 then
      update public.product_variants
      set stock = stock - allocated
      where id = variant_id;
    end if;

    insert into public.order_inventory_allocations (
      order_id, item_index, product_id, product_variant_id, sku,
      product_name, variant_name, requested_qty, allocated_qty,
      backorder_qty, stock_deducted_qty, released_qty, state, source,
      priority_at, allocated_at, last_allocated_at, released_at, updated_at
    ) values (
      target_order_id, item.item_index, product_id, variant_id, sku,
      coalesce(nullif(item.value ->> 'name', ''), product_name),
      coalesce(nullif(item.value ->> 'size', ''), variant_name),
      item_qty, allocated, missing, allocated, 0,
      case when missing = 0 then 'allocated' when allocated = 0 then 'backordered' else 'partial' end,
      'payment_allocation', now(),
      case when allocated > 0 then now() else null end,
      case when allocated > 0 then now() else null end,
      null, now()
    )
    on conflict (order_id, item_index) do update set
      product_id = excluded.product_id,
      product_variant_id = excluded.product_variant_id,
      sku = excluded.sku,
      product_name = excluded.product_name,
      variant_name = excluded.variant_name,
      requested_qty = excluded.requested_qty,
      allocated_qty = excluded.allocated_qty,
      backorder_qty = excluded.backorder_qty,
      stock_deducted_qty = excluded.stock_deducted_qty,
      state = excluded.state,
      source = excluded.source,
      priority_at = excluded.priority_at,
      allocated_at = excluded.allocated_at,
      last_allocated_at = excluded.last_allocated_at,
      released_at = null,
      updated_at = now()
    returning id into allocation_id;

    if allocated > 0 then
      insert into public.inventory_allocation_events (
        allocation_id, order_id, product_variant_id, event_type, quantity, actor_user_id
      ) values (
        allocation_id, target_order_id, variant_id, 'payment_allocate', allocated, auth.uid()
      );
    end if;

    perform public.sync_product_stock_mirror(product_id);
  end loop;
end;
$function$
$original_allocate$;
end;
$undo$;
rollback;
