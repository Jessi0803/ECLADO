-- Apply after supabase-site-announcement.sql. Existing copy and switch are preserved.
begin;
alter table public.site_announcement
  add column if not exists start_at timestamptz,
  add column if not exists end_at timestamptz;
alter table public.site_announcement drop constraint if exists site_announcement_schedule_check;
alter table public.site_announcement add constraint site_announcement_schedule_check check (
  (start_at is null or isfinite(start_at)) and (end_at is null or isfinite(end_at))
  and (start_at is null or end_at is null or end_at > start_at)
);

create or replace function public.save_site_announcement_schedule(
  p_content text, p_enabled boolean, p_start_at timestamptz, p_end_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.site_announcement%rowtype;
begin
  if not coalesce(public.has_backoffice_permission('promotions.manage'),false) then
    raise exception 'Promotion management access required' using errcode='42501';
  end if;
  if p_content is null or char_length(p_content) > 200 or p_enabled is null
    or (p_enabled and p_content !~ '[^[:space:]]') then
    raise exception 'Announcement requires up to 200 characters; enabled content cannot be blank' using errcode='22023';
  end if;
  if (p_start_at is not null and not isfinite(p_start_at)) or (p_end_at is not null and not isfinite(p_end_at))
    or (p_start_at is not null and p_end_at is not null and p_end_at <= p_start_at) then
    raise exception 'Announcement end time must be later than start time' using errcode='22023';
  end if;
  insert into public.site_announcement(id,content,enabled,start_at,end_at,updated_at)
    values(true,btrim(p_content),p_enabled,p_start_at,p_end_at,now())
    on conflict(id) do update set content=excluded.content,enabled=excluded.enabled,
      start_at=excluded.start_at,end_at=excluded.end_at,updated_at=excluded.updated_at
    returning * into saved;
  return jsonb_build_object('content',saved.content,'enabled',saved.enabled,'start_at',saved.start_at,'end_at',saved.end_at);
end;
$$;
revoke all on function public.save_site_announcement_schedule(text,boolean,timestamptz,timestamptz) from public, anon;
grant execute on function public.save_site_announcement_schedule(text,boolean,timestamptz,timestamptz) to authenticated;

-- Older clients can still edit the copy/switch without erasing a saved schedule.
create or replace function public.save_site_announcement(p_content text,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.site_announcement%rowtype;
begin
  if not coalesce(public.has_backoffice_permission('promotions.manage'),false) then
    raise exception 'Promotion management access required' using errcode='42501';
  end if;
  select * into saved from public.site_announcement where id=true for update;
  return public.save_site_announcement_schedule(p_content,p_enabled,saved.start_at,saved.end_at);
end;
$$;
revoke all on function public.save_site_announcement(text,boolean) from public, anon;
grant execute on function public.save_site_announcement(text,boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
