-- Adds a one-time marker for unpaid order payment reminders.
alter table public.orders
  add column if not exists payment_reminded_at timestamptz,
  add column if not exists payment_second_reminded_at timestamptz,
  add column if not exists payment_due_at timestamptz default (now() + interval '48 hours');

create index if not exists idx_orders_unpaid_payment_reminder
  on public.orders (status, created_at)
  where status in ('awaiting_confirm', 'unpaid')
    and (payment_reminded_at is null or payment_second_reminded_at is null);
