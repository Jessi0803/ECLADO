-- Apply after course listing details, registration, payments and description images.
begin;

alter table public.courses
  add column if not exists publish_at timestamptz,
  add column if not exists registration_opens_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.courses'::regclass and conname='courses_publication_before_class') then
    alter table public.courses add constraint courses_publication_before_class
      check (publish_at is null or (isfinite(publish_at) and publish_at < starts_at));
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.courses'::regclass and conname='courses_registration_before_class') then
    alter table public.courses add constraint courses_registration_before_class
      check (registration_opens_at is null or (
        isfinite(registration_opens_at) and registration_opens_at < starts_at
        and (publish_at is null or registration_opens_at >= publish_at)
      ));
  end if;
end;
$$;

drop function public.get_published_courses(uuid);
create function public.get_published_courses(p_id uuid default null)
returns table (
  id uuid, name text, description text, image_path text,
  starts_at timestamptz, ends_at timestamptz, price_twd integer,
  instructor_name text, overview text, publish_at timestamptz, registration_opens_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.name, case when p_id is not null then c.description end,
    c.image_path, c.starts_at, c.ends_at, c.price_twd, c.instructor_name, c.overview,
    c.publish_at, c.registration_opens_at
  from public.courses c
  where c.published and (c.publish_at is null or c.publish_at <= now())
    and (p_id is null or c.id = p_id)
  order by c.starts_at, c.id;
$$;
revoke all on function public.get_published_courses(uuid) from public,anon,authenticated;
grant execute on function public.get_published_courses(uuid) to anon,authenticated;

create or replace function public.save_scheduled_course(
  p_id uuid, p_version integer, p_name text, p_description text, p_image_path text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_price_twd integer,
  p_published boolean, p_zoom_url text, p_instructor_name text, p_overview text,
  p_publish_at timestamptz, p_registration_opens_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  saved jsonb;
  listing public.courses%rowtype;
begin
  if auth.uid() is null or not coalesce(public.has_backoffice_permission('courses.manage'), false) then
    raise exception '課程管理權限不足' using errcode = '42501';
  end if;
  if p_publish_at is not null and (not isfinite(p_publish_at) or p_publish_at >= p_starts_at) then
    raise exception '上架時間必須早於上課開始時間' using errcode = '22023';
  end if;
  if p_registration_opens_at is not null and (
    not isfinite(p_registration_opens_at) or p_registration_opens_at >= p_starts_at
    or (p_publish_at is not null and p_registration_opens_at < p_publish_at)
  ) then
    raise exception '開放報名時間須在上架時間之後，且早於上課開始時間' using errcode = '22023';
  end if;
  -- Hold the row until the original version check and all changes finish.
  -- Clear the old schedule so rescheduling both dates can pass the row constraint.
  if p_id is not null then
    update public.courses set publish_at = null, registration_opens_at = null
    where id = p_id and version = p_version;
    if not found then
      raise exception '課程已被更新，請重新載入後再編輯' using errcode = '40001';
    end if;
  end if;

  saved := public.save_course(p_id, p_version, p_name, p_description, p_image_path,
    p_starts_at, p_ends_at, p_price_twd, p_published, p_zoom_url, p_instructor_name, p_overview);
  update public.courses set publish_at = p_publish_at, registration_opens_at = p_registration_opens_at
    where id = (saved->>'id')::uuid returning * into listing;
  return to_jsonb(listing) || jsonb_build_object('zoom_url', saved->'zoom_url');
end;
$$;
revoke all on function public.save_scheduled_course(
  uuid,integer,text,text,text,timestamptz,timestamptz,integer,boolean,text,text,text,timestamptz,timestamptz
) from public,anon,authenticated;
grant execute on function public.save_scheduled_course(
  uuid,integer,text,text,text,timestamptz,timestamptz,integer,boolean,text,text,text,timestamptz,timestamptz
) to authenticated;

-- Apply the same availability condition to discovery, private images,
-- registration, payment creation and verified bank callbacks.
-- Fail atomically if an installed function has an unexpected definition.
do $migration$
declare
  signature text;
  definition text;
  needle text;
  replacement text;
begin
  foreach signature in array array[
    'public.is_published_course_image(text)',
    'public.create_course_registration(uuid,uuid,boolean,jsonb,integer)',
    'public.claim_course_payment(uuid,uuid,boolean,text)',
    'public.confirm_course_payment(text,integer,text)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position('publish_at' in definition) > 0 then continue; end if;
    if signature = 'public.is_published_course_image(text)' then
      needle := 'c.published';
      replacement := '(c.published and (c.publish_at is null or c.publish_at <= now()))';
    else
      needle := 'course.published';
      replacement := '(course.published and (course.publish_at is null or course.publish_at <= clock_timestamp()))';
    end if;
    if position(needle in definition) = 0 then
      raise exception 'Unexpected publication check in %', signature;
    end if;
    definition := replace(definition, needle, replacement);
    if signature = 'public.create_course_registration(uuid,uuid,boolean,jsonb,integer)' then
      definition := replace(definition,
        'or course.starts_at <= clock_timestamp()',
        'or course.starts_at <= clock_timestamp() or (course.registration_opens_at is not null and course.registration_opens_at > clock_timestamp())');
    end if;
    execute definition;
  end loop;
end;
$migration$;

notify pgrst, 'reload schema';
commit;
