-- ============================================================================
-- DEPRECATED NAME: promotions RLS security migration
-- ============================================================================
-- 後台現在使用 Supabase Auth 正式登入。本檔保留舊檔名相容性，但不再允許
-- anon 寫入；新部署請優先執行 supabase-promotions-secure-rls.sql。
-- ============================================================================

create or replace function public.is_eclado_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users
    where user_id = auth.uid() and active = true
  );
$$;

revoke all on function public.is_eclado_admin() from public;
grant execute on function public.is_eclado_admin() to authenticated;

alter table public.promotions enable row level security;

-- 一般使用者只讀目前有效活動；管理員可讀包含草稿與排程在內的全部活動
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

-- insert / update / delete：只有已登入且列入允許名單的管理員可操作
drop policy if exists "promotions_insert_auth" on public.promotions;
drop policy if exists "promotions_update_auth" on public.promotions;
drop policy if exists "promotions_delete_auth" on public.promotions;

drop policy if exists "promotions_insert_all" on public.promotions;
drop policy if exists "promotions_insert_admin" on public.promotions;
create policy "promotions_insert_admin"
  on public.promotions for insert
  to authenticated
  with check (public.is_eclado_admin());

drop policy if exists "promotions_update_all" on public.promotions;
drop policy if exists "promotions_update_admin" on public.promotions;
create policy "promotions_update_admin"
  on public.promotions for update
  to authenticated
  using (public.is_eclado_admin())
  with check (public.is_eclado_admin());

drop policy if exists "promotions_delete_all" on public.promotions;
drop policy if exists "promotions_delete_admin" on public.promotions;
create policy "promotions_delete_admin"
  on public.promotions for delete
  to authenticated
  using (public.is_eclado_admin());
