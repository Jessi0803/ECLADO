-- Adds a one-time marker for unpaid order payment reminders.
alter table public.orders
  add column if not exists payment_reminded_at timestamptz;

create index if not exists idx_orders_unpaid_payment_reminder
  on public.orders (status, created_at)
  where payment_reminded_at is null
    and status in ('awaiting_confirm', 'unpaid');
