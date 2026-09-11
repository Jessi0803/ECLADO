-- ECLADO cancelled-order deletion.
-- Run after supabase-backoffice-permissions.sql and supabase-admin-audit-logs.sql.

begin;

create or replace function public.delete_cancelled_order(p_order_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_order public.orders%rowtype;
begin
  if actor_id is null
    or not public.has_backoffice_permission('orders.write')
  then
    raise exception 'Administrator order write permission is required'
      using errcode = '42501';
  end if;

  if nullif(trim(p_order_id), '') is null then
    raise exception 'Order is required' using errcode = '22023';
  end if;

  select target.*
    into target_order
  from public.orders target
  where target.id = trim(p_order_id)
  for update;

  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  if target_order.status <> 'cancelled' then
    raise exception 'Only cancelled orders can be permanently deleted'
      using errcode = '22023';
  end if;

  -- Paid orders must remain available for accounting and payment reconciliation.
  if target_order.paid_at is not null
    or exists (
      select 1
      from public.order_payment_attempts attempt
      where attempt.order_id = target_order.id
        and attempt.payment_state = 'paid'
    )
    or exists (
      select 1
      from public.order_payment_instructions instruction
      where instruction.order_id = target_order.id
        and instruction.payment_state = 'paid'
    )
  then
    raise exception 'Paid order records cannot be permanently deleted'
      using errcode = '22023';
  end if;

  delete from public.orders
  where id = target_order.id;

  return jsonb_build_object(
    'deleted', true,
    'order_id', target_order.id
  );
end;
$$;

revoke all on function public.delete_cancelled_order(text) from public, anon;
grant execute on function public.delete_cancelled_order(text) to authenticated;

comment on function public.delete_cancelled_order(text) is
  'Permanently deletes one never-paid cancelled order after checking orders.write permission.';

commit;

notify pgrst, 'reload schema';
