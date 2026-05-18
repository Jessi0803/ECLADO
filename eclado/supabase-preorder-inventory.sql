-- ECLADO preorder inventory update
-- Run this once in Supabase SQL Editor if products/orders tables already exist.
--
-- Allows orders to be paid even when product stock is 0.
-- When paid orders exceed available stock, products.stock becomes negative,
-- and the storefront treats stock <= 0 as preorder.

alter table if exists public.products
  drop constraint if exists products_stock_check;

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

    update public.products
    set stock = stock + (direction * item_qty)
    where id = product_id;

    if not found then
      raise exception 'Product % not found', product_id;
    end if;
  end loop;
end;
$$;
