-- Professional instructor/distributor annual renewal, brand-program evidence,
-- and quarterly settlement notices.
--
-- Deploy after:
--   supabase-professional-sales-calendar-quarters.sql
--   supabase-professional-application-certificates.sql
--   supabase-admin-audit-logs.sql

begin;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'professional-renewal-evidence',
  'professional-renewal-evidence',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.professional_renewal_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  membership_id uuid not null references public.professional_memberships(id) on delete restrict,
  assessment_year integer not null check (assessment_year between 2020 and 2200),
  renewal_year integer not null check (renewal_year = assessment_year + 1),
  role text not null check (role in ('instructor', 'distributor')),
  status text not null default 'submitted'
    check (status in ('submitted', 'pending_review', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  finalized_at timestamptz,
  assessment_snapshot jsonb,
  a_qualified boolean,
  qualification_path text check (qualification_path is null or qualification_path in ('a_quarterly', 'a_annual', 'b_manual')),
  b_approved_count integer not null default 0 check (b_approved_count >= 0),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  decision_reason text,
  result_notification_sent_at timestamptz,
  result_notification_channel text check (
    result_notification_channel is null or result_notification_channel in ('line', 'email')
  ),
  result_notification_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, renewal_year)
);

create index if not exists professional_renewal_applications_status_idx
  on public.professional_renewal_applications (renewal_year, status, submitted_at);
create index if not exists professional_renewal_applications_member_idx
  on public.professional_renewal_applications (user_id, assessment_year desc);

drop trigger if exists trg_professional_renewal_applications_updated_at
  on public.professional_renewal_applications;
create trigger trg_professional_renewal_applications_updated_at
  before update on public.professional_renewal_applications
  for each row execute function public.set_updated_at();

create table if not exists public.professional_renewal_quarter_snapshots (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.professional_renewal_applications(id) on delete cascade,
  quarter_start date not null,
  calendar_quarter integer not null check (calendar_quarter between 1 and 4),
  period_start date,
  period_end_exclusive date,
  effective_days integer not null check (effective_days >= 0),
  quarter_days integer not null check (quarter_days between 89 and 92),
  threshold_amount numeric(12, 0) not null check (threshold_amount >= 0),
  online_sales_amount numeric(12, 0) not null check (online_sales_amount >= 0),
  offline_sales_amount numeric(12, 0) not null check (offline_sales_amount >= 0),
  sales_amount numeric(12, 0) not null check (sales_amount >= 0),
  has_zero_sales boolean not null,
  meets_quarter_threshold boolean not null,
  created_at timestamptz not null default now(),
  unique (application_id, quarter_start)
);

create table if not exists public.professional_award_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  membership_id uuid not null references public.professional_memberships(id) on delete restrict,
  assessment_year integer not null check (assessment_year between 2020 and 2200),
  student_name text not null check (char_length(btrim(student_name)) between 1 and 100),
  completed_on date not null,
  award_number text not null check (char_length(btrim(award_number)) between 1 and 100),
  award_number_key text not null check (char_length(award_number_key) between 1 and 100),
  storage_path text not null unique check (btrim(storage_path) <> '' and storage_path !~ '^/'),
  original_name text not null check (char_length(original_name) between 1 and 255),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size integer not null check (file_size between 1 and 5242880),
  consent_acknowledged_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'void')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (award_number_key)
);

create index if not exists professional_award_evidence_owner_year_idx
  on public.professional_award_evidence (user_id, assessment_year, status, completed_on);
create index if not exists professional_award_evidence_review_idx
  on public.professional_award_evidence (assessment_year, status, created_at);

drop trigger if exists trg_professional_award_evidence_updated_at
  on public.professional_award_evidence;
create trigger trg_professional_award_evidence_updated_at
  before update on public.professional_award_evidence
  for each row execute function public.set_updated_at();

create table if not exists public.professional_evidence_entry_windows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  assessment_year integer not null check (assessment_year between 2020 and 2200),
  opened_until timestamptz not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (user_id, assessment_year)
);

create table if not exists public.professional_quarterly_notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  quarter_start date not null,
  version integer not null default 1 check (version >= 1),
  supersedes_id uuid references public.professional_quarterly_notices(id) on delete restrict,
  correction_reason text,
  snapshot jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  channel text check (channel is null or channel in ('line', 'email')),
  sent_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, quarter_start, version)
);

create index if not exists professional_quarterly_notices_delivery_idx
  on public.professional_quarterly_notices (status, quarter_start, created_at);

drop trigger if exists trg_professional_quarterly_notices_updated_at
  on public.professional_quarterly_notices;
create trigger trg_professional_quarterly_notices_updated_at
  before update on public.professional_quarterly_notices
  for each row execute function public.set_updated_at();

alter table public.professional_renewal_applications enable row level security;
alter table public.professional_renewal_quarter_snapshots enable row level security;
alter table public.professional_award_evidence enable row level security;
alter table public.professional_evidence_entry_windows enable row level security;
alter table public.professional_quarterly_notices enable row level security;

revoke all on table public.professional_renewal_applications from public, anon, authenticated;
revoke all on table public.professional_renewal_quarter_snapshots from public, anon, authenticated;
revoke all on table public.professional_award_evidence from public, anon, authenticated;
revoke all on table public.professional_evidence_entry_windows from public, anon, authenticated;
revoke all on table public.professional_quarterly_notices from public, anon, authenticated;

grant select on table public.professional_renewal_applications to authenticated;
grant select on table public.professional_renewal_quarter_snapshots to authenticated;
grant select on table public.professional_award_evidence to authenticated;
grant select on table public.professional_quarterly_notices to authenticated;

drop policy if exists "professional_renewal_applications_select_own" on public.professional_renewal_applications;
create policy "professional_renewal_applications_select_own"
  on public.professional_renewal_applications for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "professional_renewal_applications_select_admin" on public.professional_renewal_applications;
create policy "professional_renewal_applications_select_admin"
  on public.professional_renewal_applications for select to authenticated
  using (public.has_backoffice_permission('members.read'));

drop policy if exists "professional_renewal_snapshots_select_own" on public.professional_renewal_quarter_snapshots;
create policy "professional_renewal_snapshots_select_own"
  on public.professional_renewal_quarter_snapshots for select to authenticated
  using (exists (
    select 1 from public.professional_renewal_applications application
    where application.id = professional_renewal_quarter_snapshots.application_id
      and application.user_id = auth.uid()
  ));
drop policy if exists "professional_renewal_snapshots_select_admin" on public.professional_renewal_quarter_snapshots;
create policy "professional_renewal_snapshots_select_admin"
  on public.professional_renewal_quarter_snapshots for select to authenticated
  using (public.has_backoffice_permission('members.read'));

drop policy if exists "professional_award_evidence_select_own" on public.professional_award_evidence;
create policy "professional_award_evidence_select_own"
  on public.professional_award_evidence for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "professional_award_evidence_select_admin" on public.professional_award_evidence;
