-- Payment result flow hardening
-- Persists gateway payment state separately from order fulfilment status.

alter table public.order_payment_instructions
  add column if not exists payment_state text not null default 'pending';

alter table public.order_payment_instructions
  drop constraint if exists order_payment_instructions_payment_state_check;

alter table public.order_payment_instructions
  add constraint order_payment_instructions_payment_state_check
  check (payment_state in ('pending', 'paid', 'failed', 'expired', 'cancelled'));

update public.order_payment_instructions instruction
set payment_state = case
  when orders.status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered') then 'paid'
  when orders.status = 'cancelled' and orders.payment_due_at <= now() then 'expired'
  when orders.status = 'cancelled' then 'cancelled'
  else 'pending'
end,
updated_at = now()
from public.orders orders
where orders.id = instruction.order_id;

comment on column public.order_payment_instructions.payment_state is
  'Gateway payment attempt state, kept separate from order fulfilment status.';
