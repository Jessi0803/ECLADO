-- ECLADO order inventory allocation v2
--
-- Canonical inventory lives on product_variants.stock. An order receives stock
-- only when it first enters an inventory-active (paid/fulfilment) status.
-- Backorders remain attached to the paid order until an administrator runs the
-- FIFO allocation RPC. Purchase-order "received" status is intentionally not
-- connected to this migration and continues to update status/time only.

begin;

create table if not exists public.order_inventory_allocations (
  id bigserial primary key,
  order_id text not null references public.orders(id) on delete cascade deferrable initially deferred,
  item_index integer not null check (item_index >= 0),
  product_id integer not null references public.products(id) on delete restrict,
  product_variant_id bigint not null references public.product_variants(id) on delete restrict,
  sku text not null,
  product_name text not null,
  variant_name text not null,
  requested_qty integer not null check (requested_qty > 0),
  allocated_qty integer not null default 0 check (allocated_qty >= 0),
  backorder_qty integer not null default 0 check (backorder_qty >= 0),
  stock_deducted_qty integer not null default 0 check (stock_deducted_qty >= 0),
  released_qty integer not null default 0 check (released_qty >= 0),
  state text not null check (state in ('allocated', 'partial', 'backordered', 'released')),
  source text not null default 'payment_allocation'
    check (source in ('payment_allocation', 'legacy_snapshot')),
  priority_at timestamptz not null default now(),
  allocated_at timestamptz,
  last_allocated_at timestamptz,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, item_index),
  check (allocated_qty + backorder_qty <= requested_qty),
  check (stock_deducted_qty <= allocated_qty)
);

create index if not exists idx_order_inventory_allocations_fifo
  on public.order_inventory_allocations (product_variant_id, priority_at, id)
  where backorder_qty > 0 and state in ('partial', 'backordered');
create index if not exists idx_order_inventory_allocations_order
  on public.order_inventory_allocations (order_id, item_index);

