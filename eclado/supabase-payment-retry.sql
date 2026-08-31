-- Preserve the website order while creating a new Sinopac payment attempt.
-- Run after supabase-authoritative-pricing.sql and supabase-order-payment-instructions.sql.

create extension if not exists pgcrypto;

alter table public.order_payment_authorizations
  add column if not exists provider_order_no text,
  add column if not exists attempt_no integer not null default 1;

update public.order_payment_authorizations
set provider_order_no = order_id
where provider_order_no is null;

alter table public.order_payment_instructions
  add column if not exists provider_order_no text,
  add column if not exists attempt_no integer not null default 1;

update public.order_payment_instructions
set provider_order_no = order_id
where provider_order_no is null;

create table if not exists public.order_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders(id) on delete cascade,
  provider_order_no text not null unique,
  attempt_no integer not null check (attempt_no > 0),
  payment_method text not null,
  payment_state text not null default 'pending'
    check (payment_state in ('initiated', 'pending', 'paid', 'failed', 'expired', 'cancelled')),
  provider_transaction_no text,
  provider_status text,
  provider_description text,
  payment_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, attempt_no)
);

alter table public.order_payment_attempts enable row level security;
revoke all on table public.order_payment_attempts from anon, authenticated;
grant all on table public.order_payment_attempts to service_role;

create index if not exists idx_order_payment_attempts_order_created
  on public.order_payment_attempts (order_id, created_at desc);

insert into public.order_payment_attempts (
  order_id,
  provider_order_no,
  attempt_no,
  payment_method,
  payment_state,
  provider_transaction_no,
  provider_status,
  provider_description,
  payment_url,
  created_at,
  updated_at
)
select
  instruction.order_id,
  coalesce(instruction.provider_order_no, instruction.order_id),
  coalesce(instruction.attempt_no, 1),
  instruction.payment_method,
  instruction.payment_state,
  instruction.provider_transaction_no,
  instruction.provider_status,
  instruction.provider_description,
  instruction.payment_url,
  instruction.gateway_created_at,
  instruction.updated_at
from public.order_payment_instructions instruction
on conflict (provider_order_no) do nothing;

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

  select * into target_order from public.orders where id = p_order_id;
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
    'payment_due_at', target_order.payment_due_at,
    'provider_order_no', coalesce(payment_auth.provider_order_no, target_order.id),
    'attempt_no', coalesce(payment_auth.attempt_no, 1)
  );
end;
$$;

create or replace function public.begin_order_payment_retry(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  target_order public.orders%rowtype;
  payment_auth public.order_payment_authorizations%rowtype;
  instruction public.order_payment_instructions%rowtype;
  next_attempt integer;
  next_token text := encode(gen_random_bytes(32), 'hex');
  next_provider_order_no text;
begin
  select * into target_order
  from public.orders
  where id = p_order_id
  for update;

  if not found or target_order.status <> 'unpaid' then
    raise exception 'Order is not eligible for another payment attempt' using errcode = '22023';
  end if;
  if target_order.payment_due_at <= now() then
    raise exception 'Order payment has expired' using errcode = '22023';
  end if;

  select * into instruction
  from public.order_payment_instructions
  where order_id = p_order_id
  for update;

  if not found or instruction.payment_state <> 'failed' then
    raise exception 'Only a failed payment can be retried' using errcode = '22023';
  end if;
  if instruction.payment_method not in ('card', 'apple', 'google') then
    raise exception 'This payment method cannot be retried' using errcode = '22023';
  end if;

  select * into payment_auth
  from public.order_payment_authorizations
  where order_id = p_order_id
  for update;
  if not found then
    raise exception 'Payment authorization not found' using errcode = 'P0002';
  end if;

  next_attempt := greatest(coalesce(payment_auth.attempt_no, 1), coalesce(instruction.attempt_no, 1)) + 1;
  next_provider_order_no := left(regexp_replace(p_order_id, '[^A-Za-z0-9_-]', '', 'g'), 42 - length(next_attempt::text))
    || '-R' || next_attempt::text;

  update public.order_payment_authorizations
  set token_hash = encode(digest(next_token, 'sha256'), 'hex'),
      provider_order_no = next_provider_order_no,
      attempt_no = next_attempt,
      claimed_at = null,
      gateway_created_at = null
  where order_id = p_order_id;

  insert into public.order_payment_attempts (
    order_id, provider_order_no, attempt_no, payment_method, payment_state
  ) values (
    p_order_id, next_provider_order_no, next_attempt, instruction.payment_method, 'initiated'
  );

  return jsonb_build_object(
    'order_id', p_order_id,
    'payment_token', next_token,
    'provider_order_no', next_provider_order_no,
    'attempt_no', next_attempt
  );
end;
$$;

revoke all on function public.begin_order_payment_retry(text) from public;
grant execute on function public.begin_order_payment_retry(text) to service_role;

comment on table public.order_payment_attempts is
  'Immutable-per-attempt payment history. The public order remains the same while each gateway payment uses its own provider order number.';
