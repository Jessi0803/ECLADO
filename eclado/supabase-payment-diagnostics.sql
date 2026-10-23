-- Independent diagnostic evidence; does not change payment/order/wallet state.
begin;
create table if not exists public.order_payment_diagnostics (
  id uuid primary key default gen_random_uuid(),
  diagnostic_key text not null unique check (diagnostic_key ~ '^[a-f0-9]{64}$'),
  order_id text not null references public.orders(id) on delete cascade,
  provider_order_no text not null check (provider_order_no ~ '^ECL-[A-Za-z0-9-]{1,90}$'),
  attempt_no integer not null check (attempt_no between 1 and 9999),
  source text not null check (source in ('create','retry','query','notify','return','assisted_create')),
  api_service text not null check (api_service in ('OrderCreate','OrderQuery','OrderPayQuery')),
  api_status text check (api_status in ('S','F')),
  api_message_code text check (api_message_code ~ '^[ESM][0-9]{4}$'),
  transaction_status text check (transaction_status in ('S','F')),
  transaction_type text check (transaction_type in ('PayOut','CaptureOut','RegularOut','RegularEnd','VARefundOut','CardBindOut')),
  transaction_message_code text check (transaction_message_code ~ '^[ESM][0-9]{4}$'),
  pay_status text check (pay_status ~ '^[A-Z0-9]{1,12}$'),
  auth_response_code text check (auth_response_code ~ '^[A-Z0-9]{1,3}$'),
  http_status integer check (http_status between 100 and 599),
  failure_kind text check (failure_kind in ('bank_http','network','timeout','response_integrity','configuration')),
  recorded_at timestamptz not null default clock_timestamp()
);
comment on table public.order_payment_diagnostics is
  'Verified bank response codes and transport observations only. No raw bank/customer payload, token, card data or free text. Identical repeated observations deduplicate; recorded_at is first observation time, not payment time.';
create index if not exists payment_diagnostics_order_time on public.order_payment_diagnostics(order_id,recorded_at desc,id);
alter table public.order_payment_diagnostics enable row level security;
revoke all on public.order_payment_diagnostics from public,anon,authenticated,service_role;
grant select,insert,delete on public.order_payment_diagnostics to service_role;

create or replace function public.get_admin_order_payment_diagnostics(p_order_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_eclado_admin() or not public.has_backoffice_permission('orders.read') then
    raise exception 'Orders read access required' using errcode = '42501';
  end if;
  if p_order_id is null or char_length(p_order_id) not between 1 and 200 then
    raise exception 'Invalid order ID' using errcode = '22023';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(d) order by d.recorded_at desc,d.id desc),'[]'::jsonb) from (
    select id,attempt_no,source,api_service,api_status,api_message_code,transaction_status,transaction_type,
      transaction_message_code,pay_status,auth_response_code,http_status,failure_kind,recorded_at
    from public.order_payment_diagnostics where order_id=p_order_id order by recorded_at desc,id desc limit 30
  ) d);
end;
$$;
revoke all on function public.get_admin_order_payment_diagnostics(text) from public,anon,authenticated;
grant execute on function public.get_admin_order_payment_diagnostics(text) to authenticated;
commit;
