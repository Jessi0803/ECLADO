-- LEGACY: superseded by supabase-order-inventory-allocation.sql.
-- Keep this file only for migration history; do not rerun it after inventory allocation v2.
-- ECLADO preorder inventory update
-- Run this once in Supabase SQL Editor if products/orders tables already exist.
--
-- Allows orders to be paid even when product stock is 0.
-- Preorder quantity does not push products.stock below 0.

update public.products
set stock = 0
where stock < 0;

alter table if exists public.products
  drop constraint if exists products_stock_check;

alter table if exists public.products
  add constraint products_stock_check check (stock >= 0);

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
