-- ECLADO inventory status fix
-- Run once in Supabase SQL Editor for existing projects.
--
-- Keeps inventory deducted throughout the fulfillment flow:
-- paid -> preparing -> shipped -> delivered.
-- Stock is restored only when an inventory-active order moves to a non-active
-- status such as cancelled or returned.

create or replace function public.order_consumes_inventory(order_status text)
returns boolean
language sql
immutable
as $$
  select order_status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered');
$$;