create table if not exists public.inventory_allocation_events (
  id bigserial primary key,
  allocation_id bigint not null references public.order_inventory_allocations(id) on delete cascade,
  order_id text not null references public.orders(id) on delete cascade deferrable initially deferred,
  product_variant_id bigint not null references public.product_variants(id) on delete restrict,
  event_type text not null check (event_type in ('payment_allocate', 'fifo_allocate', 'release')),
  quantity integer not null check (quantity > 0),
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_inventory_allocation_events_order
  on public.inventory_allocation_events (order_id, created_at, id);

alter table public.order_inventory_allocations enable row level security;
alter table public.inventory_allocation_events enable row level security;
revoke all on table public.order_inventory_allocations from anon, authenticated;
revoke all on table public.inventory_allocation_events from anon, authenticated;

create or replace function public.order_consumes_inventory(order_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select order_status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered');
$$;

create or replace function public.sync_product_stock_mirror(target_product_id integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.products product
  set stock = variant.stock
  from public.product_variants variant
  where product.id = target_product_id
    and variant.product_id = product.id
    and variant.is_default is true
    and product.stock is distinct from variant.stock;
$$;

create or replace function public.allocate_inventory_for_paid_order(
  target_order_id text,
  order_items jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

create or replace function public.release_inventory_for_order(target_order_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

create or replace function public.sync_inventory_allocation_for_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if public.order_consumes_inventory(new.status) then
      perform public.allocate_inventory_for_paid_order(new.id, new.items);
    end if;
    return new;
  end if;

  if public.order_consumes_inventory(old.status)
    and public.order_consumes_inventory(new.status)
    and old.items is distinct from new.items
  then
    raise exception 'Paid order items cannot be changed after inventory allocation'
      using errcode = '55000';
  end if;

  if not public.order_consumes_inventory(old.status)
    and public.order_consumes_inventory(new.status)
  then
    perform public.allocate_inventory_for_paid_order(new.id, new.items);
  elsif public.order_consumes_inventory(old.status)
    and not public.order_consumes_inventory(new.status)
  then
    perform public.release_inventory_for_order(old.id);
  end if;

  if new.status in ('ready_for_pickup', 'picked_up', 'shipped', 'delivered')
    and exists (
      select 1
      from public.order_inventory_allocations allocation
      where allocation.order_id = new.id
        and allocation.backorder_qty > 0
        and allocation.state in ('partial', 'backordered')
    )
  then
    raise exception 'Order still contains backordered inventory and cannot be completed'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_inventory_sync on public.orders;
drop trigger if exists trg_orders_inventory_allocation_sync on public.orders;
create trigger trg_orders_inventory_allocation_sync
  before insert or update of status, items on public.orders
  for each row execute function public.sync_inventory_allocation_for_order();

-- Preserve visibility for already-paid orders without guessing that legacy
-- product-level deductions also changed variant stock. Only later FIFO amounts
-- are restorable for these rows (stock_deducted_qty starts at zero).
insert into public.order_inventory_allocations (
  order_id, item_index, product_id, product_variant_id, sku,
  product_name, variant_name, requested_qty, allocated_qty,
  backorder_qty, stock_deducted_qty, state, source, priority_at,
  allocated_at, last_allocated_at
)
select
  orders.id,
  (entry.ordinality - 1)::integer,
  variant.product_id,
  variant.id,
  variant.sku,
  coalesce(nullif(entry.value ->> 'name', ''), product.name_zh),
  coalesce(nullif(entry.value ->> 'size', ''), variant.size),
  greatest(coalesce(nullif(entry.value ->> 'qty', '')::integer, 0), 1),
  least(
    greatest(coalesce(nullif(entry.value ->> 'qty', '')::integer, 0), 1),
    greatest(coalesce(nullif(entry.value ->> 'stock_at_order', '')::integer, 0), 0)
  ),
  greatest(
    greatest(coalesce(nullif(entry.value ->> 'qty', '')::integer, 0), 1)
      - greatest(coalesce(nullif(entry.value ->> 'stock_at_order', '')::integer, 0), 0),
    0
  ),
  0,
  case
    when greatest(coalesce(nullif(entry.value ->> 'stock_at_order', '')::integer, 0), 0) <= 0
      then 'backordered'
    when greatest(coalesce(nullif(entry.value ->> 'stock_at_order', '')::integer, 0), 0)
      < greatest(coalesce(nullif(entry.value ->> 'qty', '')::integer, 0), 1)
      then 'partial'
    else 'allocated'
  end,
  'legacy_snapshot',
  coalesce(orders.updated_at, orders.created_at, now()),
  case when greatest(coalesce(nullif(entry.value ->> 'stock_at_order', '')::integer, 0), 0) > 0
    then coalesce(orders.updated_at, orders.created_at, now()) else null end,
  case when greatest(coalesce(nullif(entry.value ->> 'stock_at_order', '')::integer, 0), 0) > 0
    then coalesce(orders.updated_at, orders.created_at, now()) else null end
from public.orders orders
cross join lateral jsonb_array_elements(orders.items) with ordinality entry
join public.product_variants variant on variant.id = case
  when coalesce(entry.value ->> 'variant_id', '') ~ '^[0-9]+$'
    then (entry.value ->> 'variant_id')::bigint
  else null
end
join public.products product on product.id = variant.product_id
where public.order_consumes_inventory(orders.status)
on conflict (order_id, item_index) do nothing;

create or replace function public.get_admin_inventory_allocations()
returns table (
  order_id text,
  item_index integer,
  product_variant_id bigint,
  requested_qty integer,
  allocated_qty integer,
  backorder_qty integer,
  released_qty integer,
  state text,
  source text,
  priority_at timestamptz,
  last_allocated_at timestamptz,
  released_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_backoffice_permission('orders.read') then
    raise exception 'Order read authorization required' using errcode = '42501';
  end if;

  return query
  select
    allocation.order_id,
    allocation.item_index,
    allocation.product_variant_id,
    allocation.requested_qty,
    allocation.allocated_qty,
    allocation.backorder_qty,
    allocation.released_qty,
    allocation.state,
    allocation.source,
    allocation.priority_at,
    allocation.last_allocated_at,
    allocation.released_at
  from public.order_inventory_allocations allocation
  order by allocation.order_id, allocation.item_index;
end;
$$;

create or replace function public.get_backorder_management_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare payload jsonb;
begin
  if not public.has_backoffice_permission('backorders.manage') then
    raise exception 'Backorder management authorization required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'variant_id', variant.id,
      'product_id', variant.product_id,
      'sku', variant.sku,
      'product_name', product.name_zh,
      'variant_name', variant.size,
      'available_stock', variant.stock,
      'total_backorder_qty', summary.total_backorder_qty,
      'order_count', summary.order_count,
      'orders', summary.orders
    ) order by summary.oldest_priority_at, variant.id
  ), '[]'::jsonb)
  into payload
  from public.product_variants variant
  join public.products product on product.id = variant.product_id
  join lateral (
    select
      sum(allocation.backorder_qty)::integer as total_backorder_qty,
      count(distinct allocation.order_id)::integer as order_count,
      min(allocation.priority_at) as oldest_priority_at,
      jsonb_agg(jsonb_build_object(
        'allocation_id', allocation.id,
        'order_id', allocation.order_id,
        'member', orders.member,
        'order_status', orders.status,
        'requested_qty', allocation.requested_qty,
        'allocated_qty', allocation.allocated_qty,
        'backorder_qty', allocation.backorder_qty,
        'priority_at', allocation.priority_at,
        'source', allocation.source
      ) order by allocation.priority_at, orders.created_at, allocation.id) as orders
    from public.order_inventory_allocations allocation
    join public.orders orders on orders.id = allocation.order_id
    where allocation.product_variant_id = variant.id
      and allocation.backorder_qty > 0
      and allocation.state in ('partial', 'backordered')
      and public.order_consumes_inventory(orders.status)
  ) summary on summary.total_backorder_qty > 0;

  return payload;
end;
$$;

create or replace function public.allocate_backordered_inventory(p_variant_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  variant_row public.product_variants%rowtype;
  allocation record;
  assign_qty integer;
  total_assigned integer := 0;
  affected_orders text[] := '{}'::text[];
begin
  if not public.has_backoffice_permission('backorders.manage') then
    raise exception 'Backorder management authorization required' using errcode = '42501';
  end if;

  select * into variant_row
  from public.product_variants
  where id = p_variant_id
  for update;

  if not found then
    raise exception 'Product variant not found' using errcode = 'P0002';
  end if;

  for allocation in
    select item.*
    from public.order_inventory_allocations item
    join public.orders orders on orders.id = item.order_id
    where item.product_variant_id = p_variant_id
      and item.backorder_qty > 0
      and item.state in ('partial', 'backordered')
      and public.order_consumes_inventory(orders.status)
    order by item.priority_at, orders.created_at, item.id
    for update of item
  loop
    exit when variant_row.stock <= 0;
    assign_qty := least(variant_row.stock, allocation.backorder_qty);
    if assign_qty <= 0 then continue; end if;

    update public.order_inventory_allocations
    set
      allocated_qty = allocated_qty + assign_qty,
      backorder_qty = backorder_qty - assign_qty,
      stock_deducted_qty = stock_deducted_qty + assign_qty,
      state = case when backorder_qty - assign_qty = 0 then 'allocated' else 'partial' end,
      allocated_at = coalesce(allocated_at, now()),
      last_allocated_at = now(),
      updated_at = now()
    where id = allocation.id;

    insert into public.inventory_allocation_events (
      allocation_id, order_id, product_variant_id, event_type, quantity, actor_user_id
    ) values (
      allocation.id, allocation.order_id, p_variant_id,
      'fifo_allocate', assign_qty, auth.uid()
    );

    variant_row.stock := variant_row.stock - assign_qty;
    total_assigned := total_assigned + assign_qty;
    if not allocation.order_id = any(affected_orders) then
      affected_orders := array_append(affected_orders, allocation.order_id);
    end if;
  end loop;

  update public.product_variants
  set stock = variant_row.stock
  where id = p_variant_id;
  perform public.sync_product_stock_mirror(variant_row.product_id);

  return jsonb_build_object(
    'variant_id', p_variant_id,
    'allocated_qty', total_assigned,
    'remaining_stock', variant_row.stock,
    'affected_orders', to_jsonb(affected_orders)
  );
end;
$$;

revoke all on function public.allocate_inventory_for_paid_order(text, jsonb) from public, anon, authenticated;
revoke all on function public.release_inventory_for_order(text) from public, anon, authenticated;
revoke all on function public.sync_inventory_allocation_for_order() from public, anon, authenticated;
revoke all on function public.sync_product_stock_mirror(integer) from public, anon, authenticated;
revoke all on function public.get_admin_inventory_allocations() from public, anon;
revoke all on function public.get_backorder_management_data() from public, anon;
revoke all on function public.allocate_backordered_inventory(bigint) from public, anon;
grant execute on function public.get_admin_inventory_allocations() to authenticated;
grant execute on function public.get_backorder_management_data() to authenticated;
grant execute on function public.allocate_backordered_inventory(bigint) to authenticated;

comment on table public.order_inventory_allocations is
  'Canonical per-order-line inventory allocation and backorder state. FIFO priority is fixed when payment is confirmed.';
comment on function public.allocate_backordered_inventory(bigint) is
  'Allocates current variant stock to paid backorders in FIFO payment order. Does not receive purchase orders or add stock.';

commit;
