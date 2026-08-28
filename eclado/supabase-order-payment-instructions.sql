-- Durable payment instructions for member/guest recovery.
-- Run after supabase-authoritative-pricing.sql and supabase-order-payment-deadlines.sql.

alter table public.orders
  add column if not exists public_lookup_code text;

create or replace function public.set_order_public_lookup_code()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if nullif(trim(new.public_lookup_code), '') is null then
    new.public_lookup_code := upper(
      substr(encode(gen_random_bytes(5), 'hex'), 1, 5)
      || '-'
      || substr(encode(gen_random_bytes(5), 'hex'), 6, 5)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_public_lookup_code on public.orders;
create trigger trg_orders_public_lookup_code
  before insert on public.orders
  for each row execute function public.set_order_public_lookup_code();

update public.orders
set public_lookup_code = upper(
  substr(encode(gen_random_bytes(5), 'hex'), 1, 5)
  || '-'
  || substr(encode(gen_random_bytes(5), 'hex'), 6, 5)
)
where public_lookup_code is null;

create unique index if not exists idx_orders_public_lookup_code
  on public.orders (public_lookup_code);

alter table public.orders
  alter column public_lookup_code set not null;

create table if not exists public.order_payment_instructions (
  order_id text primary key references public.orders(id) on delete cascade,
  payment_method text not null,
  provider_transaction_no text,
  provider_status text,
  provider_description text,
  atm_bank_code text,
  atm_account text,
  payment_url text,
  payment_due_at timestamptz not null,
  gateway_created_at timestamptz not null default now(),
  order_email_sent_at timestamptz,
  order_email_error text,
  updated_at timestamptz not null default now()
);

alter table public.order_payment_instructions
  add column if not exists order_email_sent_at timestamptz,
  add column if not exists order_email_error text;

alter table public.order_payment_instructions enable row level security;

-- Payment instructions contain sensitive payment links/account numbers.
-- Browsers must use the Payment API, which verifies member ownership or a
-- guest recovery challenge. No anon/authenticated table policy is created.
revoke all on table public.order_payment_instructions from anon, authenticated;
grant all on table public.order_payment_instructions to service_role;

create index if not exists idx_order_payment_instructions_due
  on public.order_payment_instructions (payment_due_at);

comment on table public.order_payment_instructions is
  'Server-only payment instructions used to restore the original gateway payment without creating a second payment order.';

-- 後台訂單列表只需要付款方式，不開放虛擬帳號、付款連結等敏感欄位。
create or replace function public.get_admin_order_payment_methods()
returns table(order_id text, payment_method text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_eclado_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  return query
  select instruction.order_id, instruction.payment_method
  from public.order_payment_instructions instruction;
end;
$$;

revoke all on function public.get_admin_order_payment_methods() from public;
grant execute on function public.get_admin_order_payment_methods() to authenticated;

comment on function public.get_admin_order_payment_methods() is
  'Returns only order id and payment method to authenticated ECLADO admins.';
