-- Independent announcement copy; no promotion/pricing rules are changed.
begin;
create table if not exists public.site_announcement (
  id boolean primary key default true check (id),
  content text not null default '' check (char_length(content) <= 200),
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint site_announcement_enabled_content_check check (not enabled or content ~ '[^[:space:]]')
);
insert into public.site_announcement(id) values(true) on conflict do nothing;
alter table public.site_announcement enable row level security;
revoke all on table public.site_announcement from public, anon, authenticated;
grant select on table public.site_announcement to anon, authenticated;
drop policy if exists site_announcement_read on public.site_announcement;
create policy site_announcement_read on public.site_announcement for select to anon, authenticated using (true);

create or replace function public.save_site_announcement(p_content text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.site_announcement%rowtype;
begin
  if not coalesce(public.has_backoffice_permission('promotions.manage'),false) then
    raise exception 'Promotion management access required' using errcode='42501';
  end if;
  if p_content is null or char_length(p_content) > 200 or p_enabled is null
    or (p_enabled and p_content !~ '[^[:space:]]') then
    raise exception 'Announcement requires up to 200 characters; enabled content cannot be blank' using errcode='22023';
  end if;
  insert into public.site_announcement(id,content,enabled,updated_at)
    values(true,btrim(p_content),p_enabled,now())
    on conflict(id) do update set content=excluded.content,enabled=excluded.enabled,updated_at=excluded.updated_at
    returning * into saved;
  return jsonb_build_object('content',saved.content,'enabled',saved.enabled);
end;
$$;
revoke all on function public.save_site_announcement(text,boolean) from public, anon;
grant execute on function public.save_site_announcement(text,boolean) to authenticated;

-- Public content only; allow open storefronts to follow saved changes.
do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and
    not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='site_announcement') then
    alter publication supabase_realtime add table public.site_announcement;
  end if;
end;
$$;
notify pgrst, 'reload schema';
commit;
