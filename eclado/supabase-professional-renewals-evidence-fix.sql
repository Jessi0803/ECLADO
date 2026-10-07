-- Fix new award evidence creation: null id means create using the pre-uploaded path UUID.
-- Existing records retain ownership and pending-status checks. No existing data is changed.
begin;

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

commit;
