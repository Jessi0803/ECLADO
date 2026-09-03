-- ECLADO manual guest-order member assignment.
-- Run after supabase-backoffice-permissions.sql and supabase-admin-audit-logs.sql.

begin;

create or replace function public.assign_guest_order_to_member(
  p_order_id text,
  p_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  target_order public.orders%rowtype;
  target_member public.profiles%rowtype;
begin
  if actor_id is null
    or not public.has_backoffice_permission('orders.write')
    or not public.has_backoffice_permission('members.write')
  then
    raise exception 'Administrator order and member write permissions are required'
      using errcode = '42501';
  end if;

  if nullif(trim(p_order_id), '') is null or p_member_id is null then
    raise exception 'Order and member are required' using errcode = '22023';
  end if;

  select profile.*
    into target_member
  from public.profiles profile
  where profile.id = p_member_id;

  if not found then
    raise exception 'Member profile not found' using errcode = 'P0002';
  end if;

  select orders.*
    into target_order
  from public.orders orders
  where orders.id = trim(p_order_id)
  for update;

  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;

  if target_order.user_id is not null then
    raise exception 'Order is already assigned to a member'
      using errcode = '23505';
  end if;

  update public.orders
  set user_id = target_member.id
  where id = target_order.id
    and user_id is null;

  if not found then
    raise exception 'Order was assigned by another administrator'
      using errcode = '40001';
  end if;

  select admin_user.role
    into actor_role
  from public.admin_users admin_user
  where admin_user.user_id = actor_id
    and admin_user.active = true;

  -- The normal order audit projection intentionally excludes customer data,
  -- so this ownership change is recorded explicitly with UUIDs only.
  insert into public.audit_logs (
    actor_user_id,
    actor_email,
    actor_role,
    actor_type,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    metadata
  ) values (
    actor_id,
    nullif(auth.jwt() ->> 'email', ''),
    actor_role,
    'admin',
    'orders.member_assigned',
    'orders',
    target_order.id,
    jsonb_build_object('user_id', target_order.user_id),
    jsonb_build_object('user_id', target_member.id),
    jsonb_build_object('source', 'manual-order-member-assignment')
  );

  return jsonb_build_object(
    'order_id', target_order.id,
    'member_id', target_member.id,
    'member_name', coalesce(target_member.name, ''),
    'member_email', coalesce(target_member.email, '')
  );
end;
$$;

revoke all on function public.assign_guest_order_to_member(text, uuid) from public, anon;
grant execute on function public.assign_guest_order_to_member(text, uuid) to authenticated;

comment on function public.assign_guest_order_to_member(text, uuid) is
  'Atomically assigns one unowned guest order to one existing member and records an audit event.';

commit;
