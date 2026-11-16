begin;

-- Preserve permissions installed by other modules.
do $$
declare definition text;
begin
  select pg_get_constraintdef(oid) into definition from pg_constraint
  where conrelid = 'public.backoffice_role_permissions'::regclass
    and conname = 'backoffice_role_permissions_permission_check';
  if definition is null or definition not like 'CHECK (%)' then
    raise exception 'Expected backoffice permission whitelist is missing';
  end if;
  if position('courses.manage' in definition) = 0 then
    alter table public.backoffice_role_permissions
      drop constraint backoffice_role_permissions_permission_check;
    execute 'alter table public.backoffice_role_permissions add constraint '
      || 'backoffice_role_permissions_permission_check CHECK (permission = ''courses.manage'' OR '
      || substring(definition from 7) || ')';
  end if;
end $$;

insert into public.backoffice_role_permissions (role, permission)
values ('admin', 'courses.manage'), ('super_admin', 'courses.manage')
on conflict do nothing;

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null check (char_length(btrim(description)) between 1 and 12000),
  image_path text unique check (image_path ~ '^[0-9a-f-]{36}\.webp$'),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  price_twd integer not null check (price_twd between 0 and 9999999),
  published boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (isfinite(starts_at) and isfinite(ends_at) and ends_at > starts_at),
  check (not published or image_path is not null)
);
create index if not exists courses_public_start_idx on public.courses (starts_at, id) where published;

create table if not exists public.course_meeting_details (
  course_id uuid primary key references public.courses(id) on delete cascade,
  zoom_url text not null check (
    char_length(zoom_url) <= 2048
    and zoom_url ~* '^https://([a-z0-9-]+\.)*zoom\.(us|com)/[^[:space:]]+$'
  )
);

alter table public.courses enable row level security;
alter table public.course_meeting_details enable row level security;
revoke all on public.courses, public.course_meeting_details from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('course-images', 'course-images', false, 2097152, array['image/webp'])
on conflict (id) do nothing;

create or replace function public.is_published_course_image(p_path text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.courses c where c.published and c.image_path = p_path);
$$;
revoke all on function public.is_published_course_image(text) from public;
grant execute on function public.is_published_course_image(text) to anon, authenticated;

drop policy if exists course_images_read_published on storage.objects;
create policy course_images_read_published on storage.objects for select to anon, authenticated
using (bucket_id = 'course-images' and public.is_published_course_image(name));

drop policy if exists course_images_read_admin on storage.objects;
create policy course_images_read_admin on storage.objects for select to authenticated
using (bucket_id = 'course-images' and public.has_backoffice_permission('courses.manage'));

drop policy if exists course_images_upload_admin on storage.objects;
create policy course_images_upload_admin on storage.objects for insert to authenticated
with check (
  bucket_id = 'course-images' and name ~ '^[0-9a-f-]{36}\.webp$'
  and public.has_backoffice_permission('courses.manage')
);

create or replace function public.get_published_courses(p_id uuid default null)
returns table (
  id uuid, name text, description text, image_path text,
  starts_at timestamptz, ends_at timestamptz, price_twd integer
)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.name, case when p_id is null then left(c.description, 160) else c.description end,
    c.image_path, c.starts_at, c.ends_at, c.price_twd
  from public.courses c
  where c.published and (p_id is null or c.id = p_id)
  order by c.starts_at, c.id;
$$;

create or replace function public.get_admin_courses()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not coalesce(public.has_backoffice_permission('courses.manage'), false) then
    raise exception 'Course management permission required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(c) || jsonb_build_object('zoom_url', m.zoom_url) order by c.starts_at, c.id)
    from public.courses c left join public.course_meeting_details m on m.course_id = c.id
  ), '[]'::jsonb);
end;
$$;

create or replace function public.save_course(
  p_id uuid, p_version integer, p_name text, p_description text, p_image_path text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_price_twd integer, p_published boolean, p_zoom_url text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  saved public.courses%rowtype;
  zoom text := nullif(btrim(p_zoom_url), '');
begin
  if auth.uid() is null or not coalesce(public.has_backoffice_permission('courses.manage'), false) then
    raise exception 'Course management permission required' using errcode = '42501';
  end if;
  if p_image_path is not null and not exists (
    select 1 from storage.objects where bucket_id = 'course-images' and name = p_image_path
  ) then
    raise exception '課程圖片不存在，請重新上傳' using errcode = '22023';
  end if;
  if p_published and zoom is null then
    raise exception '上架前請填寫 Zoom 會議連結' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.courses (name, description, image_path, starts_at, ends_at, price_twd, published)
    values (btrim(p_name), btrim(p_description), p_image_path, p_starts_at, p_ends_at, p_price_twd, p_published)
    returning * into saved;
  else
    update public.courses set
      name = btrim(p_name), description = btrim(p_description), image_path = p_image_path,
      starts_at = p_starts_at, ends_at = p_ends_at, price_twd = p_price_twd, published = p_published,
      version = version + 1, updated_at = now()
    where id = p_id and version = p_version
    returning * into saved;
    if not found then
      raise exception '課程已被更新，請重新載入後再儲存' using errcode = '40001';
    end if;
  end if;
  if zoom is null then
    delete from public.course_meeting_details where course_id = saved.id;
  else
    insert into public.course_meeting_details (course_id, zoom_url) values (saved.id, zoom)
    on conflict (course_id) do update set zoom_url = excluded.zoom_url;
  end if;
  return to_jsonb(saved) || jsonb_build_object('zoom_url', zoom);
end;
$$;

revoke all on function public.get_published_courses(uuid), public.get_admin_courses(),
  public.save_course(uuid, integer, text, text, text, timestamptz, timestamptz, integer, boolean, text)
  from public, anon, authenticated;
grant execute on function public.get_published_courses(uuid) to anon, authenticated;
grant execute on function public.get_admin_courses(),
  public.save_course(uuid, integer, text, text, text, timestamptz, timestamptz, integer, boolean, text)
  to authenticated;

commit;