create policy "professional_award_evidence_select_admin"
  on public.professional_award_evidence for select to authenticated
  using (public.has_backoffice_permission('members.read'));

drop policy if exists "professional_quarterly_notices_select_own" on public.professional_quarterly_notices;
create policy "professional_quarterly_notices_select_own"
  on public.professional_quarterly_notices for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "professional_quarterly_notices_select_admin" on public.professional_quarterly_notices;
create policy "professional_quarterly_notices_select_admin"
  on public.professional_quarterly_notices for select to authenticated
  using (public.has_backoffice_permission('members.read'));

drop policy if exists "professional_renewal_evidence_objects_insert_own" on storage.objects;
create policy "professional_renewal_evidence_objects_insert_own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'professional-renewal-evidence'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and exists (
      select 1 from public.profiles profile
      where profile.id = auth.uid()
        and profile.role in ('instructor', 'distributor')
    )
  );

drop policy if exists "professional_renewal_evidence_objects_select_own" on storage.objects;
create policy "professional_renewal_evidence_objects_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'professional-renewal-evidence'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "professional_renewal_evidence_objects_select_admin" on storage.objects;
create policy "professional_renewal_evidence_objects_select_admin"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'professional-renewal-evidence'
    and public.has_backoffice_permission('members.read')
  );

drop policy if exists "professional_renewal_evidence_objects_delete_unlinked_own" on storage.objects;
create policy "professional_renewal_evidence_objects_delete_unlinked_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'professional-renewal-evidence'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (
      select 1 from public.professional_award_evidence evidence
      where evidence.storage_path = storage.objects.name
    )
  );

