-- Apply after the payment retry, assisted-order and wallet migrations.
-- Bank status is supplied only by the service after a signed OrderQuery.
-- Deployment order: this migration, payment API, then storefront.
-- Existing rows use gateway_created_at + 10 minutes until a new link is saved.
begin;

alter table public.order_payment_instructions
  add column if not exists link_expires_at timestamptz;
alter table public.order_payment_instructions
  drop constraint if exists order_payment_instructions_payment_state_check;
alter table public.order_payment_instructions
  add constraint order_payment_instructions_payment_state_check
  check (payment_state in ('initiated','pending','paid','failed','expired','cancelled'));

create or replace function public.begin_verified_order_payment_retry(
  p_order_id text,
  p_provider_order_no text,
  p_bank_pay_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  instruction public.order_payment_instructions%rowtype;
  payment_auth public.order_payment_authorizations%rowtype;
  result jsonb;
begin
  -- Keep the lock order used by the existing retry RPC.
  perform 1 from public.orders where id = p_order_id for update;
  select * into instruction from public.order_payment_instructions
    where order_id = p_order_id for update;
  if not found or coalesce(instruction.provider_order_no, instruction.order_id) is distinct from p_provider_order_no
    or instruction.payment_state not in ('pending', 'failed', 'expired', 'initiated') then
    raise exception '付款資訊已更新，請重新讀取原訂單。' using errcode = '55000';
  end if;
  if not coalesce((
    (instruction.payment_method = 'card' and p_bank_pay_status in ('1C250','1C350','1C351'))
    or (instruction.payment_method in ('apple','google') and p_bank_pay_status in ('1M250','1M350','1M351'))
    or (instruction.payment_method in ('card','apple','google') and p_bank_pay_status = 'NOT_CREATED'
      and instruction.payment_state = 'failed' and instruction.provider_status = 'F')
  ), false) then
    raise exception '正在確認付款狀態，請稍後再試。' using errcode = '55000';
  end if;
  select * into payment_auth from public.order_payment_authorizations
    where order_id = p_order_id for update;
  if not found or coalesce(payment_auth.provider_order_no, payment_auth.order_id) is distinct from p_provider_order_no then
    raise exception '付款資訊已更新，請重新讀取原訂單。' using errcode = '55000';
  end if;
  if p_bank_pay_status = 'NOT_CREATED'
    and (payment_auth.claimed_at is not null or payment_auth.gateway_created_at is not null) then
    raise exception '正在確認付款狀態，請稍後再試。' using errcode = '55000';
  end if;
  if exists (select 1 from public.order_payment_attempts where order_id = p_order_id and payment_state = 'paid') then
    raise exception '已收到付款，請重新整理訂單查看。' using errcode = '55000';
  end if;
  -- The bank confirmed the old attempt is closed, including a previous timeout.
  update public.order_payment_authorizations
    set claimed_at = null, gateway_created_at = coalesce(gateway_created_at, now())
    where order_id = p_order_id;
  update public.order_payment_instructions set payment_state = 'failed'
    where order_id = p_order_id;
  update public.order_payment_attempts set payment_state = 'failed', updated_at = now()
    where provider_order_no = p_provider_order_no and payment_state <> 'paid';

  -- Preserve all installed consent, wallet and order-expiry checks.
  result := public.begin_order_payment_retry(p_order_id);
  -- Rotating this reference inside the same transaction rejects stale/concurrent
  -- renewal requests and prevents old callbacks overwriting the new instruction.
  update public.order_payment_instructions
    set provider_order_no = result->>'provider_order_no',
        attempt_no = (result->>'attempt_no')::integer,
        payment_state = 'initiated', payment_url = null, link_expires_at = null,
        provider_status = null, provider_description = null,
        provider_transaction_no = null, gateway_created_at = now(), updated_at = now()
    where order_id = p_order_id;
  return result;
end;
$$;

revoke all on function public.begin_verified_order_payment_retry(text,text,text) from public, anon, authenticated;
grant execute on function public.begin_verified_order_payment_retry(text,text,text) to service_role;

commit;
