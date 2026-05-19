-- ============================================================================
-- 美容師專業會員申請表
-- 在 Supabase SQL Editor 執行（新專案若已跑 supabase-full-setup.sql 可只跑本檔）
-- ============================================================================

create table if not exists public.professional_applications (
  id uuid primary key default gen_random_uuid(),
  studio_name text not null,
  contact_name text not null,
  phone text not null,
  address text not null,
  social_media text not null,
  certificate text not null,
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  source text not null default 'standalone'
    check (source in ('registration', 'standalone')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_professional_applications_status
  on public.professional_applications (status, created_at desc);

alter table public.professional_applications
  add column if not exists source text not null default 'standalone';

drop trigger if exists trg_professional_applications_updated_at on public.professional_applications;
create trigger trg_professional_applications_updated_at
  before update on public.professional_applications
  for each row execute function public.set_updated_at();

alter table public.professional_applications enable row level security;

drop policy if exists "professional_applications_select_all" on public.professional_applications;
create policy "professional_applications_select_all"
  on public.professional_applications for select
  using (true);

drop policy if exists "professional_applications_insert_all" on public.professional_applications;
create policy "professional_applications_insert_all"
  on public.professional_applications for insert
  with check (true);

drop policy if exists "professional_applications_update_all" on public.professional_applications;
create policy "professional_applications_update_all"
  on public.professional_applications for update
  using (true) with check (true);

do $$
begin
  alter publication supabase_realtime add table public.professional_applications;
exception when duplicate_object then null;
end $$;
