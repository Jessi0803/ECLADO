-- Align instructor/distributor sales periods to Taiwan calendar quarters.
-- Qualification history keeps its real effective dates; only reporting periods
-- become Jan-Mar, Apr-Jun, Jul-Sep and Oct-Dec.
--
-- Deploy after:
--   supabase-member-quarterly-sales.sql
--   supabase-professional-sales-opening-balance.sql
--   supabase-professional-memberships-empty-periods.sql

begin;

alter table public.professional_sales_adjustments
  add column if not exists quarter_start date;

-- A legacy adjustment contains one total for a membership-relative three-month
-- period. Refuse an automatic migration if that period crosses a calendar-quarter
-- boundary, because the total cannot be split safely without transaction dates.
do $$
declare
  ambiguous_adjustments integer;
begin
  select count(*)::integer
  into ambiguous_adjustments
  from public.professional_sales_adjustments adjustment
  join public.professional_memberships membership
    on membership.id = adjustment.membership_id
  cross join lateral (
    select (
      membership.started_on
      + make_interval(months => (adjustment.quarter_number - 1) * 3)
    )::date as legacy_start
  ) legacy
  where adjustment.quarter_start is null
    and least(
      (legacy.legacy_start + interval '3 months')::date,
      coalesce(membership.ended_on, 'infinity'::date)
    ) > (date_trunc('quarter', legacy.legacy_start::timestamp) + interval '3 months')::date;

  if ambiguous_adjustments > 0 then
    raise exception '% legacy professional sales adjustment(s) cross a calendar-quarter boundary; split them manually before migration', ambiguous_adjustments
      using errcode = '23514';
  end if;
end;
$$;

update public.professional_sales_adjustments adjustment
set quarter_start = date_trunc(
  'quarter',
  (
    membership.started_on
    + make_interval(months => (adjustment.quarter_number - 1) * 3)
  )::timestamp
)::date
from public.professional_memberships membership
where membership.id = adjustment.membership_id
  and adjustment.quarter_start is null;

alter table public.professional_sales_adjustments
  alter column quarter_start set not null;

alter table public.professional_sales_adjustments
  drop constraint if exists professional_sales_adjustments_membership_id_quarter_number_key;

create unique index if not exists professional_sales_adjustments_membership_quarter_start_idx
  on public.professional_sales_adjustments (membership_id, quarter_start);

comment on column public.professional_sales_adjustments.quarter_start is
  'First day of the Taiwan calendar quarter (Jan/Apr/Jul/Oct) for this offline sales total.';

comment on table public.professional_memberships is
  'Instructor/distributor role history with exact effective dates; sales reporting is aligned to Taiwan calendar quarters and clipped to these periods.';

