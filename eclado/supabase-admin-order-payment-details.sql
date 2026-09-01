-- 後台安全檢視付款狀態與付款嘗試，不回傳付款網址、憑證、虛擬帳號或交易編號。
create or replace function public.get_admin_order_payment_details()
returns table(
  order_id text,
  attempt_no integer,
  payment_method text,
  payment_state text,
  provider_status text,
  provider_description text,
  created_at timestamptz,
  updated_at timestamptz
)
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
  select
    attempt.order_id,
    attempt.attempt_no,
    attempt.payment_method,
    attempt.payment_state,
    attempt.provider_status,
    left(attempt.provider_description, 300),
    attempt.created_at,
    attempt.updated_at
  from public.order_payment_attempts attempt

  union all

  select
    instruction.order_id,
    coalesce(instruction.attempt_no, 1),
    instruction.payment_method,
    instruction.payment_state,
    instruction.provider_status,
    left(instruction.provider_description, 300),
    instruction.gateway_created_at,
    instruction.updated_at
  from public.order_payment_instructions instruction
  where not exists (
    select 1
    from public.order_payment_attempts attempt
    where attempt.order_id = instruction.order_id
  );
end;
$$;

revoke all on function public.get_admin_order_payment_details() from public;
grant execute on function public.get_admin_order_payment_details() to authenticated;

comment on function public.get_admin_order_payment_details() is
  'Returns payment state and sanitized attempt history to authenticated ECLADO admins.';
