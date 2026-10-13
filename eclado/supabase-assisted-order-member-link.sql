-- Run after supabase-assisted-orders.sql. Allows a signed-in member to reopen
-- only their own active assisted order. The private payment token stays server-only.
begin;

do $$
begin
  if to_regclass('public.assisted_order_requests') is null
    or to_regclass('public.orders') is null then
    raise exception 'Assisted orders prerequisites missing';
  end if;
end;
$$;

create or replace function public.get_my_assisted_order_link(p_order_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null then
    raise exception '請先登入會員' using errcode='42501';
  end if;

  select jsonb_build_object('order_id', target_order.id, 'link_token', request_row.link_token)
    into result
    from public.orders target_order
    join public.assisted_order_requests request_row on request_row.order_id=target_order.id
   where target_order.id=p_order_id
     and target_order.user_id=auth.uid()
     and target_order.order_source='admin_assisted'
     and target_order.status in ('unpaid','awaiting_confirm')
     and target_order.payment_due_at>now();

  if result is null then
    raise exception '此訂單無法繼續付款，請重新整理訂單狀態或聯繫客服' using errcode='42501';
  end if;
  return result;
end;
$$;

revoke all on function public.get_my_assisted_order_link(text) from public, anon;
grant execute on function public.get_my_assisted_order_link(text) to authenticated;

commit;