create or replace function public.get_professional_renewal_assessment(
  p_member_id uuid,
  p_assessment_year integer,
  p_as_of date default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with year_bounds as (
    select
      make_date(p_assessment_year, 1, 1) as year_start,
      make_date(p_assessment_year + 1, 1, 1) as year_end
  ), quarter_bounds as (
    select
      (bounds.year_start + make_interval(months => offset_month))::date as quarter_start,
      (bounds.year_start + make_interval(months => offset_month + 3))::date as quarter_end,
      (offset_month / 3 + 1)::integer as calendar_quarter
    from year_bounds bounds
    cross join unnest(array[0, 3, 6, 9]) offset_month
  ), quarter_activity as (
    select
      quarter.quarter_start,
      quarter.quarter_end,
      quarter.calendar_quarter,
      (quarter.quarter_end - quarter.quarter_start)::integer as quarter_days,
      (count(day_value) filter (where day_value <= least(
        coalesce(p_as_of, (now() at time zone 'Asia/Taipei')::date),
        (now() at time zone 'Asia/Taipei')::date
      ) and exists (
        select 1 from public.professional_memberships membership
        where membership.user_id = p_member_id
          and membership.role in ('instructor', 'distributor')
          and day_value >= membership.started_on
          and day_value < coalesce(membership.ended_on, 'infinity'::date)
      )))::integer as effective_days,
      min(day_value) filter (where day_value <= least(
        coalesce(p_as_of, (now() at time zone 'Asia/Taipei')::date),
        (now() at time zone 'Asia/Taipei')::date
      ) and exists (
        select 1 from public.professional_memberships membership
        where membership.user_id = p_member_id
          and membership.role in ('instructor', 'distributor')
          and day_value >= membership.started_on
          and day_value < coalesce(membership.ended_on, 'infinity'::date)
      )) as period_start,
      max(day_value) filter (where day_value <= least(
        coalesce(p_as_of, (now() at time zone 'Asia/Taipei')::date),
        (now() at time zone 'Asia/Taipei')::date
      ) and exists (
        select 1 from public.professional_memberships membership
        where membership.user_id = p_member_id
          and membership.role in ('instructor', 'distributor')
          and day_value >= membership.started_on
          and day_value < coalesce(membership.ended_on, 'infinity'::date)
      )) + 1 as period_end_exclusive
    from quarter_bounds quarter
    cross join lateral generate_series(
      quarter.quarter_start,
      quarter.quarter_end - 1,
      interval '1 day'
    ) generated(day_timestamp)
    cross join lateral (select generated.day_timestamp::date as day_value) day_row
    group by quarter.quarter_start, quarter.quarter_end, quarter.calendar_quarter
  ), quarter_sales as (
    select
      activity.*,
      ceil(30000::numeric * activity.effective_days / activity.quarter_days)::numeric(12, 0) as threshold_amount,
      coalesce((
        select sum(public.order_net_merchandise_amount(
          target_order.subtotal,
          target_order.discount,
          target_order.total,
          target_order.items,
          target_order.pricing_snapshot
        ))
        from public.orders target_order
        where target_order.user_id = p_member_id
          and target_order.status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered')
          and target_order.paid_at is not null
          and (target_order.paid_at at time zone 'Asia/Taipei')::date >= activity.quarter_start
          and (target_order.paid_at at time zone 'Asia/Taipei')::date < activity.quarter_end
          and exists (
            select 1 from public.professional_memberships membership
            where membership.user_id = p_member_id
              and membership.role in ('instructor', 'distributor')
              and (target_order.paid_at at time zone 'Asia/Taipei')::date >= membership.started_on
              and (target_order.paid_at at time zone 'Asia/Taipei')::date < coalesce(membership.ended_on, 'infinity'::date)
          )
      ), 0)::numeric(12, 0) as online_sales_amount,
      coalesce((
        select sum(adjustment.amount)
        from public.professional_sales_adjustments adjustment
        join public.professional_memberships membership on membership.id = adjustment.membership_id
        where membership.user_id = p_member_id
          and adjustment.quarter_start = activity.quarter_start
      ), 0)::numeric(12, 0) as offline_sales_amount
    from quarter_activity activity
  ), active_quarters as (
    select
      sales.*,
      (sales.online_sales_amount + sales.offline_sales_amount)::numeric(12, 0) as sales_amount
    from quarter_sales sales
    where sales.effective_days > 0
  ), annual as (
    select
      coalesce(sum(effective_days), 0)::integer as effective_days,
      (make_date(p_assessment_year + 1, 1, 1) - make_date(p_assessment_year, 1, 1))::integer as year_days,
      coalesce(sum(sales_amount), 0)::numeric(12, 0) as sales_amount,
      coalesce(bool_and(sales_amount >= threshold_amount), false) as quarterly_route_qualified,
      coalesce(bool_and(sales_amount > 0), false) as has_no_zero_quarter,
      count(*)::integer as active_quarter_count
    from active_quarters
  ), evidence_counts as (
    select
      count(distinct lower(regexp_replace(btrim(student_name), '\s+', '', 'g')))
        filter (where status in ('pending', 'approved'))::integer as provisional_count,
      count(distinct lower(regexp_replace(btrim(student_name), '\s+', '', 'g')))
        filter (where status = 'approved')::integer as approved_count
    from public.professional_award_evidence evidence
    where evidence.user_id = p_member_id
      and evidence.assessment_year = p_assessment_year
  )
  select jsonb_build_object(
    'member_id', p_member_id,
    'assessment_year', p_assessment_year,
    'renewal_year', p_assessment_year + 1,
    'effective_days', annual.effective_days,
    'year_days', annual.year_days,
    'annual_threshold', ceil(120000::numeric * annual.effective_days / annual.year_days)::numeric(12, 0),
    'annual_sales_amount', annual.sales_amount,
    'annual_remaining_amount', greatest(
      ceil(120000::numeric * annual.effective_days / annual.year_days) - annual.sales_amount,
      0
    )::numeric(12, 0),
    'active_quarter_count', annual.active_quarter_count,
    'quarterly_route_qualified', annual.quarterly_route_qualified,
    'has_no_zero_quarter', annual.has_no_zero_quarter,
    'annual_route_qualified', annual.active_quarter_count > 0
      and annual.has_no_zero_quarter
      and annual.sales_amount >= ceil(120000::numeric * annual.effective_days / annual.year_days),
    'a_qualified', annual.quarterly_route_qualified or (
      annual.active_quarter_count > 0
      and annual.has_no_zero_quarter
      and annual.sales_amount >= ceil(120000::numeric * annual.effective_days / annual.year_days)
    ),
    'student_provisional_count', coalesce(evidence_counts.provisional_count, 0),
    'student_approved_count', coalesce(evidence_counts.approved_count, 0),
    'quarters', coalesce((
      select jsonb_agg(jsonb_build_object(
        'quarter_start', quarter.quarter_start,
        'calendar_quarter', quarter.calendar_quarter,
        'period_start', quarter.period_start,
        'period_end_exclusive', quarter.period_end_exclusive,
        'effective_days', quarter.effective_days,
        'quarter_days', quarter.quarter_days,
        'threshold_amount', quarter.threshold_amount,
        'online_sales_amount', quarter.online_sales_amount,
        'offline_sales_amount', quarter.offline_sales_amount,
        'sales_amount', quarter.sales_amount,
        'has_zero_sales', quarter.sales_amount = 0,
        'meets_quarter_threshold', quarter.sales_amount >= quarter.threshold_amount
      ) order by quarter.quarter_start)
      from active_quarters quarter
    ), '[]'::jsonb)
  )
  from annual cross join evidence_counts;
$$;

revoke all on function public.get_professional_renewal_assessment(uuid, integer, date)
  from public, anon, authenticated;

create or replace function public.get_my_professional_renewal()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  member_id uuid := auth.uid();
  today date := (now() at time zone 'Asia/Taipei')::date;
  current_year integer := extract(year from today)::integer;
  result jsonb;
begin
  if member_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'current_year', current_year,
    'application_window_open', extract(month from today)::integer between 10 and 12,
    'current_assessment', public.get_professional_renewal_assessment(member_id, current_year),
    'current_application', (
      select to_jsonb(application)
      from public.professional_renewal_applications application
      where application.user_id = member_id
        and application.assessment_year = current_year
      limit 1
    ),
    'latest_application', (
      select to_jsonb(application)
      from public.professional_renewal_applications application
      where application.user_id = member_id
      order by application.assessment_year desc
      limit 1
    ),
    'current_evidence', coalesce((
      select jsonb_agg(to_jsonb(evidence) order by evidence.completed_on desc, evidence.created_at desc)
      from public.professional_award_evidence evidence
      where evidence.user_id = member_id
        and evidence.assessment_year >= current_year - 1
        and evidence.status <> 'void'
    ), '[]'::jsonb),
    'recent_notices', coalesce((
      select jsonb_agg(to_jsonb(notice) order by notice.quarter_start desc, notice.version desc)
      from (
        select * from public.professional_quarterly_notices
        where user_id = member_id
        order by quarter_start desc, version desc
        limit 8
      ) notice
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_my_professional_renewal() from public, anon;
grant execute on function public.get_my_professional_renewal() to authenticated;

create or replace function public.submit_professional_renewal_application()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_id uuid := auth.uid();
  today date := (now() at time zone 'Asia/Taipei')::date;
  target_assessment_year integer := extract(year from today)::integer;
  target_role text;
  target_membership public.professional_memberships%rowtype;
  existing public.professional_renewal_applications%rowtype;
  created public.professional_renewal_applications%rowtype;
begin
  if member_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if extract(month from today)::integer not between 10 and 12 then
    raise exception 'Renewal applications are open from October 1 through December 31' using errcode = '22023';
  end if;

  select profile.role into target_role
  from public.profiles profile
  where profile.id = member_id;
  if target_role not in ('instructor', 'distributor') then
    raise exception 'Active instructor or distributor membership required' using errcode = '42501';
  end if;

  select * into target_membership
  from public.professional_memberships membership
  where membership.user_id = member_id
    and membership.role = target_role
    and today >= membership.started_on
    and today < coalesce(membership.ended_on, 'infinity'::date)
  order by membership.started_on desc
  limit 1
  for update;
  if not found then
    raise exception 'Active professional membership not found' using errcode = 'P0002';
  end if;

  select * into existing
  from public.professional_renewal_applications application
  where application.user_id = member_id
    and application.renewal_year = target_assessment_year + 1;
  if found then
    return to_jsonb(existing);
  end if;

  insert into public.professional_renewal_applications (
    user_id, membership_id, assessment_year, renewal_year, role
  ) values (
    member_id, target_membership.id, target_assessment_year, target_assessment_year + 1, target_role
  ) returning * into created;

  return to_jsonb(created);
exception
  when unique_violation then
    select * into existing
    from public.professional_renewal_applications application
    where application.user_id = member_id
      and application.renewal_year = target_assessment_year + 1;
    return to_jsonb(existing);
end;
$$;

revoke all on function public.submit_professional_renewal_application() from public, anon;
grant execute on function public.submit_professional_renewal_application() to authenticated;

create or replace function public.save_professional_award_evidence(
  p_evidence_id uuid,
  p_student_name text,
  p_completed_on date,
  p_award_number text,
  p_storage_path text,
  p_original_name text,
  p_mime_type text,
  p_file_size integer,
  p_consent_acknowledged boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  member_id uuid := auth.uid();
  today date := (now() at time zone 'Asia/Taipei')::date;
  evidence_id uuid := p_evidence_id;
  target_year integer := extract(year from p_completed_on)::integer;
  award_key text := lower(regexp_replace(btrim(coalesce(p_award_number, '')), '\s+', '', 'g'));
  target_membership public.professional_memberships%rowtype;
  existing public.professional_award_evidence%rowtype;
  saved public.professional_award_evidence%rowtype;
  late_window_valid boolean := false;
begin
  if member_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_student_name, '')), '') is null
    or p_completed_on is null
    or p_completed_on > today
    or award_key = ''
  then
    raise exception 'Student name, completion date and award number are required' using errcode = '22023';
  end if;
  if p_consent_acknowledged is not true then
    raise exception 'Privacy acknowledgement is required' using errcode = '22023';
  end if;
  -- A new upload already has its UUID in the Storage path. Null means create;
  -- a supplied p_evidence_id means edit an existing owned pending record.
  if evidence_id is null then
    if p_storage_path is null or p_storage_path !~ (
      '^' || member_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
    ) then
      raise exception 'Invalid award image path' using errcode = '22023';
    end if;
    evidence_id := split_part(p_storage_path, '/', 2)::uuid;
  end if;
  if p_storage_path !~ ('^' || member_id::text || '/' || evidence_id::text || '/[^/]+$')
    or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_file_size is null or p_file_size not between 1 and 5242880
    or nullif(btrim(coalesce(p_original_name, '')), '') is null
    or not exists (
      select 1 from storage.objects object
      where object.bucket_id = 'professional-renewal-evidence'
        and object.name = p_storage_path
    )
  then
    raise exception 'Invalid award image metadata' using errcode = '22023';
  end if;

  select exists (
    select 1 from public.professional_evidence_entry_windows entry_window
    where entry_window.user_id = member_id
      and entry_window.assessment_year = target_year
      and entry_window.opened_until >= now()
  ) into late_window_valid;

  if target_year <> extract(year from today)::integer and not late_window_valid then
    raise exception 'Evidence entry for this year is closed' using errcode = '22023';
  end if;

  select * into target_membership
  from public.professional_memberships membership
  where membership.user_id = member_id
    and membership.role in ('instructor', 'distributor')
    and p_completed_on >= membership.started_on
    and p_completed_on < coalesce(membership.ended_on, 'infinity'::date)
  order by membership.started_on desc
  limit 1;
  if not found then
    raise exception 'The completion date is outside the professional membership period' using errcode = '22023';
  end if;

  if p_evidence_id is not null then
    select * into existing
    from public.professional_award_evidence evidence
    where evidence.id = p_evidence_id
      and evidence.user_id = member_id
    for update;
    if not found then
      raise exception 'Award evidence not found' using errcode = 'P0002';
    end if;
    if existing.status <> 'pending' then
      raise exception 'Only pending evidence can be edited' using errcode = '42501';
    end if;
  end if;

  insert into public.professional_award_evidence as target_evidence (
    id, user_id, membership_id, assessment_year, student_name, completed_on,
    award_number, award_number_key, storage_path, original_name, mime_type,
    file_size, consent_acknowledged_at
  ) values (
    evidence_id, member_id, target_membership.id, target_year, btrim(p_student_name), p_completed_on,
    btrim(p_award_number), award_key, p_storage_path, left(btrim(p_original_name), 255), p_mime_type,
    p_file_size, now()
  )
  on conflict (id) do update set
    membership_id = excluded.membership_id,
    assessment_year = excluded.assessment_year,
    student_name = excluded.student_name,
    completed_on = excluded.completed_on,
    award_number = excluded.award_number,
    award_number_key = excluded.award_number_key,
    storage_path = excluded.storage_path,
    original_name = excluded.original_name,
    mime_type = excluded.mime_type,
    file_size = excluded.file_size,
    consent_acknowledged_at = excluded.consent_acknowledged_at
  where p_evidence_id is not null
    and target_evidence.user_id = member_id
    and target_evidence.status = 'pending'
  returning * into saved;

  if not found then
    raise exception 'Award evidence already exists or cannot be edited' using errcode = '23505';
  end if;

  return to_jsonb(saved);
end;
$$;

revoke all on function public.save_professional_award_evidence(
  uuid, text, date, text, text, text, text, integer, boolean
) from public, anon;
grant execute on function public.save_professional_award_evidence(
  uuid, text, date, text, text, text, text, integer, boolean
) to authenticated;

create or replace function public.delete_professional_award_evidence(p_evidence_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.professional_award_evidence%rowtype;
begin
  select * into target
  from public.professional_award_evidence evidence
  where evidence.id = p_evidence_id
    and evidence.user_id = auth.uid()
  for update;
  if not found then
    raise exception 'Award evidence not found' using errcode = 'P0002';
  end if;
  if target.status <> 'pending' then
    raise exception 'Only pending evidence can be deleted' using errcode = '42501';
  end if;
  delete from public.professional_award_evidence where id = target.id;
  return target.storage_path;
end;
$$;

revoke all on function public.delete_professional_award_evidence(uuid) from public, anon;
grant execute on function public.delete_professional_award_evidence(uuid) to authenticated;

create or replace function public.review_professional_award_evidence(
  p_evidence_id uuid,
  p_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.professional_award_evidence%rowtype;
begin
  if not public.has_backoffice_permission('members.write') then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  if p_status not in ('approved', 'rejected') then
    raise exception 'Invalid evidence review status' using errcode = '22023';
  end if;
  if p_status = 'rejected' and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A rejection reason is required' using errcode = '22023';
  end if;

  select * into target
  from public.professional_award_evidence evidence
  where evidence.id = p_evidence_id
  for update;
  if not found then
    raise exception 'Award evidence not found' using errcode = 'P0002';
  end if;

  update public.professional_award_evidence
  set status = p_status,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = target.id;

  perform public.record_professional_sales_audit(
    'professional_award_evidence.reviewed',
    'professional_award_evidence',
    target.id::text,
    jsonb_build_object('status', target.status),
    jsonb_build_object('status', p_status, 'reason', nullif(btrim(coalesce(p_reason, '')), ''))
  );

  return jsonb_build_object('id', target.id, 'status', p_status);
end;
$$;

revoke all on function public.review_professional_award_evidence(uuid, text, text) from public, anon;
grant execute on function public.review_professional_award_evidence(uuid, text, text) to authenticated;

create or replace function public.open_professional_evidence_entry_window(
  p_member_id uuid,
  p_assessment_year integer,
  p_opened_until timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved public.professional_evidence_entry_windows%rowtype;
begin
  if not public.has_backoffice_permission('members.write') then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  if p_opened_until <= now() or nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A future deadline and reason are required' using errcode = '22023';
  end if;

  insert into public.professional_evidence_entry_windows (
    user_id, assessment_year, opened_until, reason, created_by
  ) values (
    p_member_id, p_assessment_year, p_opened_until, btrim(p_reason), auth.uid()
  )
  on conflict (user_id, assessment_year) do update set
    opened_until = excluded.opened_until,
    reason = excluded.reason,
    created_by = auth.uid(),
    created_at = now()
  returning * into saved;

  perform public.record_professional_sales_audit(
    'professional_award_evidence.entry_window_opened',
    'profiles', p_member_id::text, null,
    jsonb_build_object(
      'assessment_year', p_assessment_year,
      'opened_until', p_opened_until,
      'reason', btrim(p_reason)
    )
  );

  return to_jsonb(saved);
end;
$$;

revoke all on function public.open_professional_evidence_entry_window(uuid, integer, timestamptz, text)
  from public, anon;
grant execute on function public.open_professional_evidence_entry_window(uuid, integer, timestamptz, text)
  to authenticated;

create table if not exists public.professional_renewal_nonapplications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  membership_id uuid not null references public.professional_memberships(id) on delete restrict,
  assessment_year integer not null check (assessment_year between 2020 and 2200),
  renewal_year integer not null check (renewal_year = assessment_year + 1),
  role text not null check (role in ('instructor', 'distributor')),
  reason text not null check (char_length(btrim(reason)) between 1 and 500),
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reviewed_at timestamptz not null default now(),
  effective_on date not null,
  unique (user_id, renewal_year)
);
alter table public.professional_renewal_nonapplications enable row level security;
revoke all on table public.professional_renewal_nonapplications from public, anon, authenticated;
grant select on table public.professional_renewal_nonapplications to authenticated;
drop policy if exists professional_renewal_nonapplications_select_admin on public.professional_renewal_nonapplications;
create policy professional_renewal_nonapplications_select_admin
  on public.professional_renewal_nonapplications for select to authenticated
  using (public.has_backoffice_permission('members.read'));

-- Keep the old signature as a fail-closed guard for older deployed clients/jobs.
create or replace function public.finalize_professional_renewal_year(p_assessment_year integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Bulk annual settlement is disabled. Process each member individually.' using errcode = '22023';
end;
$$;
revoke all on function public.finalize_professional_renewal_year(integer) from public, anon, authenticated, service_role;

create or replace function public.finalize_professional_renewal_application(p_application_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Taipei')::date;
  target public.professional_renewal_applications%rowtype;
  assessment jsonb;
  quarter_record jsonb;
begin
  if auth.uid() is null or not public.has_backoffice_permission('members.write') then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  select * into target from public.professional_renewal_applications application
  where application.id = p_application_id for update;
  if not found then raise exception 'Renewal application not found' using errcode = 'P0002'; end if;
  if target.assessment_year <> extract(year from today)::integer - 1 then
    raise exception 'Only the previous assessment year can be settled' using errcode = '22023';
  end if;
  if target.status <> 'submitted' then
    return jsonb_build_object('id', target.id, 'changed', false, 'status', target.status);
  end if;
  assessment := public.get_professional_renewal_assessment(target.user_id, target.assessment_year, make_date(target.assessment_year, 12, 31));
  for quarter_record in select value from jsonb_array_elements(coalesce(assessment -> 'quarters', '[]'::jsonb)) loop
    insert into public.professional_renewal_quarter_snapshots (
      application_id, quarter_start, calendar_quarter, period_start, period_end_exclusive,
      effective_days, quarter_days, threshold_amount, online_sales_amount, offline_sales_amount,
      sales_amount, has_zero_sales, meets_quarter_threshold
    ) values (
      target.id, (quarter_record ->> 'quarter_start')::date, (quarter_record ->> 'calendar_quarter')::integer,
      (quarter_record ->> 'period_start')::date, (quarter_record ->> 'period_end_exclusive')::date,
      (quarter_record ->> 'effective_days')::integer, (quarter_record ->> 'quarter_days')::integer,
      (quarter_record ->> 'threshold_amount')::numeric, (quarter_record ->> 'online_sales_amount')::numeric,
      (quarter_record ->> 'offline_sales_amount')::numeric, (quarter_record ->> 'sales_amount')::numeric,
      (quarter_record ->> 'has_zero_sales')::boolean, (quarter_record ->> 'meets_quarter_threshold')::boolean
    );
  end loop;
  update public.professional_renewal_applications
  set status = 'pending_review', finalized_at = now(), assessment_snapshot = assessment,
      a_qualified = coalesce((assessment ->> 'a_qualified')::boolean, false),
      b_approved_count = coalesce((assessment ->> 'student_approved_count')::integer, 0)
  where id = target.id;
  perform public.record_professional_sales_audit(
    'professional_renewals.member_finalized', 'professional_renewal_applications', target.id::text,
    jsonb_build_object('status', target.status),
    jsonb_build_object('status', 'pending_review', 'assessment_year', target.assessment_year)
  );
  return jsonb_build_object('id', target.id, 'changed', true, 'status', 'pending_review');
end;
$$;
revoke all on function public.finalize_professional_renewal_application(uuid) from public, anon;
grant execute on function public.finalize_professional_renewal_application(uuid) to authenticated;

create or replace function public.downgrade_professional_renewal_nonapplicant(
  p_member_id uuid, p_renewal_year integer, p_reason text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Taipei')::date;
  renewal_start date;
  target_profile public.profiles%rowtype;
  target_membership public.professional_memberships%rowtype;
  saved public.professional_renewal_nonapplications%rowtype;
begin
  if auth.uid() is null or not public.has_backoffice_permission('members.write') then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  if p_renewal_year is null or p_renewal_year <> extract(year from today)::integer then
    raise exception 'Only overdue nonapplicants for the current renewal year can be downgraded' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 1 and 500 then
    raise exception 'A downgrade reason of 1 to 500 characters is required' using errcode = '22023';
  end if;
  renewal_start := make_date(p_renewal_year, 1, 1);
  -- Same member lock as normal backoffice role changes. Submit locks the
  -- membership too; recheck applications only after acquiring that lock.
  select * into target_profile from public.profiles where id = p_member_id for update;
  if not found then raise exception 'Member not found' using errcode = 'P0002'; end if;
  select * into saved from public.professional_renewal_nonapplications result
  where result.user_id = p_member_id and result.renewal_year = p_renewal_year;
  if found then return jsonb_build_object('id', saved.id, 'changed', false); end if;
  select * into target_membership from public.professional_memberships membership
  where membership.user_id = p_member_id and membership.role = target_profile.role
    and membership.role in ('instructor', 'distributor')
    and membership.started_on < renewal_start and membership.ended_on is null
  order by membership.started_on desc limit 1 for update;
  if not found then raise exception 'Member qualification has changed; refresh the roster' using errcode = '22023'; end if;
  if exists (select 1 from public.professional_renewal_applications application
    where application.user_id = p_member_id and application.renewal_year = p_renewal_year) then
    raise exception 'Member has a renewal application; use application review instead' using errcode = '22023';
  end if;
  -- Benefits remain until manual handling. Do not backdate to January 1.
  update public.professional_memberships set ended_on = today where id = target_membership.id;
  perform set_config('app.eclado_allow_profile_security_update', 'true', true);
  update public.profiles set role = 'pro' where id = p_member_id;
  perform set_config('app.eclado_allow_profile_security_update', 'false', true);
  insert into public.professional_renewal_nonapplications (
    user_id, membership_id, assessment_year, renewal_year, role, reason, reviewed_by, effective_on
  ) values (
    p_member_id, target_membership.id, p_renewal_year - 1, p_renewal_year,
    target_membership.role, btrim(p_reason), auth.uid(), today
  ) returning * into saved;
  perform public.record_professional_sales_audit(
    'professional_renewals.not_applied_downgraded', 'profiles', p_member_id::text,
    jsonb_build_object('role', target_membership.role, 'membership_id', target_membership.id),
    jsonb_build_object('role', 'pro', 'renewal_year', p_renewal_year, 'effective_on', today, 'reason', btrim(p_reason))
  );
  return jsonb_build_object('id', saved.id, 'changed', true, 'role', 'pro');
end;
$$;
revoke all on function public.downgrade_professional_renewal_nonapplicant(uuid, integer, text) from public, anon;
grant execute on function public.downgrade_professional_renewal_nonapplicant(uuid, integer, text) to authenticated;

create or replace function public.get_admin_professional_renewal_roster(p_renewal_year integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  roster_rows jsonb;
  today date := (now() at time zone 'Asia/Taipei')::date;
  renewal_start date;
  current_instructors integer;
  current_distributors integer;
begin
  if not public.has_backoffice_permission('members.read') then
    raise exception 'Member read access required' using errcode = '42501';
  end if;
  if p_renewal_year is null or p_renewal_year not between 2021 and extract(year from today)::integer + 1 then
    raise exception 'Invalid renewal year' using errcode = '22023';
  end if;
  renewal_start := make_date(p_renewal_year, 1, 1);
  select count(*) filter (where role = 'instructor'), count(*) filter (where role = 'distributor')
    into current_instructors, current_distributors from public.profiles;
  with cohort as (
    select membership.user_id from public.professional_memberships membership
    where membership.role in ('instructor', 'distributor')
      and membership.started_on < renewal_start and membership.started_on <= today
      and coalesce(membership.ended_on, 'infinity'::date) >= renewal_start
    union
    select application.user_id from public.professional_renewal_applications application where application.renewal_year = p_renewal_year
    union
    select result.user_id from public.professional_renewal_nonapplications result where result.renewal_year = p_renewal_year
  ), entries as (
    select profile.*, application.id as application_id, application.status as application_status,
      application.role as application_role, application.submitted_at, application.finalized_at,
      application.assessment_snapshot, application.b_approved_count,
      application.decision_reason, application.reviewed_at as application_reviewed_at,
      membership.id as source_membership_id, membership.role as source_role,
      result.id as resolution_id, result.role as resolution_role, result.reason as resolution_reason,
      result.reviewed_at as resolution_reviewed_at, result.effective_on,
      case when application.id is not null then application.status
        when result.id is not null then 'not_applied_downgraded'
        when not exists (select 1 from public.professional_memberships active_membership
          where active_membership.user_id = profile.id and active_membership.role = profile.role
            and active_membership.role in ('instructor', 'distributor')
            and active_membership.started_on < renewal_start and active_membership.ended_on is null) then 'qualification_changed'
        when today >= renewal_start then 'overdue'
        else 'not_applied' end as roster_status,
      exists (select 1 from public.professional_memberships active_membership
        where active_membership.user_id = profile.id and active_membership.role = profile.role
          and active_membership.role in ('instructor', 'distributor')
          and active_membership.started_on < renewal_start and active_membership.ended_on is null) as has_eligible_active_membership
    from cohort join public.profiles profile on profile.id = cohort.user_id
    left join public.professional_renewal_applications application on application.user_id = profile.id and application.renewal_year = p_renewal_year
    left join public.professional_renewal_nonapplications result on result.user_id = profile.id and result.renewal_year = p_renewal_year
    left join lateral (
      select history.id, history.role from public.professional_memberships history
      where history.user_id = profile.id and history.started_on < renewal_start
        and coalesce(history.ended_on, 'infinity'::date) >= renewal_start
      order by history.started_on desc limit 1
    ) membership on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', coalesce(entry.application_id::text, p_renewal_year::text || ':' || entry.id::text),
    'application_id', entry.application_id, 'user_id', entry.id,
    'member_name', entry.name, 'member_email', entry.email, 'member_role', entry.role,
    'role', coalesce(entry.application_role, entry.resolution_role, entry.source_role),
    'assessment_year', p_renewal_year - 1, 'renewal_year', p_renewal_year,
    'status', entry.roster_status, 'submitted_at', entry.submitted_at, 'finalized_at', entry.finalized_at,
    'assessment', coalesce(entry.assessment_snapshot, public.get_professional_renewal_assessment(entry.id, p_renewal_year - 1)),
    'b_approved_count', (select count(distinct lower(regexp_replace(btrim(evidence.student_name), '\s+', '', 'g')))
      from public.professional_award_evidence evidence where evidence.user_id = entry.id
        and evidence.assessment_year = p_renewal_year - 1 and evidence.status = 'approved'),
    'decision_reason', coalesce(entry.decision_reason, entry.resolution_reason),
    'reviewed_at', coalesce(entry.application_reviewed_at, entry.resolution_reviewed_at), 'effective_on', entry.effective_on,
    'can_finalize', entry.application_status = 'submitted' and p_renewal_year = extract(year from today)::integer,
    'can_downgrade', entry.application_id is null and entry.resolution_id is null
      and entry.has_eligible_active_membership and p_renewal_year = extract(year from today)::integer,
    'evidence', coalesce((select jsonb_agg(to_jsonb(evidence) order by evidence.completed_on, evidence.created_at)
      from public.professional_award_evidence evidence where evidence.user_id = entry.id
        and evidence.assessment_year = p_renewal_year - 1 and evidence.status <> 'void'), '[]'::jsonb),
    'recent_notices', coalesce((select jsonb_agg(to_jsonb(notice) order by notice.quarter_start desc, notice.version desc)
      from (select * from public.professional_quarterly_notices notice where notice.user_id = entry.id
        order by notice.quarter_start desc, notice.version desc limit 8) notice), '[]'::jsonb)
  ) order by entry.name, entry.id), '[]'::jsonb) into roster_rows from entries entry;
  return jsonb_build_object(
    'renewal_year', p_renewal_year, 'rows', roster_rows,
    'current_instructors', current_instructors, 'current_distributors', current_distributors,
    'eligible_count', jsonb_array_length(roster_rows),
    'submitted_count', (select count(*) from jsonb_array_elements(roster_rows) item where item ->> 'application_id' is not null),
    'not_submitted_count', (select count(*) from jsonb_array_elements(roster_rows) item where item ->> 'application_id' is null),
    'unprocessed_count', (select count(*) from jsonb_array_elements(roster_rows) item where item ->> 'status' in ('submitted', 'pending_review', 'not_applied', 'overdue'))
  );
end;
$$;
revoke all on function public.get_admin_professional_renewal_roster(integer) from public, anon;
grant execute on function public.get_admin_professional_renewal_roster(integer) to authenticated;

create or replace function public.review_professional_renewal_application(
  p_application_id uuid,
  p_decision text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.professional_renewal_applications%rowtype;
  renewal_start date;
  approved_evidence_count integer;
  path text;
  existing_renewal_membership uuid;
begin
  if not public.has_backoffice_permission('members.write') then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid renewal decision' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A review reason is required' using errcode = '22023';
  end if;

  select * into target
  from public.professional_renewal_applications application
  where application.id = p_application_id
  for update;
  if not found then
    raise exception 'Renewal application not found' using errcode = 'P0002';
  end if;
  if target.status <> 'pending_review' or target.finalized_at is null then
    raise exception 'Renewal application is not ready for review' using errcode = '22023';
  end if;

  renewal_start := make_date(target.renewal_year, 1, 1);
  if (now() at time zone 'Asia/Taipei')::date < renewal_start then
    raise exception 'Renewal cannot be reviewed before the renewal year' using errcode = '22023';
  end if;

  perform 1 from public.profiles profile
  where profile.id = target.user_id and profile.role = target.role for update;
  if not found then
    raise exception 'Member qualification has changed; refresh and verify membership history' using errcode = '22023';
  end if;
  perform 1 from public.professional_memberships membership
  where membership.user_id = target.user_id and membership.role = target.role
    and membership.started_on < renewal_start and membership.ended_on is null for update;
  if not found then
    raise exception 'Member qualification has changed; refresh and verify membership history' using errcode = '22023';
  end if;

  select count(distinct lower(regexp_replace(btrim(evidence.student_name), '\s+', '', 'g')))::integer
    into approved_evidence_count
  from public.professional_award_evidence evidence
  where evidence.user_id = target.user_id
    and evidence.assessment_year = target.assessment_year
    and evidence.status = 'approved';

  if p_decision = 'approved' then
    if target.a_qualified is true then
      path := case
        when coalesce((target.assessment_snapshot ->> 'quarterly_route_qualified')::boolean, false)
          then 'a_quarterly'
        else 'a_annual'
      end;
    elsif approved_evidence_count >= 8 then
      path := 'b_manual';
    else
      raise exception 'Neither renewal condition A nor B has been confirmed' using errcode = '22023';
    end if;
  end if;

  perform set_config('app.eclado_allow_profile_security_update', 'true', true);
  if p_decision = 'approved' then
    update public.professional_memberships
    set ended_on = renewal_start
    where user_id = target.user_id
      and role in ('instructor', 'distributor')
      and started_on < renewal_start
      and (ended_on is null or ended_on > renewal_start);

    select membership.id into existing_renewal_membership
    from public.professional_memberships membership
    where membership.user_id = target.user_id
      and membership.started_on = renewal_start
      and membership.role = target.role
    limit 1;

    if existing_renewal_membership is null then
      insert into public.professional_memberships (
        user_id, role, started_on, change_reason, created_by
      ) values (
        target.user_id, target.role, renewal_start,
        'annual_renewal_' || path, auth.uid()
      ) returning id into existing_renewal_membership;
    else
      update public.professional_memberships
      set ended_on = null,
          change_reason = 'annual_renewal_' || path
      where id = existing_renewal_membership;
    end if;

    update public.profiles set role = target.role where id = target.user_id;
  else
    update public.professional_memberships
    set ended_on = (now() at time zone 'Asia/Taipei')::date
    where user_id = target.user_id
      and role in ('instructor', 'distributor')
      and started_on < renewal_start
      and (ended_on is null or ended_on > renewal_start);
    update public.profiles set role = 'pro' where id = target.user_id;
  end if;
  perform set_config('app.eclado_allow_profile_security_update', 'false', true);

  update public.professional_renewal_applications
  set status = p_decision,
      qualification_path = path,
      b_approved_count = approved_evidence_count,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      decision_reason = btrim(p_reason),
      result_notification_sent_at = null,
      result_notification_channel = null,
      result_notification_error = null
  where id = target.id;

  perform public.record_professional_sales_audit(
    'professional_renewals.reviewed',
    'professional_renewal_applications', target.id::text,
    jsonb_build_object('status', target.status, 'role', target.role),
    jsonb_build_object(
      'status', p_decision,
      'qualification_path', path,
      'b_approved_count', approved_evidence_count,
      'reason', btrim(p_reason)
    )
  );

  return jsonb_build_object(
    'id', target.id,
    'status', p_decision,
    'qualification_path', path,
    'b_approved_count', approved_evidence_count,
    'membership_id', existing_renewal_membership
  );
end;
$$;

revoke all on function public.review_professional_renewal_application(uuid, text, text)
  from public, anon;
grant execute on function public.review_professional_renewal_application(uuid, text, text)
  to authenticated;

create or replace function public.get_admin_professional_renewals()
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', application.id,
    'user_id', application.user_id,
    'member_name', profile.name,
    'member_email', profile.email,
    'member_role', profile.role,
    'membership_id', application.membership_id,
    'assessment_year', application.assessment_year,
    'renewal_year', application.renewal_year,
    'role', application.role,
    'status', application.status,
    'submitted_at', application.submitted_at,
    'finalized_at', application.finalized_at,
    'assessment', coalesce(
      application.assessment_snapshot,
      public.get_professional_renewal_assessment(application.user_id, application.assessment_year)
    ),
    'a_qualified', application.a_qualified,
    'qualification_path', application.qualification_path,
    'b_approved_count', application.b_approved_count,
    'reviewed_at', application.reviewed_at,
    'decision_reason', application.decision_reason,
    'result_notification_sent_at', application.result_notification_sent_at,
    'result_notification_channel', application.result_notification_channel,
    'result_notification_error', application.result_notification_error,
    'evidence', coalesce((
      select jsonb_agg(to_jsonb(evidence) order by evidence.completed_on, evidence.created_at)
      from public.professional_award_evidence evidence
      where evidence.user_id = application.user_id
        and evidence.assessment_year = application.assessment_year
        and evidence.status <> 'void'
    ), '[]'::jsonb),
    'recent_notices', coalesce((
      select jsonb_agg(to_jsonb(notice) order by notice.quarter_start desc, notice.version desc)
      from (
        select * from public.professional_quarterly_notices
        where user_id = application.user_id
        order by quarter_start desc, version desc
        limit 8
      ) notice
    ), '[]'::jsonb)
  )
  from public.professional_renewal_applications application
  join public.profiles profile on profile.id = application.user_id
  where public.has_backoffice_permission('members.read')
  order by application.renewal_year desc, application.submitted_at;
$$;

revoke all on function public.get_admin_professional_renewals() from public, anon;
grant execute on function public.get_admin_professional_renewals() to authenticated;

create or replace function public.get_admin_professional_quarterly_notices()
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', notice.id,
    'user_id', notice.user_id,
    'member_name', profile.name,
    'member_email', profile.email,
    'quarter_start', notice.quarter_start,
    'version', notice.version,
    'supersedes_id', notice.supersedes_id,
    'correction_reason', notice.correction_reason,
    'snapshot', notice.snapshot,
    'status', notice.status,
    'channel', notice.channel,
    'sent_at', notice.sent_at,
    'attempt_count', notice.attempt_count,
    'last_error', notice.last_error,
    'created_at', notice.created_at
  )
  from public.professional_quarterly_notices notice
  join public.profiles profile on profile.id = notice.user_id
  where public.has_backoffice_permission('members.read')
  order by notice.quarter_start desc, notice.user_id, notice.version desc
  limit 500;
$$;

revoke all on function public.get_admin_professional_quarterly_notices() from public, anon;
grant execute on function public.get_admin_professional_quarterly_notices() to authenticated;

create or replace function public.prepare_professional_quarterly_notices(p_quarter_start date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_start date := date_trunc('quarter', p_quarter_start::timestamp)::date;
  quarter_end date := (normalized_start + interval '3 months')::date;
  assessment_year integer := extract(year from normalized_start)::integer;
  target record;
  assessment jsonb;
  notice_quarter jsonb;
  inserted_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role'
    and not public.has_backoffice_permission('members.write')
  then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  if normalized_start <> p_quarter_start
    or quarter_end > (now() at time zone 'Asia/Taipei')::date
  then
    raise exception 'Only completed calendar quarters can be prepared' using errcode = '22023';
  end if;

  for target in
    select distinct membership.user_id
    from public.professional_memberships membership
    where membership.role in ('instructor', 'distributor')
      and membership.started_on < quarter_end
      and coalesce(membership.ended_on, 'infinity'::date) > normalized_start
  loop
    assessment := public.get_professional_renewal_assessment(target.user_id, assessment_year, quarter_end - 1);
    select value into notice_quarter
    from jsonb_array_elements(coalesce(assessment -> 'quarters', '[]'::jsonb))
    where (value ->> 'quarter_start')::date = normalized_start
    limit 1;

    if notice_quarter is not null then
      insert into public.professional_quarterly_notices (
        user_id, quarter_start, version, snapshot
      ) values (
        target.user_id,
        normalized_start,
        1,
        assessment || jsonb_build_object(
          'notice_quarter', notice_quarter,
          'data_cutoff', quarter_end - 1,
          'generated_at', now()
        )
      )
      on conflict (user_id, quarter_start, version) do nothing;
      if found then inserted_count := inserted_count + 1; end if;
    end if;
  end loop;

  return jsonb_build_object(
    'quarter_start', normalized_start,
    'inserted_count', inserted_count
  );
end;
$$;

revoke all on function public.prepare_professional_quarterly_notices(date) from public, anon;
grant execute on function public.prepare_professional_quarterly_notices(date) to authenticated, service_role;

create or replace function public.claim_professional_quarterly_notices(p_limit integer default 100)
returns setof public.professional_quarterly_notices
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;

  return query
  with candidates as (
    select notice.id
    from public.professional_quarterly_notices notice
    where (
      notice.status in ('pending', 'failed')
      or (notice.status = 'sending' and notice.updated_at < now() - interval '15 minutes')
    )
      and not exists (
        select 1
        from public.professional_quarterly_notices newer
        where newer.user_id = notice.user_id
          and newer.quarter_start = notice.quarter_start
          and newer.version > notice.version
      )
    order by notice.created_at
    limit greatest(1, least(coalesce(p_limit, 100), 100))
    for update skip locked
  )
  update public.professional_quarterly_notices notice
  set status = 'sending',
      attempt_count = notice.attempt_count + 1,
      last_error = null
  from candidates
  where notice.id = candidates.id
  returning notice.*;
end;
$$;

revoke all on function public.claim_professional_quarterly_notices(integer) from public, anon, authenticated;
grant execute on function public.claim_professional_quarterly_notices(integer) to service_role;

create or replace function public.create_professional_quarterly_notice_correction(
  p_member_id uuid,
  p_quarter_start date,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  assessment jsonb;
  notice_quarter jsonb;
  latest public.professional_quarterly_notices%rowtype;
  created public.professional_quarterly_notices%rowtype;
  assessment_year integer := extract(year from p_quarter_start)::integer;
begin
  if not public.has_backoffice_permission('members.write') then
    raise exception 'Member write access required' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A correction reason is required' using errcode = '22023';
  end if;

  select * into latest
  from public.professional_quarterly_notices notice
  where notice.user_id = p_member_id
    and notice.quarter_start = p_quarter_start
  order by notice.version desc
  limit 1
  for update;
  if not found then
    raise exception 'Original quarterly notice not found' using errcode = 'P0002';
  end if;

  assessment := public.get_professional_renewal_assessment(
    p_member_id,
    assessment_year,
    (p_quarter_start + interval '3 months')::date - 1
  );
  select value into notice_quarter
  from jsonb_array_elements(coalesce(assessment -> 'quarters', '[]'::jsonb))
  where (value ->> 'quarter_start')::date = p_quarter_start
  limit 1;
  if notice_quarter is null then
    raise exception 'Quarter assessment not found' using errcode = 'P0002';
  end if;

  insert into public.professional_quarterly_notices (
    user_id, quarter_start, version, supersedes_id, correction_reason, snapshot
  ) values (
    p_member_id, p_quarter_start, latest.version + 1, latest.id, btrim(p_reason),
    assessment || jsonb_build_object(
      'notice_quarter', notice_quarter,
      'data_cutoff', (p_quarter_start + interval '3 months')::date - 1,
      'generated_at', now()
    )
  ) returning * into created;

  perform public.record_professional_sales_audit(
    'professional_quarterly_notices.correction_created',
    'professional_quarterly_notices', created.id::text,
    jsonb_build_object('supersedes_id', latest.id, 'version', latest.version),
    jsonb_build_object('version', created.version, 'reason', btrim(p_reason))
  );

  return to_jsonb(created);
end;
$$;

revoke all on function public.create_professional_quarterly_notice_correction(uuid, date, text)
  from public, anon;
grant execute on function public.create_professional_quarterly_notice_correction(uuid, date, text)
  to authenticated;

comment on table public.professional_renewal_applications is
  'Annual instructor/distributor renewal submissions and immutable final assessment snapshots.';
comment on table public.professional_award_evidence is
  'Private brand-program award evidence. Counts are provisional until backoffice review.';
comment on table public.professional_quarterly_notices is
  'Versioned quarterly settlement notification snapshots and delivery state.';

commit;

notify pgrst, 'reload schema';
