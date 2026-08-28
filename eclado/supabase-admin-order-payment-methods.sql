-- 後台訂單列表以付款方式取代已停用的付款末五碼。
-- 不直接開放 order_payment_instructions，避免洩漏虛擬帳號與付款連結。
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
