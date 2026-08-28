-- 客訂規格不計入前台「熱門商品」銷量。
-- 舊訂單沒有 is_custom_order 快照時視為一般商品，保留既有銷量。
create or replace function public.get_public_sales_stats()
returns table(product_id integer, sold_qty bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (item.value ->> 'product_id')::integer as product_id,
    sum(greatest(coalesce(nullif(item.value ->> 'qty', '')::integer, 1), 1))::bigint as sold_qty
  from public.orders orders
  cross join lateral jsonb_array_elements(orders.items) item(value)
  where orders.status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered')
    and coalesce(item.value ->> 'product_id', '') ~ '^[0-9]+$'
    and coalesce(item.value ->> 'is_custom_order', 'false') <> 'true'
  group by (item.value ->> 'product_id')::integer;
$$;

revoke all on function public.get_public_sales_stats() from public;
grant execute on function public.get_public_sales_stats() to anon, authenticated;

comment on function public.get_public_sales_stats() is
  'Returns aggregate sold quantity for popular products, excluding custom-order variant items.';
