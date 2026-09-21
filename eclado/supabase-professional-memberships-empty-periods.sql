-- 同一天內切換會員身分會留下 started_on = ended_on 的空資格紀錄，
-- 這些紀錄不涵蓋任何日期，卻會讓回溯起始日時被判定為重疊。
-- 1) 清除既有空紀錄（沒有線下補登者）
-- 2) 之後同日切換身分直接刪除空紀錄
-- 3) 回溯起始日的重疊檢查忽略空紀錄
-- 依賴 supabase-professional-sales-opening-balance.sql。

delete from public.professional_memberships membership
where membership.ended_on = membership.started_on
  and not exists (
    select 1
    from public.professional_sales_adjustments adjustment
    where adjustment.membership_id = membership.id
  );

create or replace function public.set_member_role_with_membership(
  p_member_id uuid,
  p_role text,
  p_effective_on date default null,
  p_change_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_profile public.profiles%rowtype;
  effective_on date := coalesce(p_effective_on, (now() at time zone 'Asia/Taipei')::date);
begin
  if not public.has_backoffice_permission('members.write') then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  if p_role not in ('consumer', 'pro', 'instructor', 'distributor', 'pending') then
    raise exception 'Invalid member role' using errcode = '22023';
  end if;
  if effective_on > (now() at time zone 'Asia/Taipei')::date then
    raise exception 'Effective date cannot be in the future' using errcode = '22023';
  end if;

  select * into target_profile
  from public.profiles
  where id = p_member_id
  for update;
  if not found then
    raise exception 'Member not found' using errcode = 'P0002';
  end if;

  if target_profile.role = p_role then
    return jsonb_build_object('member_id', p_member_id, 'role', p_role, 'changed', false);
  end if;

  -- A membership that would end on the day it started covers no dates; drop it
  -- instead of keeping an empty history row (unless offline sales were recorded).
  delete from public.professional_memberships membership
  where membership.user_id = p_member_id
    and membership.ended_on is null
    and membership.started_on >= effective_on
    and not exists (
      select 1
      from public.professional_sales_adjustments adjustment
      where adjustment.membership_id = membership.id
    );

  update public.professional_memberships
  set ended_on = greatest(effective_on, started_on),
      change_reason = coalesce(nullif(btrim(p_change_reason), ''), change_reason)
  where user_id = p_member_id
    and ended_on is null;

  if p_role in ('instructor', 'distributor') then
    insert into public.professional_memberships (
      user_id, role, started_on, created_by, change_reason
    ) values (
      p_member_id,
      p_role,
      effective_on,
      auth.uid(),
      nullif(btrim(p_change_reason), '')
    );
  end if;

  update public.profiles
  set role = p_role
  where id = p_member_id;

  return jsonb_build_object(
    'member_id', p_member_id,
    'previous_role', target_profile.role,
    'role', p_role,
    'effective_on', effective_on,
    'changed', true
  );
end;
$$;

create or replace function public.set_professional_membership_start(
  p_membership_id uuid,
  p_started_on date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.professional_memberships%rowtype;
  today date := (now() at time zone 'Asia/Taipei')::date;
begin
  if not public.has_backoffice_permission('members.write') then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  if p_started_on is null or p_started_on > today then
    raise exception 'Start date cannot be empty or in the future' using errcode = '22023';
  end if;

  select * into target
  from public.professional_memberships
  where id = p_membership_id
  for update;
  if not found then
    raise exception 'Membership not found' using errcode = 'P0002';
  end if;
  if target.ended_on is not null and p_started_on > target.ended_on then
    raise exception 'Start date cannot be after the membership end date' using errcode = '22023';
  end if;
  -- Periods are [started_on, ended_on); empty periods (started_on = ended_on) never overlap.
  if exists (
    select 1
    from public.professional_memberships other
    where other.user_id = target.user_id
      and other.id <> target.id
      and coalesce(other.ended_on, 'infinity'::date) > other.started_on
      and other.started_on < coalesce(target.ended_on, 'infinity'::date)
      and coalesce(other.ended_on, 'infinity'::date) > p_started_on
  ) then
    raise exception 'Start date overlaps another membership period' using errcode = '22023';
  end if;
  if target.started_on = p_started_on then
    return jsonb_build_object('membership_id', target.id, 'started_on', target.started_on, 'changed', false);
  end if;

  update public.professional_memberships
  set started_on = p_started_on
  where id = target.id;

  perform public.record_professional_sales_audit(
    'professional_memberships.start_changed',
    'professional_memberships',
    target.id::text,
    jsonb_build_object('user_id', target.user_id, 'role', target.role, 'started_on', target.started_on),
    jsonb_build_object('user_id', target.user_id, 'role', target.role, 'started_on', p_started_on)
  );

  return jsonb_build_object('membership_id', target.id, 'started_on', p_started_on, 'changed', true);
end;
$$;

revoke all on function public.set_member_role_with_membership(uuid, text, date, text) from public, anon;
revoke all on function public.set_professional_membership_start(uuid, date) from public, anon;
grant execute on function public.set_member_role_with_membership(uuid, text, date, text) to authenticated;
grant execute on function public.set_professional_membership_start(uuid, date) to authenticated;

notify pgrst, 'reload schema';
