-- Run after supabase-professional-renewals.sql. Annual renewal is now manual.
-- Quarterly notifications remain scheduled; no automatic settlement/downgrade.
begin;

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

commit;
notify pgrst, 'reload schema';
