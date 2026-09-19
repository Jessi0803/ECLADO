-- 師資 / 經銷商季度：可回溯資格起始日，並補登官網上線前的線下採購（每季總額）。
-- 依賴 supabase-member-quarterly-sales.sql 與 supabase-backoffice-permissions.sql。

create table if not exists public.professional_sales_adjustments (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.professional_memberships(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  quarter_number integer not null check (quarter_number >= 1),
  amount numeric(12, 0) not null check (amount >= 0),
  note text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (membership_id, quarter_number)
);

drop trigger if exists trg_professional_sales_adjustments_updated_at on public.professional_sales_adjustments;
create trigger trg_professional_sales_adjustments_updated_at
  before update on public.professional_sales_adjustments
  for each row execute function public.set_updated_at();

-- 只透過下方 security definer RPC 讀寫。
alter table public.professional_sales_adjustments enable row level security;
revoke all on table public.professional_sales_adjustments from anon, authenticated;

comment on table public.professional_sales_adjustments is
  'Offline / pre-website purchase totals per professional membership quarter, entered by backoffice staff.';

create or replace function public.record_professional_sales_audit(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_before jsonb,
  p_after jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
begin
  select admin_user.role
    into actor_role
  from public.admin_users admin_user
  where admin_user.user_id = actor_id
    and admin_user.active = true;

  insert into public.audit_logs (
    actor_user_id, actor_email, actor_role, actor_type,
    action, entity_type, entity_id, before_data, after_data, metadata
  ) values (
    actor_id,
    nullif(auth.jwt() ->> 'email', ''),
    actor_role,
    'admin',
    p_action,
    p_entity_type,
    p_entity_id,
    p_before,
    p_after,
    jsonb_build_object('source', 'professional-sales-opening-balance')
  );
end;
$$;

revoke all on function public.record_professional_sales_audit(text, text, text, jsonb, jsonb) from public, anon, authenticated;

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
  if exists (
    select 1
    from public.professional_memberships other
    where other.user_id = target.user_id
      and other.id <> target.id
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

create or replace function public.save_professional_sales_adjustment(
  p_membership_id uuid,
  p_quarter_number integer,
  p_amount numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.professional_memberships%rowtype;
  existing public.professional_sales_adjustments%rowtype;
  today date := (now() at time zone 'Asia/Taipei')::date;
  quarter_start date;
  clean_note text := nullif(btrim(coalesce(p_note, '')), '');
  clean_amount numeric(12, 0) := round(coalesce(p_amount, 0));
begin
  if not public.has_backoffice_permission('members.write') then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  if p_quarter_number is null or p_quarter_number < 1 then
    raise exception 'Invalid quarter number' using errcode = '22023';
  end if;
  if clean_amount < 0 or clean_amount > 999999999 then
    raise exception 'Invalid adjustment amount' using errcode = '22023';
  end if;

  select * into target
  from public.professional_memberships
  where id = p_membership_id;
  if not found then
    raise exception 'Membership not found' using errcode = 'P0002';
  end if;

  quarter_start := (target.started_on + make_interval(months => (p_quarter_number - 1) * 3))::date;
  if quarter_start > today or (target.ended_on is not null and quarter_start >= target.ended_on) then
    raise exception 'Quarter is outside the membership period' using errcode = '22023';
  end if;

  select * into existing
  from public.professional_sales_adjustments
  where membership_id = target.id
    and quarter_number = p_quarter_number
  for update;

  if clean_amount = 0 and clean_note is null then
    if existing.id is not null then
      delete from public.professional_sales_adjustments where id = existing.id;
    end if;
  elsif existing.id is not null then
    update public.professional_sales_adjustments
    set amount = clean_amount,
        note = clean_note,
        updated_by = auth.uid()
    where id = existing.id;
  else
    insert into public.professional_sales_adjustments (
      membership_id, user_id, quarter_number, amount, note, created_by, updated_by
    ) values (
      target.id, target.user_id, p_quarter_number, clean_amount, clean_note, auth.uid(), auth.uid()
    );
  end if;

  if coalesce(existing.amount, 0) <> clean_amount or existing.note is distinct from clean_note then
    perform public.record_professional_sales_audit(
      'professional_sales_adjustments.saved',
      'professional_sales_adjustments',
      target.id::text || ':' || p_quarter_number,
      case when existing.id is null then null
        else jsonb_build_object('user_id', target.user_id, 'quarter_number', p_quarter_number, 'amount', existing.amount, 'note', existing.note) end,
      case when clean_amount = 0 and clean_note is null then null
        else jsonb_build_object('user_id', target.user_id, 'quarter_number', p_quarter_number, 'amount', clean_amount, 'note', clean_note) end
    );
  end if;

  return jsonb_build_object(
    'membership_id', target.id,
    'quarter_number', p_quarter_number,
    'amount', clean_amount,
    'note', clean_note
  );
end;
$$;

-- 季度總額 = 官網已付款訂單 + 線下補登；回傳最近 40 季（約 10 年）供後台補登舊資料。
create or replace function public.get_professional_sales_payload(p_member_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with membership_rows as (
    select membership.*
    from public.professional_memberships membership
    where membership.user_id = p_member_id
  ), quarter_periods as (
    select
      membership.id as membership_id,
      membership.role,
      membership.started_on as membership_started_on,
      membership.ended_on as membership_ended_on,
      series.quarter_index + 1 as quarter_number,
      (membership.started_on + make_interval(months => series.quarter_index * 3))::date as period_start,
      least(
        (membership.started_on + make_interval(months => (series.quarter_index + 1) * 3))::date,
        coalesce(membership.ended_on, 'infinity'::date)
      ) as period_end_exclusive,
      membership.ended_on is null
        and (now() at time zone 'Asia/Taipei')::date >= (membership.started_on + make_interval(months => series.quarter_index * 3))::date
        and (now() at time zone 'Asia/Taipei')::date < (membership.started_on + make_interval(months => (series.quarter_index + 1) * 3))::date
        as is_current,
      membership.ended_on is not null
        and membership.ended_on < (membership.started_on + make_interval(months => (series.quarter_index + 1) * 3))::date
        as is_partial
    from membership_rows membership
    cross join lateral generate_series(0, 399) series(quarter_index)
    where (membership.started_on + make_interval(months => series.quarter_index * 3))::date
      < coalesce(membership.ended_on, ((now() at time zone 'Asia/Taipei')::date + 1))
      and (membership.started_on + make_interval(months => series.quarter_index * 3))::date
        <= (now() at time zone 'Asia/Taipei')::date
  ), online_sales as (
    select
      period.*,
      coalesce(sum(public.order_net_merchandise_amount(
        target_order.subtotal,
        target_order.discount,
        target_order.total,
        target_order.items,
        target_order.pricing_snapshot
      )) filter (where target_order.id is not null), 0) as online_sales_amount,
      count(target_order.id)::integer as order_count,
      max(target_order.paid_at) as last_paid_at
    from quarter_periods period
    left join public.orders target_order
      on target_order.user_id = p_member_id
      and target_order.status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered')
      and target_order.paid_at is not null
      and (target_order.paid_at at time zone 'Asia/Taipei')::date >= period.period_start
      and (target_order.paid_at at time zone 'Asia/Taipei')::date < period.period_end_exclusive
    group by
      period.membership_id,
      period.role,
      period.membership_started_on,
      period.membership_ended_on,
      period.quarter_number,
      period.period_start,
      period.period_end_exclusive,
      period.is_current,
      period.is_partial
  ), quarter_sales as (
    select
      online.*,
      coalesce(adjustment.amount, 0) as offline_sales_amount,
      adjustment.note as offline_note,
      online.online_sales_amount + coalesce(adjustment.amount, 0) as sales_amount
    from online_sales online
    left join public.professional_sales_adjustments adjustment
      on adjustment.membership_id = online.membership_id
      and adjustment.quarter_number = online.quarter_number
  )
  select jsonb_build_object(
    'member_id', p_member_id,
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', membership.id,
        'role', membership.role,
        'started_on', membership.started_on,
        'ended_on', membership.ended_on,
        'change_reason', membership.change_reason
      ) order by membership.started_on desc, membership.created_at desc)
      from membership_rows membership
    ), '[]'::jsonb),
    'quarters', coalesce((
      select jsonb_agg(to_jsonb(recent_quarter) order by recent_quarter.period_start desc)
      from (
        select *
        from quarter_sales
        order by period_start desc
        limit 40
      ) recent_quarter
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_professional_sales_payload(uuid) from public, anon, authenticated;
revoke all on function public.set_professional_membership_start(uuid, date) from public, anon;
revoke all on function public.save_professional_sales_adjustment(uuid, integer, numeric, text) from public, anon;
grant execute on function public.set_professional_membership_start(uuid, date) to authenticated;
grant execute on function public.save_professional_sales_adjustment(uuid, integer, numeric, text) to authenticated;

notify pgrst, 'reload schema';
