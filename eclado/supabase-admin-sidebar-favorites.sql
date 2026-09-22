-- 後台導覽列「常用」：每個後台帳號各自一份，跨裝置同步。
-- 只存頁面代號（例：orders、members），實際是否顯示仍由前端依權限過濾。

create table if not exists public.admin_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sidebar_favorites text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_preferences_sidebar_favorites_check check (
    cardinality(sidebar_favorites) <= 30
    and array_to_string(sidebar_favorites, ',') ~ '^[a-z_,]*$'
  )
);

drop trigger if exists trg_admin_preferences_updated_at on public.admin_preferences;
create trigger trg_admin_preferences_updated_at
  before update on public.admin_preferences
  for each row execute function public.set_updated_at();

alter table public.admin_preferences enable row level security;
revoke all on table public.admin_preferences from anon, authenticated;
grant select, insert, update on table public.admin_preferences to authenticated;

drop policy if exists "admin_preferences_select_own" on public.admin_preferences;
create policy "admin_preferences_select_own"
  on public.admin_preferences for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "admin_preferences_insert_own" on public.admin_preferences;
create policy "admin_preferences_insert_own"
  on public.admin_preferences for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "admin_preferences_update_own" on public.admin_preferences;
create policy "admin_preferences_update_own"
  on public.admin_preferences for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.admin_preferences is
  'Per-account backoffice UI preferences such as sidebar favorites; each user can only read and write their own row.';

notify pgrst, 'reload schema';
