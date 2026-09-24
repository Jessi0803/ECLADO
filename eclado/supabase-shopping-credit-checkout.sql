-- ECLADO permanent member shopping credit — phase 2 checkout/lifecycle.
-- Run after supabase-shopping-credit-foundation.sql and the current invoice,
-- coupon and gift order wrappers.

begin;

alter table public.orders
  add column if not exists shopping_credit_amount bigint not null default 0,
  add column if not exists payment_amount numeric;

update public.orders
set payment_amount = total
where payment_amount is null;

alter table public.orders
  alter column payment_amount set not null,
  alter column payment_amount drop default;

-- Older deployed checkout wrappers omit both new columns. Give those orders a
-- full gateway amount before constraints run, preserving rolling deployment
-- compatibility while the browser update propagates.
create or replace function public.set_order_payment_amount_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  requested_credit_text text;
  requested_credit bigint := 0;
  merchandise_total numeric;
  maximum_credit bigint;
begin
  requested_credit_text := current_setting(
    'app.eclado_order_shopping_credit_amount',
    true
  );
  if nullif(requested_credit_text, '') is not null then
    requested_credit := requested_credit_text::bigint;
  end if;

  if requested_credit < 0 then
    raise exception 'Shopping credit amount cannot be negative' using errcode = '22023';
  end if;

  merchandise_total := greatest(
    0,
    coalesce(new.subtotal, 0) - coalesce(new.discount, 0)
  );
  maximum_credit := greatest(
    0,
    least(floor(merchandise_total), floor(new.total - 1))::bigint
  );
  if requested_credit > maximum_credit then
    raise exception 'Shopping credit exceeds the eligible merchandise amount or minimum gateway payment'
      using errcode = '22003';
  end if;

  new.shopping_credit_amount := requested_credit;
  new.payment_amount := new.total - requested_credit;
  new.pricing_snapshot := jsonb_set(
    jsonb_set(
      coalesce(new.pricing_snapshot, '{}'::jsonb),
      '{shopping_credit_amount}',
      to_jsonb(requested_credit),
      true
    ),
    '{payment_amount}',
    to_jsonb(new.payment_amount),
    true
  );
  return new;
end;
$$;

revoke all on function public.set_order_payment_amount_defaults() from public;
drop trigger if exists trg_orders_payment_amount_defaults on public.orders;
create trigger trg_orders_payment_amount_defaults
  before insert on public.orders
  for each row execute function public.set_order_payment_amount_defaults();

alter table public.orders
  drop constraint if exists orders_shopping_credit_amount_check,
  drop constraint if exists orders_payment_amount_check,
  drop constraint if exists orders_payment_amount_consistency_check;

alter table public.orders
  add constraint orders_shopping_credit_amount_check
    check (shopping_credit_amount >= 0),
  add constraint orders_payment_amount_check
    check (payment_amount >= 0),
  add constraint orders_payment_amount_consistency_check
    check (payment_amount + shopping_credit_amount = total);

comment on column public.orders.total is
  'Gross order value after promotion/coupon and shipping, before shopping-credit tender.';
comment on column public.orders.shopping_credit_amount is
  'Permanent member shopping credit reserved for and eventually consumed by this order.';
comment on column public.orders.payment_amount is
  'Amount the external payment gateway must collect after shopping credit; at least NT$1 for new orders.';

-- These values are part of the order's historical price/payment snapshot.
-- They are written by the BEFORE INSERT trigger above and cannot be patched
-- after the immutable order has been created.
create or replace function public.protect_order_pricing_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.items is distinct from old.items
    or new.total is distinct from old.total
    or new.subtotal is distinct from old.subtotal
    or new.discount is distinct from old.discount
    or new.type is distinct from old.type
    or new.promotion_id is distinct from old.promotion_id
    or new.promotion_name is distinct from old.promotion_name
    or new.coupon_campaign_id is distinct from old.coupon_campaign_id
    or new.coupon_name is distinct from old.coupon_name
    or new.coupon_code_mask is distinct from old.coupon_code_mask
    or new.shopping_credit_amount is distinct from old.shopping_credit_amount
    or new.payment_amount is distinct from old.payment_amount
    or new.pricing_snapshot is distinct from old.pricing_snapshot
  then
    raise exception 'Order pricing snapshot is immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- The existing 12-argument invoice wrapper remains intact. This overload adds
