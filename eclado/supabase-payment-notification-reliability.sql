-- Durable payment-completion notification delivery state.
-- Safe to run more than once in the Supabase SQL Editor.
--
-- This separates "the order is paid" from "the customer was notified" so a
-- temporary Vercel/LINE/Email failure can be retried without changing payment
-- or inventory state and without sending duplicate notices concurrently.

do $$
declare
  tracking_was_present boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'payment_notification_sent_at'
  ) into tracking_was_present;

  alter table public.orders
    add column if not exists payment_notification_sent_at timestamptz,
    add column if not exists payment_notification_channel text,
    add column if not exists payment_notification_attempts integer not null default 0,
    add column if not exists payment_notification_last_attempt_at timestamptz,
    add column if not exists payment_notification_next_retry_at timestamptz,
    add column if not exists payment_notification_error text;

  -- Only the first migration marks historical paid orders as handled. A later
  -- re-run must not accidentally hide a newly paid, not-yet-notified order.
  if not tracking_was_present then
    update public.orders
    set payment_notification_sent_at = coalesce(updated_at, created_at, now())
    where status in ('paid', 'preparing', 'shipped', 'delivered')
      and payment_notification_sent_at is null
      and payment_notification_attempts = 0;
  end if;
end;
$$;

alter table public.orders
  drop constraint if exists orders_payment_notification_channel_check;

alter table public.orders
  add constraint orders_payment_notification_channel_check
  check (
    payment_notification_channel is null
    or payment_notification_channel in ('line', 'email')
  );

create index if not exists idx_orders_payment_notification_retry
  on public.orders (payment_notification_next_retry_at)
  where payment_notification_sent_at is null
    and status in ('paid', 'preparing', 'shipped', 'delivered');

create or replace function public.claim_order_payment_notification(
  p_order_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_order public.orders;
begin
  update public.orders
  set
    payment_notification_attempts = coalesce(payment_notification_attempts, 0) + 1,
    payment_notification_last_attempt_at = now(),
    -- Reservation prevents concurrent callbacks from sending twice. A crashed
    -- worker becomes eligible again after five minutes.
    payment_notification_next_retry_at = now() + interval '5 minutes'
  where id = p_order_id
    and status in ('paid', 'preparing', 'shipped', 'delivered')
    and payment_notification_sent_at is null
    and (
      payment_notification_next_retry_at is null
      or payment_notification_next_retry_at <= now()
    )
  returning * into claimed_order;

  if claimed_order.id is null then
    return jsonb_build_object(
      'claimed', false,
      'next_retry_at', (
        select payment_notification_next_retry_at
        from public.orders
        where id = p_order_id
      )
    );
  end if;

  return jsonb_build_object(
    'claimed', true,
    'attempts', claimed_order.payment_notification_attempts,
    'next_retry_at', claimed_order.payment_notification_next_retry_at
  );
end;
$$;

create or replace function public.complete_order_payment_notification(
  p_order_id text,
  p_sent boolean,
  p_channel text default null,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  if p_sent and (p_channel is null or p_channel not in ('line', 'email')) then
    raise exception 'A successful payment notification requires a valid channel';
  end if;

  update public.orders
  set
    payment_notification_sent_at = case when p_sent then now() else null end,
    payment_notification_channel = case when p_sent then p_channel else null end,
    payment_notification_error = case
      when p_sent then null
      else left(coalesce(nullif(trim(p_error), ''), 'notification delivery failed'), 1000)
    end,
    payment_notification_next_retry_at = case
      when p_sent then null
      when coalesce(payment_notification_attempts, 0) <= 3 then now() + interval '5 minutes'
      when coalesce(payment_notification_attempts, 0) <= 6 then now() + interval '30 minutes'
      else now() + interval '2 hours'
    end
  where id = p_order_id
    and payment_notification_sent_at is null;

  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

revoke all on function public.claim_order_payment_notification(text) from public, anon, authenticated;
revoke all on function public.complete_order_payment_notification(text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.claim_order_payment_notification(text) to service_role;
grant execute on function public.complete_order_payment_notification(text, boolean, text, text) to service_role;

comment on function public.claim_order_payment_notification(text) is
  'Atomically reserves one paid-order customer notification attempt.';
comment on function public.complete_order_payment_notification(text, boolean, text, text) is
  'Completes or schedules retry for a reserved paid-order customer notification.';

notify pgrst, 'reload schema';
