alter table public.orders
  drop constraint if exists orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status in (
    'awaiting_confirm',
    'unpaid',
    'paid',
    'preparing',
    'ready_for_pickup',
    'picked_up',
    'shipped',
    'delivered',
    'returned',
    'cancelled'
  ));
