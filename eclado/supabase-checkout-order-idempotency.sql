-- Additive migration. Deploy before the frontend; keep existing pricing RPCs.
begin;
do $$ begin
  if to_regprocedure('public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint,jsonb)') is null
    or to_regprocedure('public.create_order_with_wallets(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint,bigint,jsonb)') is null then
    raise exception 'Current confirmed-price and double-wallet creators required';
  end if;
end $$;

create table if not exists public.checkout_order_requests (
  request_key uuid primary key,
  secret_hash text not null,
  owner_id uuid,
  payload_hash text not null,
  result jsonb,
  created_at timestamptz not null default now()
);
alter table public.checkout_order_requests enable row level security;
revoke all on table public.checkout_order_requests from public,anon,authenticated,service_role;
-- Keep the key even if its order is subsequently deleted. Removing a key could
-- turn a delayed retry into a second order. No TTL silently permits recreation.

create or replace function public.create_checkout_order_once(
  p_request_key uuid,p_request_secret text,p_expected_user_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.checkout_order_requests%rowtype; fingerprint text; created jsonb;
begin
  if p_request_key is null or p_request_secret is null or p_request_secret !~ '^[0-9a-f]{64}$'
    or p_expected_user_id is distinct from auth.uid() then
    raise exception '訂單恢復憑證或登入身分無效' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_key::text,91309));
  fingerprint:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  insert into public.checkout_order_requests(request_key,secret_hash,owner_id,payload_hash)
  values(p_request_key,encode(sha256(convert_to(p_request_secret,'UTF8')),'hex'),auth.uid(),fingerprint)
  on conflict(request_key) do nothing;
  select * into r from public.checkout_order_requests where request_key=p_request_key for update;
  if r.owner_id is distinct from auth.uid() or r.secret_hash<>encode(sha256(convert_to(p_request_secret,'UTF8')),'hex') then
    raise exception '訂單恢復憑證或登入身分無效' using errcode='42501';
  end if;
  if r.payload_hash<>fingerprint then
    raise exception '同一次訂單內容已變更，請先查回原訂單，勿重新下單。' using errcode='55000';
  end if;
  if r.result is not null then return r.result; end if;
  if (p_payload->>'wallet_pricing')::boolean then
    created:=public.create_order_with_wallets(
      p_payload->'items',p_payload->>'member',p_payload->>'address',p_payload->>'phone',p_payload->>'email',p_payload->>'note',
      p_payload->>'payment_method',p_payload->>'fulfillment_method',p_payload->>'coupon_code',p_payload->>'invoice_type',
      p_payload->>'invoice_company_name',p_payload->>'invoice_tax_id',(p_payload->>'shopping_credit_amount')::bigint,
      (p_payload->>'reward_credit_amount')::bigint,p_payload->'expected_quote');
  else
    created:=public.create_order_with_pricing(
      p_payload->'items',p_payload->>'member',p_payload->>'address',p_payload->>'phone',p_payload->>'email',p_payload->>'note',
      p_payload->>'payment_method',p_payload->>'fulfillment_method',p_payload->>'coupon_code',p_payload->>'invoice_type',
      p_payload->>'invoice_company_name',p_payload->>'invoice_tax_id',(p_payload->>'shopping_credit_amount')::bigint,p_payload->'expected_quote');
  end if;
  if nullif(created->>'order_id','') is null or nullif(created->>'payment_token','') is null then
    raise exception 'Incomplete checkout result' using errcode='XX000';
  end if;
  created:=created||jsonb_build_object('payment_method',p_payload->>'payment_method');
  update public.checkout_order_requests set result=created where request_key=p_request_key;
  return created;
