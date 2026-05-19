-- ============================================================================
-- 修復既有 Supabase 專案的 professional_applications（請在 SQL Editor 執行一次）
-- 問題：RLS 阻擋寫入、缺少 source 欄位
-- ============================================================================

-- 補欄位（若表已存在但欄位不全）
alter table public.professional_applications
  add column if not exists source text default 'standalone';

alter table public.professional_applications
  add column if not exists updated_at timestamptz default now();

-- 若 source 已存在但無 NOT NULL，補預設
update public.professional_applications set source = 'standalone' where source is null;
alter table public.professional_applications
  alter column source set default 'standalone';

-- updated_at 觸發器（需 set_updated_at 函數，full-setup 專案通常已有）
drop trigger if exists trg_professional_applications_updated_at on public.professional_applications;
create trigger trg_professional_applications_updated_at
  before update on public.professional_applications
  for each row execute function public.set_updated_at();

-- RLS：與 orders / profiles 相同，開放 anon 讀寫（目前前台與後台皆用 anon key）
alter table public.professional_applications enable row level security;

drop policy if exists "professional_applications_select_all" on public.professional_applications;
create policy "professional_applications_select_all"
  on public.professional_applications for select using (true);

drop policy if exists "professional_applications_insert_all" on public.professional_applications;
create policy "professional_applications_insert_all"
  on public.professional_applications for insert with check (true);

drop policy if exists "professional_applications_update_all" on public.professional_applications;
create policy "professional_applications_update_all"
  on public.professional_applications for update using (true) with check (true);

-- 若曾有只允許 authenticated 的舊 policy，一併移除常見名稱
drop policy if exists "Enable read access for all users" on public.professional_applications;
drop policy if exists "Enable insert for authenticated users only" on public.professional_applications;
drop policy if exists "Enable update for users based on email" on public.professional_applications;

do $$
begin
  alter publication supabase_realtime add table public.professional_applications;
exception when duplicate_object then null;
end $$;
