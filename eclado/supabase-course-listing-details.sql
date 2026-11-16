begin;

alter table public.courses
  add column if not exists instructor_name text check (char_length(btrim(instructor_name)) between 1 and 120),
  add column if not exists overview text check (char_length(btrim(overview)) between 1 and 300);

drop function public.get_published_courses(uuid);
create function public.get_published_courses(p_id uuid default null)
returns table (
  id uuid, name text, description text, image_path text,
  starts_at timestamptz, ends_at timestamptz, price_twd integer,
  instructor_name text, overview text
)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.name, case when p_id is not null then c.description end,
    c.image_path, c.starts_at, c.ends_at, c.price_twd, c.instructor_name, c.overview
  from public.courses c
  where c.published and (p_id is null or c.id = p_id)
  order by c.starts_at, c.id;
$$;

create or replace function public.save_course(
  p_id uuid, p_version integer, p_name text, p_description text, p_image_path text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_price_twd integer, p_published boolean, p_zoom_url text,
  p_instructor_name text, p_overview text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  saved jsonb;
  listing public.courses%rowtype;
begin
  -- Reuse the existing permission, version, publication and meeting checks.
  saved := public.save_course(p_id, p_version, p_name, p_description, p_image_path,
    p_starts_at, p_ends_at, p_price_twd, p_published, p_zoom_url);

  update public.courses
  set instructor_name = nullif(btrim(p_instructor_name), ''),
      overview = nullif(btrim(p_overview), '')
  where id = (saved->>'id')::uuid
  returning * into listing;

  return to_jsonb(listing) || jsonb_build_object('zoom_url', saved->'zoom_url');
end;
$$;

revoke all on function public.get_published_courses(uuid),
  public.save_course(uuid, integer, text, text, text, timestamptz, timestamptz, integer, boolean, text, text, text)
  from public, anon, authenticated;
grant execute on function public.get_published_courses(uuid) to anon, authenticated;
grant execute on function
  public.save_course(uuid, integer, text, text, text, timestamptz, timestamptz, integer, boolean, text, text, text)
  to authenticated;

notify pgrst, 'reload schema';
commit;