end $$;
revoke all on function public.create_checkout_order_once(uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function public.recover_checkout_order(p_request_key uuid,p_request_secret text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.checkout_order_requests%rowtype; recovered jsonb;
begin
  if p_request_key is null or p_request_secret is null or p_request_secret !~ '^[0-9a-f]{64}$' then
    raise exception '訂單恢復憑證或登入身分無效' using errcode='42501';
  end if;
  -- Wait for a concurrent creation to commit or roll back before declaring absence.
  perform pg_advisory_xact_lock(hashtextextended(p_request_key::text,91309));
  select * into r from public.checkout_order_requests where request_key=p_request_key for update;
  if not found then return null; end if;
  if r.owner_id is distinct from auth.uid() or r.secret_hash<>encode(sha256(convert_to(p_request_secret,'UTF8')),'hex') then
    raise exception '訂單恢復憑證或登入身分無效' using errcode='42501';
  end if;
  if r.result is null then raise exception 'Incomplete request' using errcode='55000'; end if;
  select r.result||jsonb_build_object('recovered_order_state',o.status,'payment_due_at',o.payment_due_at,
    'gateway_created',a.gateway_created_at is not null) into recovered
  from public.orders o left join public.order_payment_authorizations a on a.order_id=o.id
  where o.id=r.result->>'order_id';
  if recovered is null then raise exception '原訂單已無法查回，請聯繫客服，勿重新下單。' using errcode='55000'; end if;
  return recovered;
end $$;
revoke all on function public.recover_checkout_order(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.recover_checkout_order(uuid,text) to anon,authenticated;

create or replace function public.create_order_with_pricing(
  p_items jsonb,
  p_member text,
  p_address text,
  p_phone text,
  p_email text,
  p_note text,
  p_payment_method text,
  p_fulfillment_method text,
  p_coupon_code text,
  p_invoice_type text,
  p_invoice_company_name text,
  p_invoice_tax_id text,
  p_shopping_credit_amount bigint,
  p_expected_quote jsonb,
  p_request_key uuid,
  p_request_secret text,
  p_expected_user_id uuid)
returns jsonb language sql security definer set search_path='' as $$
  select public.create_checkout_order_once(p_request_key,p_request_secret,p_expected_user_id,
    jsonb_build_object('wallet_pricing',false,
      'items',p_items,
      'member',p_member,
      'address',p_address,
      'phone',p_phone,
      'email',p_email,
      'note',p_note,
      'payment_method',p_payment_method,
      'fulfillment_method',p_fulfillment_method,
      'coupon_code',p_coupon_code,
      'invoice_type',p_invoice_type,
      'invoice_company_name',p_invoice_company_name,
      'invoice_tax_id',p_invoice_tax_id,
      'shopping_credit_amount',p_shopping_credit_amount,
      'expected_quote',p_expected_quote));
$$;
revoke all on function public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint,jsonb,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint,jsonb,uuid,text,uuid) to anon,authenticated;

create or replace function public.create_order_with_wallets(
  p_items jsonb,
  p_member text,
  p_address text,
  p_phone text,
  p_email text,
  p_note text,
  p_payment_method text,
  p_fulfillment_method text,
  p_coupon_code text,
  p_invoice_type text,
  p_invoice_company_name text,
  p_invoice_tax_id text,
  p_shopping_credit_amount bigint,
  p_reward_credit_amount bigint,
  p_expected_quote jsonb,
  p_request_key uuid,
  p_request_secret text,
  p_expected_user_id uuid)
returns jsonb language sql security definer set search_path='' as $$
  select public.create_checkout_order_once(p_request_key,p_request_secret,p_expected_user_id,
    jsonb_build_object('wallet_pricing',true,
      'items',p_items,
      'member',p_member,
      'address',p_address,
      'phone',p_phone,
      'email',p_email,
      'note',p_note,
      'payment_method',p_payment_method,
      'fulfillment_method',p_fulfillment_method,
      'coupon_code',p_coupon_code,
      'invoice_type',p_invoice_type,
      'invoice_company_name',p_invoice_company_name,
      'invoice_tax_id',p_invoice_tax_id,
      'shopping_credit_amount',p_shopping_credit_amount,
      'reward_credit_amount',p_reward_credit_amount,
      'expected_quote',p_expected_quote));
$$;
revoke all on function public.create_order_with_wallets(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint,bigint,jsonb,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_order_with_wallets(jsonb,text,text,text,text,text,text,text,text,text,text,text,bigint,bigint,jsonb,uuid,text,uuid) to anon,authenticated;

commit;
