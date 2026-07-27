-- ECLADO promotions RLS hardening — phase 2A
-- Run in Supabase SQL Editor after the authoritative pricing phase 1 migration.
--
-- Public storefront users may read promotions for display purposes.
-- Only signed-in ECLADO administrators may create, update or delete promotions.
-- The service_role continues to bypass RLS for trusted server-side operations.

create or replace function public.is_eclado_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = any(array[
    'baby90522@gmail.com',
    'ecladotaiwan@gmail.com',
    'k0919933386@gmail.com',
    'line.u6f71cfa36c3fb2188f54396a5cb58882@ecladotaiwan.com'
  ]);
$$;

revoke all on function public.is_eclado_admin() from public;
grant execute on function public.is_eclado_admin() to authenticated;

alter table public.promotions enable row level security;

drop policy if exists "promotions_select_all" on public.promotions;
drop policy if exists "promotions_select_live" on public.promotions;
drop policy if exists "promotions_select_admin" on public.promotions;
create policy "promotions_select_live"
  on public.promotions for select
  to anon, authenticated
  using (
    active = true
    and (start_at is null or start_at <= now())
    and (end_at is null or end_at > now())
  );

create policy "promotions_select_admin"
  on public.promotions for select
  to authenticated
  using (public.is_eclado_admin());

drop policy if exists "promotions_insert_auth" on public.promotions;
drop policy if exists "promotions_insert_all" on public.promotions;
drop policy if exists "promotions_insert_admin" on public.promotions;
create policy "promotions_insert_admin"
  on public.promotions for insert
  to authenticated
  with check (public.is_eclado_admin());

drop policy if exists "promotions_update_auth" on public.promotions;
drop policy if exists "promotions_update_all" on public.promotions;
drop policy if exists "promotions_update_admin" on public.promotions;
create policy "promotions_update_admin"
  on public.promotions for update
  to authenticated
  using (public.is_eclado_admin())
  with check (public.is_eclado_admin());

drop policy if exists "promotions_delete_auth" on public.promotions;
drop policy if exists "promotions_delete_all" on public.promotions;
drop policy if exists "promotions_delete_admin" on public.promotions;
create policy "promotions_delete_admin"
  on public.promotions for delete
  to authenticated
  using (public.is_eclado_admin());

comment on function public.is_eclado_admin() is
  'Returns true only for signed-in ECLADO administrator email addresses.';
