-- Member-specific quarterly sales for instructor and distributor memberships.
-- A quarter is three calendar months from the membership effective date in Taiwan.
-- Run after supabase-backoffice-permissions.sql and supabase-payment-retry.sql.

alter table public.orders
  add column if not exists paid_at timestamptz;

create or replace function public.set_order_first_paid_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.paid_at is null
    and new.status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered')
    and (
      tg_op = 'INSERT'
      or old.status not in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered')
    )
  then
    new.paid_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_first_paid_at on public.orders;
create trigger trg_orders_first_paid_at
  before insert or update of status on public.orders
  for each row execute function public.set_order_first_paid_at();

-- Prefer the first successful payment attempt for existing orders. Older orders
-- without an attempt record fall back to their creation time.
do $$
begin
  if to_regclass('public.order_payment_attempts') is not null then
    execute $backfill$
      update public.orders target_order
      set paid_at = coalesce(
        (
          select min(attempt.updated_at)
          from public.order_payment_attempts attempt
          where attempt.order_id = target_order.id
            and attempt.payment_state = 'paid'
        ),
        target_order.created_at
      )
      where target_order.paid_at is null
        and target_order.status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered')
    $backfill$;
  else
    update public.orders
    set paid_at = created_at
    where paid_at is null
      and status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered');
  end if;
end;
$$;

create index if not exists idx_orders_member_paid_at
  on public.orders (user_id, paid_at)
  where paid_at is not null;

create table if not exists public.professional_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('instructor', 'distributor')),
  started_on date not null,
  ended_on date,
  created_by uuid references auth.users(id) on delete set null,
  change_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_on is null or ended_on >= started_on)
);

drop trigger if exists trg_professional_memberships_updated_at on public.professional_memberships;
create trigger trg_professional_memberships_updated_at
  before update on public.professional_memberships
  for each row execute function public.set_updated_at();

create unique index if not exists professional_memberships_one_active_per_user
  on public.professional_memberships (user_id)
  where ended_on is null;

create index if not exists idx_professional_memberships_user_started
  on public.professional_memberships (user_id, started_on desc);

alter table public.professional_memberships enable row level security;
revoke all on table public.professional_memberships from anon, authenticated;
grant select on table public.professional_memberships to authenticated;

drop policy if exists "professional_memberships_select_own" on public.professional_memberships;
create policy "professional_memberships_select_own"
  on public.professional_memberships for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "professional_memberships_select_backoffice" on public.professional_memberships;
create policy "professional_memberships_select_backoffice"
  on public.professional_memberships for select to authenticated
  using (public.has_backoffice_permission('members.read'));

do $$
begin
  alter publication supabase_realtime add table public.professional_memberships;
exception when duplicate_object then null;
end $$;

-- Existing instructor/distributor accounts begin their first measurable cycle on
-- the migration date. Their historical role effective date cannot be inferred safely.
insert into public.professional_memberships (user_id, role, started_on, change_reason)
select
  profile.id,
  profile.role,
  (now() at time zone 'Asia/Taipei')::date,
  'quarterly_sales_migration'
from public.profiles profile
where profile.role in ('instructor', 'distributor')
  and not exists (
    select 1
    from public.professional_memberships membership
    where membership.user_id = profile.id
      and membership.ended_on is null
  );

create or replace function public.order_net_merchandise_amount(
  p_subtotal numeric,
  p_discount numeric,
  p_total numeric,
  p_items jsonb,
  p_pricing_snapshot jsonb
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select greatest(0, coalesce(
    case when p_subtotal is not null
      then p_subtotal - coalesce(p_discount, 0)
    end,
    case when jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0
      then (
        select coalesce(sum(
          coalesce(nullif(item ->> 'price', '')::numeric, nullif(item ->> 'unit_price', '')::numeric, 0)
          * coalesce(nullif(item ->> 'qty', '')::numeric, 1)
        ), 0)
        from jsonb_array_elements(p_items) item
      ) - coalesce(p_discount, 0)
    end,
    coalesce(p_total, 0) - coalesce(nullif(p_pricing_snapshot ->> 'shipping', '')::numeric, 0)
  ));
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
  ), quarter_sales as (
    select
      period.*,
      coalesce(sum(public.order_net_merchandise_amount(
        target_order.subtotal,
        target_order.discount,
        target_order.total,
        target_order.items,
        target_order.pricing_snapshot
      )) filter (where target_order.id is not null), 0) as sales_amount,
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
        limit 8
      ) recent_quarter
    ), '[]'::jsonb)
  );
$$;

create or replace function public.get_my_professional_sales()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  return public.get_professional_sales_payload(auth.uid());
end;
$$;

create or replace function public.get_admin_professional_sales()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  payload jsonb;
begin
  if not public.has_backoffice_permission('members.read') then
    raise exception 'Member read access required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
    public.get_professional_sales_payload(profile.id)
    order by profile.created_at desc
  ), '[]'::jsonb)
  into payload
  from public.profiles profile
  where profile.role in ('instructor', 'distributor')
    or exists (
      select 1 from public.professional_memberships membership
      where membership.user_id = profile.id
    );

  return payload;
end;
$$;

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

  update public.professional_memberships
  set ended_on = effective_on,
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

revoke all on function public.order_net_merchandise_amount(numeric, numeric, numeric, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.get_professional_sales_payload(uuid) from public, anon, authenticated;
revoke all on function public.get_my_professional_sales() from public, anon;
revoke all on function public.get_admin_professional_sales() from public, anon;
revoke all on function public.set_member_role_with_membership(uuid, text, date, text) from public, anon;
grant execute on function public.get_my_professional_sales() to authenticated;
grant execute on function public.get_admin_professional_sales() to authenticated;
grant execute on function public.set_member_role_with_membership(uuid, text, date, text) to authenticated;

comment on table public.professional_memberships is
  'Instructor/distributor role history and the anchor date for member-specific three-month sales quarters.';
comment on column public.orders.paid_at is
  'First time the order entered a paid or fulfilment status; used for sales-period attribution.';
