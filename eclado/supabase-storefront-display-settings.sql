-- Presentation only. Does not change stock, preorder eligibility or order snapshots.
begin;
create table if not exists public.storefront_display_settings (
  id boolean primary key default true check (id),
  show_fulfillment boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.storefront_display_settings(id) values(true) on conflict do nothing;
alter table public.storefront_display_settings enable row level security;
revoke all on table public.storefront_display_settings from public, anon, authenticated;
grant select on table public.storefront_display_settings to anon, authenticated;
drop policy if exists storefront_display_read on public.storefront_display_settings;
create policy storefront_display_read on public.storefront_display_settings for select to anon, authenticated using (true);

create or replace function public.save_storefront_display_settings(p_show_fulfillment boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.storefront_display_settings%rowtype;
begin
  if not coalesce(public.has_backoffice_permission('member_pricing.manage'), false) then
    raise exception 'System settings management access required' using errcode='42501';
  end if;
  if p_show_fulfillment is null then
    raise exception 'Display setting must be a boolean' using errcode='22023';
  end if;
  insert into public.storefront_display_settings(id,show_fulfillment,updated_at)
    values(true,p_show_fulfillment,now())
    on conflict(id) do update set show_fulfillment=excluded.show_fulfillment,updated_at=excluded.updated_at
    returning * into saved;
  return jsonb_build_object('show_fulfillment', saved.show_fulfillment);
end;
$$;
revoke all on function public.save_storefront_display_settings(boolean) from public, anon;
grant execute on function public.save_storefront_display_settings(boolean) to authenticated;
do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and
    not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='storefront_display_settings') then
    alter publication supabase_realtime add table public.storefront_display_settings;
  end if;
end;
$$;
notify pgrst, 'reload schema';
commit;
