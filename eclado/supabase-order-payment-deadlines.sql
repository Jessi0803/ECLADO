-- Authoritative unpaid-order lifecycle:
-- first reminder after 3 hours, second reminder after 24 hours,
-- and payment expiry 48 hours after order creation.

alter table public.orders
  add column if not exists payment_due_at timestamptz,
  add column if not exists payment_second_reminded_at timestamptz;

update public.orders
set payment_due_at = created_at + interval '48 hours'
where payment_due_at is null;

create or replace function public.set_order_payment_due_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.payment_due_at is null then
    new.payment_due_at := coalesce(new.created_at, now()) + interval '48 hours';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_payment_due_at on public.orders;
create trigger trg_orders_payment_due_at
  before insert on public.orders
  for each row execute function public.set_order_payment_due_at();

alter table public.orders
  alter column payment_due_at set default (now() + interval '48 hours'),
  alter column payment_due_at set not null;

drop index if exists public.idx_orders_unpaid_payment_reminder;
create index idx_orders_unpaid_payment_reminder
  on public.orders (status, created_at)
  where status in ('awaiting_confirm', 'unpaid')
    and (
      payment_reminded_at is null
      or payment_second_reminded_at is null
    );

create index if not exists idx_orders_unpaid_payment_due
  on public.orders (payment_due_at)
  where status in ('awaiting_confirm', 'unpaid');

create or replace function public.claim_order_payment(
  p_order_id text,
  p_payment_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  payment_auth public.order_payment_authorizations%rowtype;
  target_order public.orders%rowtype;
begin
  if nullif(trim(p_order_id), '') is null or nullif(trim(p_payment_token), '') is null then
    raise exception 'Order ID and payment token are required' using errcode = '22023';
  end if;

  select * into payment_auth
  from public.order_payment_authorizations
  where order_id = p_order_id
  for update;

  if not found
    or payment_auth.token_hash <> encode(digest(p_payment_token, 'sha256'), 'hex')
  then
    raise exception 'Invalid payment authorization' using errcode = '42501';
  end if;
  if payment_auth.gateway_created_at is not null then
    raise exception 'Payment has already been created' using errcode = '23505';
  end if;
  if payment_auth.claimed_at is not null then
    raise exception 'Payment creation is already in progress' using errcode = '55P03';
  end if;

  select * into target_order
  from public.orders
  where id = p_order_id;

  if not found or target_order.status not in ('awaiting_confirm', 'unpaid') then
    raise exception 'Order is not payable' using errcode = '22023';
  end if;
  if target_order.payment_due_at <= now() then
    raise exception 'Order payment has expired' using errcode = '22023';
  end if;

  update public.order_payment_authorizations
  set claimed_at = now()
  where order_id = p_order_id;

  return jsonb_build_object(
    'id', target_order.id,
    'total', target_order.total,
    'status', target_order.status,
    'items', target_order.items,
    'payment_due_at', target_order.payment_due_at
  );
end;
$$;

revoke all on function public.claim_order_payment(text, text) from public;
grant execute on function public.claim_order_payment(text, text) to service_role;

