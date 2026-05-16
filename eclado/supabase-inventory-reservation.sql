-- ECLADO inventory reservation
-- Run once in Supabase SQL Editor after supabase-products.sql.
--
-- Behavior:
-- - New orders in reserving statuses decrement products.stock.
-- - Orders moving from reserving statuses to cancelled/returned increment products.stock.
-- - If stock is insufficient, the order insert/update fails.

create or replace function public.order_reserves_inventory(order_status text)
returns boolean
language sql
immutable
as $$
  select order_status in ('awaiting_confirm', 'paid', 'preparing', 'shipped', 'delivered');
$$;

create or replace function public.adjust_inventory_for_order(order_items jsonb, direction integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item record;
  product_id integer;
  item_qty integer;
  current_stock integer;
begin
  if order_items is null or jsonb_typeof(order_items) <> 'array' then
    return;
  end if;

  for item in
    select * from jsonb_array_elements(order_items)
  loop
    product_id := nullif(item.value ->> 'id', '')::integer;
    item_qty := coalesce(nullif(item.value ->> 'qty', '')::integer, 0);

    if product_id is null or item_qty <= 0 then
      continue;
    end if;

    if direction < 0 then
      select stock into current_stock
      from public.products
      where id = product_id
      for update;

      if current_stock is null then
        raise exception 'Product % not found', product_id;
      end if;

      if current_stock < item_qty then
        raise exception 'Insufficient stock for product %, requested %, available %', product_id, item_qty, current_stock;
      end if;
    end if;

    update public.products
    set stock = stock + (direction * item_qty)
    where id = product_id;
  end loop;
end;
$$;

create or replace function public.sync_inventory_for_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if public.order_reserves_inventory(new.status) then
      perform public.adjust_inventory_for_order(new.items, -1);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if public.order_reserves_inventory(old.status) and not public.order_reserves_inventory(new.status) then
      perform public.adjust_inventory_for_order(old.items, 1);
    elsif not public.order_reserves_inventory(old.status) and public.order_reserves_inventory(new.status) then
      perform public.adjust_inventory_for_order(new.items, -1);
    elsif public.order_reserves_inventory(old.status) and public.order_reserves_inventory(new.status) and old.items is distinct from new.items then
      perform public.adjust_inventory_for_order(old.items, 1);
      perform public.adjust_inventory_for_order(new.items, -1);
    end if;

    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_orders_inventory_sync on public.orders;
create trigger trg_orders_inventory_sync
  after insert or update of status, items on public.orders
  for each row
  execute function public.sync_inventory_for_order();