create or replace function public.save_professional_sales_adjustment_v2(
  p_membership_id uuid,
  p_quarter_start date,
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
  normalized_quarter_start date;
  membership_anchor date;
  target_quarter_end date;
  target_quarter_number integer;
  clean_note text := nullif(btrim(coalesce(p_note, '')), '');
  clean_amount numeric(12, 0) := round(coalesce(p_amount, 0));
begin
  if not public.has_backoffice_permission('members.write') then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  if p_quarter_start is null then
    raise exception 'Quarter start is required' using errcode = '22023';
  end if;

  normalized_quarter_start := date_trunc('quarter', p_quarter_start::timestamp)::date;
  if normalized_quarter_start <> p_quarter_start then
    raise exception 'Quarter start must be the first day of a calendar quarter' using errcode = '22023';
  end if;
  if clean_amount < 0 or clean_amount > 999999999 then
    raise exception 'Invalid adjustment amount' using errcode = '22023';
  end if;

  select * into target
  from public.professional_memberships
  where id = p_membership_id
  for update;
  if not found then
    raise exception 'Membership not found' using errcode = 'P0002';
  end if;

  membership_anchor := date_trunc('quarter', target.started_on::timestamp)::date;
  target_quarter_end := (normalized_quarter_start + interval '3 months')::date;
  if normalized_quarter_start > date_trunc('quarter', today::timestamp)::date
    or target_quarter_end <= target.started_on
    or (target.ended_on is not null and normalized_quarter_start >= target.ended_on)
  then
    raise exception 'Quarter is outside the membership period' using errcode = '22023';
  end if;

  target_quarter_number := (
    (extract(year from normalized_quarter_start)::integer - extract(year from membership_anchor)::integer) * 4
    + extract(quarter from normalized_quarter_start)::integer
    - extract(quarter from membership_anchor)::integer
    + 1
  );

  select * into existing
  from public.professional_sales_adjustments
  where membership_id = target.id
    and quarter_start = normalized_quarter_start
  for update;

  if clean_amount = 0 and clean_note is null then
    if existing.id is not null then
      delete from public.professional_sales_adjustments where id = existing.id;
    end if;
  elsif existing.id is not null then
    update public.professional_sales_adjustments
    set quarter_number = target_quarter_number,
        amount = clean_amount,
        note = clean_note,
        updated_by = auth.uid()
    where id = existing.id;
  else
    insert into public.professional_sales_adjustments (
      membership_id, user_id, quarter_number, quarter_start,
      amount, note, created_by, updated_by
    ) values (
      target.id, target.user_id, target_quarter_number, normalized_quarter_start,
      clean_amount, clean_note, auth.uid(), auth.uid()
    );
  end if;

  if coalesce(existing.amount, 0) <> clean_amount or existing.note is distinct from clean_note then
    perform public.record_professional_sales_audit(
      'professional_sales_adjustments.saved',
      'professional_sales_adjustments',
      target.id::text || ':' || normalized_quarter_start::text,
      case when existing.id is null then null
        else jsonb_build_object(
          'user_id', target.user_id,
          'quarter_start', existing.quarter_start,
          'amount', existing.amount,
          'note', existing.note
        ) end,
      case when clean_amount = 0 and clean_note is null then null
        else jsonb_build_object(
          'user_id', target.user_id,
          'quarter_start', normalized_quarter_start,
          'amount', clean_amount,
          'note', clean_note
        ) end
    );
  end if;

  return jsonb_build_object(
    'membership_id', target.id,
    'quarter_number', target_quarter_number,
    'quarter_start', normalized_quarter_start,
    'amount', clean_amount,
    'note', clean_note
  );
end;
$$;

-- Keep the original RPC working while an older frontend is still deployed.
-- Its sequential quarter number is now anchored to the first calendar quarter
-- touched by the qualification period.
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
  membership_anchor date;
begin
  if p_quarter_number is null or p_quarter_number < 1 then
    raise exception 'Invalid quarter number' using errcode = '22023';
  end if;

  select * into target
  from public.professional_memberships
  where id = p_membership_id;
  if not found then
    raise exception 'Membership not found' using errcode = 'P0002';
  end if;

  membership_anchor := date_trunc('quarter', target.started_on::timestamp)::date;
  return public.save_professional_sales_adjustment_v2(
    p_membership_id,
    (membership_anchor + make_interval(months => (p_quarter_number - 1) * 3))::date,
    p_amount,
    p_note
  );
end;
$$;

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
  ), calendar_quarters as (
    select
      membership.*,
      series.quarter_index,
      (
        date_trunc('quarter', membership.started_on::timestamp)
        + make_interval(months => series.quarter_index * 3)
      )::date as quarter_start
    from membership_rows membership
    cross join lateral generate_series(0, 399) series(quarter_index)
  ), quarter_periods as (
    select
      membership.id as membership_id,
      membership.role,
      membership.started_on as membership_started_on,
      membership.ended_on as membership_ended_on,
      membership.quarter_index + 1 as quarter_number,
      membership.quarter_start,
      extract(year from membership.quarter_start)::integer as calendar_year,
      extract(quarter from membership.quarter_start)::integer as calendar_quarter,
      greatest(membership.started_on, membership.quarter_start) as period_start,
      least(
        (membership.quarter_start + interval '3 months')::date,
        coalesce(membership.ended_on, 'infinity'::date)
      ) as period_end_exclusive,
      membership.ended_on is null
        and (now() at time zone 'Asia/Taipei')::date >= greatest(membership.started_on, membership.quarter_start)
        and (now() at time zone 'Asia/Taipei')::date < (membership.quarter_start + interval '3 months')::date
        as is_current,
      greatest(membership.started_on, membership.quarter_start) > membership.quarter_start
        or least(
          (membership.quarter_start + interval '3 months')::date,
          coalesce(membership.ended_on, 'infinity'::date)
        ) < (membership.quarter_start + interval '3 months')::date
        as is_partial
    from calendar_quarters membership
    where membership.quarter_start <= (now() at time zone 'Asia/Taipei')::date
      and greatest(membership.started_on, membership.quarter_start) < least(
        (membership.quarter_start + interval '3 months')::date,
        coalesce(membership.ended_on, ((now() at time zone 'Asia/Taipei')::date + 1))
      )
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
      period.quarter_start,
      period.calendar_year,
      period.calendar_quarter,
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
      and adjustment.quarter_start = online.quarter_start
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
      and coalesce(other.ended_on, 'infinity'::date) > other.started_on
      and other.started_on < coalesce(target.ended_on, 'infinity'::date)
      and coalesce(other.ended_on, 'infinity'::date) > p_started_on
  ) then
    raise exception 'Start date overlaps another membership period' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.professional_sales_adjustments adjustment
    where adjustment.membership_id = target.id
      and greatest(p_started_on, adjustment.quarter_start) >= least(
        coalesce(target.ended_on, 'infinity'::date),
        (adjustment.quarter_start + interval '3 months')::date
      )
  ) then
    raise exception 'Start date change would orphan an offline sales adjustment' using errcode = '22023';
  end if;
  if target.started_on = p_started_on then
    return jsonb_build_object('membership_id', target.id, 'started_on', target.started_on, 'changed', false);
  end if;

  update public.professional_memberships
  set started_on = p_started_on
  where id = target.id;

  update public.professional_sales_adjustments adjustment
  set quarter_number = (
    (extract(year from adjustment.quarter_start)::integer
      - extract(year from date_trunc('quarter', p_started_on::timestamp))::integer) * 4
    + extract(quarter from adjustment.quarter_start)::integer
    - extract(quarter from date_trunc('quarter', p_started_on::timestamp))::integer
    + 1
  )
  where adjustment.membership_id = target.id;

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

revoke all on function public.save_professional_sales_adjustment_v2(uuid, date, numeric, text) from public, anon;
revoke all on function public.save_professional_sales_adjustment(uuid, integer, numeric, text) from public, anon;
revoke all on function public.get_professional_sales_payload(uuid) from public, anon, authenticated;
revoke all on function public.set_professional_membership_start(uuid, date) from public, anon;
grant execute on function public.save_professional_sales_adjustment_v2(uuid, date, numeric, text) to authenticated;
grant execute on function public.save_professional_sales_adjustment(uuid, integer, numeric, text) to authenticated;
grant execute on function public.set_professional_membership_start(uuid, date) to authenticated;

commit;

notify pgrst, 'reload schema';
