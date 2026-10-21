-- TEST ONLY. Only removes fixtures created by the paired UI seed script.
rollback;
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
update public.automatic_price_allocation_settings set enabled=false where singleton;
update public.orders set status='cancelled' where note='__ALLOC_UI_20261021__' and email='allocation.ui@example.test';
-- The immutable-adjustment trigger also blocks cascading deletion of disposable
-- fixtures. Exclusive lock prevents concurrent writes while restoring it in the
-- same transaction; any failure rolls back both trigger state and deletions.
lock table public.order_adjustments in access exclusive mode;
alter table public.order_adjustments disable trigger trg_prevent_order_adjustment_mutation;
delete from public.order_adjustments where order_id in (
  select id from public.orders where note='__ALLOC_UI_20261021__' and email='allocation.ui@example.test' and status='cancelled'
);
alter table public.order_adjustments enable trigger trg_prevent_order_adjustment_mutation;
delete from public.orders where note='__ALLOC_UI_20261021__' and email='allocation.ui@example.test' and status='cancelled';
delete from public.promotions where name in ('TEST 商品 A 折100','TEST 商品 B 折200')
  and id in(select promotion_id from public.promotion_scopes where product_id in(select id from public.products where slug in('allocation-ui-20261021-1','allocation-ui-20261021-2')));
delete from public.products where slug in('allocation-ui-20261021-1','allocation-ui-20261021-2');
select jsonb_build_object('enabled',(select enabled from public.automatic_price_allocation_settings where singleton),
  'orders',(select count(*) from public.orders),'promotions',(select count(*) from public.promotions),
  'remaining_ui_products',(select count(*) from public.products where slug like 'allocation-ui-20261021-%'),
  'remaining_ui_orders',(select count(*) from public.orders where note='__ALLOC_UI_20261021__')) as cleanup;
commit;
