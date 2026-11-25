-- Apply after supabase-course-publication-schedule.sql. Existing courses stay NULL.
begin;

alter table public.courses add column if not exists slug text;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='public.courses'::regclass and conname='courses_slug_format') then
    alter table public.courses add constraint courses_slug_format check (slug is null or (
      char_length(slug) between 3 and 100
      and slug = lower(btrim(slug))
      and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
      and slug !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and slug not in ('admin','api','edit','login','new','register')
    ));
  end if;
end;
$$;
create unique index if not exists courses_slug_unique on public.courses(slug) where slug is not null;

drop function public.get_published_courses(uuid);
create function public.get_published_courses(p_id uuid default null)
returns table (
  id uuid, name text, description text, image_path text,
  starts_at timestamptz, ends_at timestamptz, price_twd integer,
  instructor_name text, overview text, publish_at timestamptz, registration_opens_at timestamptz,
  slug text
)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.name, case when p_id is not null then c.description end,
    c.image_path, c.starts_at, c.ends_at, c.price_twd, c.instructor_name, c.overview,
    c.publish_at, c.registration_opens_at, c.slug
  from public.courses c
  where c.published and (c.publish_at is null or c.publish_at <= now())
    and (p_id is null or c.id = p_id)
  order by c.starts_at, c.id;
$$;

create or replace function public.resolve_course_slug(p_slug text)
returns uuid language sql stable security definer set search_path = ''
as $$
  select c.id from public.courses c where c.slug = p_slug
    and c.published and (c.publish_at is null or c.publish_at <= now());
$$;

create or replace function public.save_course_with_slug(
  p_id uuid, p_version integer, p_name text, p_description text, p_image_path text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_price_twd integer,
  p_published boolean, p_zoom_url text, p_instructor_name text, p_overview text,
  p_publish_at timestamptz, p_registration_opens_at timestamptz, p_slug text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  saved jsonb;
  listing public.courses%rowtype;
  normalized_slug text := nullif(lower(btrim(p_slug)), '');
begin
  if auth.uid() is null or not coalesce(public.has_backoffice_permission('courses.manage'), false) then
    raise exception '課程管理權限不足' using errcode = '42501';
  end if;
  saved := public.save_scheduled_course(p_id, p_version, p_name, p_description, p_image_path,
    p_starts_at, p_ends_at, p_price_twd, p_published, p_zoom_url, p_instructor_name, p_overview,
    p_publish_at, p_registration_opens_at);
  update public.courses set slug = normalized_slug
    where id = (saved->>'id')::uuid returning * into listing;
  return to_jsonb(listing) || jsonb_build_object('zoom_url', saved->'zoom_url');
exception
  when unique_violation then
    raise exception '此課程網址代稱已被使用，請使用其他代稱' using errcode = '23505';
  when check_violation then
    if sqlerrm like '%courses_slug_format%' then
      raise exception '課程網址代稱格式不正確' using errcode = '22023';
    end if;
    raise;
end;
$$;

revoke all on function public.get_published_courses(uuid), public.resolve_course_slug(text)
  from public, anon, authenticated;
grant execute on function public.get_published_courses(uuid), public.resolve_course_slug(text) to anon, authenticated;
revoke all on function public.save_course_with_slug(
  uuid,integer,text,text,text,timestamptz,timestamptz,integer,boolean,text,text,text,timestamptz,timestamptz,text
) from public, anon, authenticated;
grant execute on function public.save_course_with_slug(
  uuid,integer,text,text,text,timestamptz,timestamptz,integer,boolean,text,text,text,timestamptz,timestamptz,text
) to authenticated;

notify pgrst, 'reload schema';
commit;
