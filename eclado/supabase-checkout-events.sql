-- Checkout diagnostics only. Apply after the core security and admin migrations.
-- No order/payment state or pricing functions are changed by this migration.
begin;

create table if not exists public.checkout_events (
  event_id uuid primary key default gen_random_uuid(),
  flow_id uuid not null,
  attempt_id uuid not null,
  previous_attempt_id uuid,
  order_id text check (order_id is null or order_id ~ '^ECL-[A-Za-z0-9-]{1,90}$'),
  source text not null check (source in ('browser', 'database', 'payment_api')),
  event_name text not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  elapsed_ms integer check (elapsed_ms between 0 and 86400000),
  online boolean,
  visibility text check (visibility in ('visible', 'hidden', 'prerender')),
  error_kind text check (error_kind in ('timeout', 'network', 'http', 'runtime', 'service', 'unknown')),
  error_code text check (error_code ~ '^(PGRST[0-9]{3}|[0-9]{5}|E[0-9]{4})$'),
  http_status integer check (http_status between 100 and 599),
  app_version text check (app_version ~ '^[A-Za-z0-9._-]{1,64}$'),
  constraint checkout_event_source_name check (
    (source = 'browser' and event_name in (
      'submit_started', 'quote_requested', 'quote_received', 'order_requested', 'order_received',
      'payment_requested', 'payment_received', 'recovery_saved', 'checkout_ready', 'checkout_error',
      'error_shown', 'attempt_finished', 'page_hidden', 'network_offline', 'network_online', 'runtime_error'
    )) or (source = 'database' and event_name in ('order_stored', 'gateway_recorded'))
    or (source = 'payment_api' and event_name in (
      'payment_api_received', 'payment_claimed', 'gateway_requested', 'gateway_succeeded',
      'gateway_rejected', 'payment_saved', 'payment_api_error', 'payment_response_ready'
    ))
  )
);

comment on table public.checkout_events is
  '30-day diagnostic trail. Browser events, order references, flow IDs and client times are untrusted reports; database/payment_api sources attest only their own observed stage. No customer details, raw errors, URLs or tokens.';
create index if not exists checkout_events_flow_time on public.checkout_events(flow_id, occurred_at, received_at);
create index if not exists checkout_events_order_time on public.checkout_events(order_id, occurred_at) where order_id is not null;
create index if not exists checkout_events_retention on public.checkout_events(received_at);

alter table public.checkout_events enable row level security;
revoke all on public.checkout_events from public, anon, authenticated;
grant select on public.checkout_events to authenticated;
grant select, insert, delete on public.checkout_events to service_role;
drop policy if exists checkout_events_admin_read on public.checkout_events;
create policy checkout_events_admin_read on public.checkout_events for select to authenticated
  using (public.is_eclado_admin());

-- Browser ingestion is service-only; the HTTP endpoint validates every field.
-- Rate limiting, deduplication and bounded retention cleanup share one transaction.
create or replace function public.ingest_checkout_browser_events(p_key_hash text, p_events jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) not between 1 and 10 then
    raise exception 'Invalid event batch' using errcode = '22023';
  end if;
  if not public.consume_rate_limit_internal('checkout:events', p_key_hash, 60, 900) then return false; end if;
  insert into public.checkout_events (
    event_id, flow_id, attempt_id, previous_attempt_id, order_id, source, event_name, occurred_at,
    elapsed_ms, online, visibility, error_kind, error_code, http_status, app_version
  ) select e.event_id, e.flow_id, e.attempt_id, e.previous_attempt_id, e.order_id, 'browser', e.event_name,
    e.occurred_at, e.elapsed_ms, e.online, e.visibility, e.error_kind, e.error_code, e.http_status, e.app_version
  from jsonb_to_recordset(p_events) as e(
    event_id uuid, flow_id uuid, attempt_id uuid, previous_attempt_id uuid, order_id text, event_name text,
    occurred_at timestamptz, elapsed_ms integer, online boolean, visibility text, error_kind text,
    error_code text, http_status integer, app_version text
  ) on conflict (event_id) do nothing;
  delete from public.checkout_events where event_id in (
    select event_id from public.checkout_events where received_at < now() - interval '30 days'
    order by received_at limit 500
  );
  return true;
end;
$$;
revoke all on function public.ingest_checkout_browser_events(text,jsonb) from public, anon, authenticated;
grant execute on function public.ingest_checkout_browser_events(text,jsonb) to service_role;

-- x-client-info is already allowed by Supabase CORS. Per-RPC header avoids
-- changing global client headers or authoritative-pricing RPC signatures.
create or replace function public.capture_checkout_database_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  client_info text;
  trace text[];
  prior public.checkout_events%rowtype;
begin
  if tg_table_name = 'orders' then
    client_info := coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-client-info', '');
    trace := regexp_match(client_info,
      '^eclado-checkout/v1;flow=([0-9a-f-]{36});attempt=([0-9a-f-]{36})$');
    if trace is null then return new; end if;
    insert into public.checkout_events(flow_id, attempt_id, order_id, source, event_name, occurred_at)
    values(trace[1]::uuid, trace[2]::uuid, new.id, 'database', 'order_stored', clock_timestamp());
  else
    if new.gateway_created_at is null or old.gateway_created_at is not distinct from new.gateway_created_at then return new; end if;
    select * into prior from public.checkout_events
      where order_id = new.order_id and source = 'database' and event_name = 'order_stored'
      order by received_at desc limit 1;
    if not found then return new; end if;
    insert into public.checkout_events(flow_id, attempt_id, order_id, source, event_name, occurred_at)
    values(prior.flow_id, prior.attempt_id, new.order_id, 'database', 'gateway_recorded', clock_timestamp());
  end if;
  return new;
exception when others then
  -- Never log SQLERRM: it can contain values supplied by a customer.
  raise warning 'checkout diagnostics unavailable (SQLSTATE %)', SQLSTATE;
  return new;
end;
$$;
revoke all on function public.capture_checkout_database_event() from public, anon, authenticated;
drop trigger if exists trg_checkout_order_stored on public.orders;
create trigger trg_checkout_order_stored after insert on public.orders
  for each row execute function public.capture_checkout_database_event();
drop trigger if exists trg_checkout_gateway_recorded on public.order_payment_authorizations;
create trigger trg_checkout_gateway_recorded after update of gateway_created_at on public.order_payment_authorizations
  for each row execute function public.capture_checkout_database_event();
commit;
