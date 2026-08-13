-- ECLADO inventory reservation
-- Run once in Supabase SQL Editor after supabase-full-setup.sql.
--
-- Behavior:
-- - Orders become inventory-active when status changes to paid/preparing/shipped/delivered.
-- - Orders moving from an inventory-active status to cancelled/returned/unpaid restore only the stock that was deducted.
-- - Preorder quantity does not push products.stock below 0.

update public.products
set stock = 0
where stock < 0;

alter table if exists public.products
  drop constraint if exists products_stock_check;

alter table if exists public.products
  add constraint products_stock_check check (stock >= 0);

create or replace function public.order_consumes_inventory(order_status text)
returns boolean
language sql
immutable
as $$
  select order_status in ('paid', 'preparing', 'shipped', 'delivered');
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
  stock_at_order integer;
  stock_qty integer;
begin
  if order_items is null or jsonb_typeof(order_items) <> 'array' then
    return;
  end if;

  for item in
    select * from jsonb_array_elements(order_items)
  loop
    product_id := nullif(item.value ->> 'id', '')::integer;
    item_qty := coalesce(nullif(item.value ->> 'qty', '')::integer, 0);
    stock_at_order := greatest(coalesce(nullif(item.value ->> 'stock_at_order', '')::integer, item_qty), 0);
    stock_qty := least(item_qty, stock_at_order);

    if product_id is null or item_qty <= 0 then
      continue;
    end if;

    update public.products
    set stock = greatest(0, stock + (direction * stock_qty))
    where id = product_id;

    if not found then
      raise exception 'Product % not found', product_id;
    end if;
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
    if public.order_consumes_inventory(new.status) then
      perform public.adjust_inventory_for_order(new.items, -1);
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if public.order_consumes_inventory(old.status) and not public.order_consumes_inventory(new.status) then
      perform public.adjust_inventory_for_order(old.items, 1);
    elsif not public.order_consumes_inventory(old.status) and public.order_consumes_inventory(new.status) then
      perform public.adjust_inventory_for_order(new.items, -1);
    elsif public.order_consumes_inventory(old.status) and public.order_consumes_inventory(new.status) and old.items is distinct from new.items then
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
