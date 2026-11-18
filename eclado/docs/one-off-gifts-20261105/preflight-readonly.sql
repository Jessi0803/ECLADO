-- Read-only refresh for the exact order. Does not run quote/creation/payment RPCs.
begin read only;
set local statement_timeout='15s';
select now() as checked_at, id,status,type,order_source,subtotal,discount,total,payment_amount,
  jsonb_array_length(items) as item_count,
  md5(items::text) as items_md5,md5(pricing_snapshot::text) as snapshot_md5
from public.orders where id='ECL-20261103-155424-8308FA6E';
select id,name,start_at,end_at,active,archived_at,benefit_type,activation_type,
  threshold_value,repeat_mode,audience_roles,allow_guest,exclusive_group
from public.promotions where id in('6a03c582-3102-4b0a-a063-229ea1e28b21','44478b76-3cee-4157-918f-ecb4fc15f275');
select r.promotion_id,v.id as variant_id,p.name_zh,v.size,r.quantity,v.active,v.gift_enabled,
  v.stock as merchandise_stock,v.gift_stock,
  coalesce((select sum(quantity) from public.promotion_gift_reservations s
    where s.product_variant_id=v.id and s.status='reserved' and s.expires_at>now()),0) as reserved_qty,
  v.gift_stock-coalesce((select sum(quantity) from public.promotion_gift_reservations s
    where s.product_variant_id=v.id and s.status='reserved' and s.expires_at>now()),0) as available_gift_qty
from public.promotion_gift_rewards r join public.product_variants v on v.id=r.variant_id
join public.products p on p.id=v.product_id
where r.promotion_id in('6a03c582-3102-4b0a-a063-229ea1e28b21','44478b76-3cee-4157-918f-ecb4fc15f275')
order by r.promotion_id,r.sort_order;
select a.item_index,a.product_variant_id,a.line_type,a.source,a.requested_qty,a.allocated_qty,
  a.backorder_qty,a.stock_deducted_qty
from public.order_inventory_allocations a where order_id='ECL-20261103-155424-8308FA6E' order by item_index;
select id,promotion_id,product_variant_id,quantity,status,expires_at,consumed_at
from public.promotion_gift_reservations where order_id='ECL-20261103-155424-8308FA6E';
select p.proname,md5(pg_get_functiondef(p.oid)) as definition_md5,pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
and p.proname in('allocate_inventory_for_paid_order','release_inventory_for_order','protect_order_pricing_snapshot','sync_inventory_allocation_for_order');
rollback;