-- shopping credit in the same transaction, so a failed reservation rolls back
-- the order, coupon quota and gift reservation together.
create or replace function public.create_order_with_pricing(
  p_items jsonb, p_member text, p_address text, p_phone text, p_email text,
  p_note text, p_payment_method text, p_fulfillment_method text, p_coupon_code text,
  p_invoice_type text, p_invoice_company_name text, p_invoice_tax_id text,
  p_shopping_credit_amount bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  result jsonb;
  created_order_id text;
  current_user_id uuid := auth.uid();
  requested_credit bigint := coalesce(p_shopping_credit_amount, 0);
  gateway_payment numeric;
  next_snapshot jsonb;
begin
  if requested_credit < 0 then
    raise exception 'Shopping credit amount cannot be negative' using errcode = '22023';
  end if;
  if requested_credit > 0 and current_user_id is null then
    raise exception 'Sign in is required to use shopping credit' using errcode = '42501';
  end if;

  -- Pass the requested tender to the BEFORE INSERT trigger so the immutable
  -- order row and pricing snapshot are complete on their first write.
  perform set_config(
    'app.eclado_order_shopping_credit_amount',
    requested_credit::text,
    true
  );
  result := public.create_order_with_pricing(
    p_items, p_member, p_address, p_phone, p_email, p_note,
    p_payment_method, p_fulfillment_method, p_coupon_code,
    p_invoice_type, p_invoice_company_name, p_invoice_tax_id
  );
  perform set_config('app.eclado_order_shopping_credit_amount', '0', true);
  created_order_id := result ->> 'order_id';

  if requested_credit > 0 then
    perform public.reserve_order_shopping_credit(
      current_user_id,
      created_order_id,
      requested_credit
    );
  end if;

  select target.payment_amount,
         coalesce(target.pricing_snapshot, '{}'::jsonb)
  into gateway_payment, next_snapshot
  from public.orders target
  where target.id = created_order_id;

  return result || jsonb_build_object(
    'shopping_credit_amount', requested_credit,
    'payment_amount', gateway_payment,
    'pricing_snapshot', next_snapshot
  );
end;
$$;

revoke all on function public.create_order_with_pricing(
  jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint
) from public;
grant execute on function public.create_order_with_pricing(
  jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint
) to anon, authenticated;

-- Every order status writer (Vercel, Vultr, cron and backoffice) passes through
-- this trigger. The private lifecycle functions lock the account row and are
-- idempotent for duplicate payment callbacks.
create or replace function public.sync_shopping_credit_from_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation_status text;
  release_reason text;
begin
  if new.shopping_credit_amount <= 0 or new.status is not distinct from old.status then
    return new;
  end if;

  select reservation.status
  into reservation_status
  from public.shopping_credit_order_reservations reservation
  where reservation.order_id = new.id;

  if reservation_status is null then
    raise exception 'Shopping credit reservation is missing for order %', new.id
      using errcode = '23514';
  end if;

  if new.status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered') then
    if reservation_status = 'reserved' then
      perform public.consume_order_shopping_credit(new.id);
    elsif reservation_status not in ('consumed', 'refunded') then
      raise exception 'Shopping credit reservation cannot enter a paid order state'
        using errcode = '55000';
    end if;
  elsif new.status in ('cancelled', 'returned') then
    if reservation_status = 'reserved' then
      release_reason := case
        when new.payment_due_at <= now() then 'order_expired'
        else 'order_cancelled'
      end;
      perform public.release_order_shopping_credit(new.id, release_reason);
    elsif reservation_status = 'consumed' then
      perform public.refund_order_shopping_credit(new.id);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_shopping_credit_from_order_status() from public, anon, authenticated;
drop trigger if exists trg_sync_shopping_credit_from_order_status on public.orders;
create trigger trg_sync_shopping_credit_from_order_status
  after update of status on public.orders
  for each row execute function public.sync_shopping_credit_from_order_status();

-- The payment API consumes claim_order_payment.total. Return the gateway
-- amount there while keeping orders.total as the gross order value.
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
  if target_order.payment_amount < 1 then
    raise exception 'Order gateway payment amount is invalid' using errcode = '23514';
  end if;

  update public.order_payment_authorizations
  set claimed_at = now()
  where order_id = p_order_id;

  return jsonb_build_object(
    'id', target_order.id,
    'total', target_order.payment_amount,
    'order_total', target_order.total,
    'shopping_credit_amount', target_order.shopping_credit_amount,
    'status', target_order.status,
    'items', target_order.items,
    'payment_due_at', target_order.payment_due_at,
    'provider_order_no', coalesce(payment_auth.provider_order_no, target_order.id),
    'attempt_no', coalesce(payment_auth.attempt_no, 1)
  );
end;
$$;

revoke all on function public.claim_order_payment(text, text) from public;
grant execute on function public.claim_order_payment(text, text) to service_role;

notify pgrst, 'reload schema';

commit;
