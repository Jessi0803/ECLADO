-- Fix PL/pgSQL assessment_year variable/column ambiguity in renewal submission.
-- Run after supabase-professional-renewals.sql. Does not modify existing records.
begin;

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

commit;
