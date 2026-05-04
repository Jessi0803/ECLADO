-- ============================================================================
-- ECLADO 活動管理（Promotions）資料表 SQL
-- 在 Supabase SQL Editor 執行一次即可
-- ============================================================================

-- 1) promotions 表：店家自訂的折扣活動
create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  name text not null,                                      -- 活動名稱（顯示用）
  description text,                                        -- 詳細說明（給顧客看）
  product_ids integer[] not null default '{}',             -- 參與活動的商品 id 陣列
  discount_rate numeric not null default 0.95,             -- 乘法折扣（0.95 = 95折）
  discount_amount numeric not null default 1000,           -- 減法折扣（NT$）
  start_at timestamptz,                                    -- 活動開始（null = 立即）
  end_at timestamptz,                                      -- 活動結束（null = 無限期）
  active boolean not null default true,                    -- 手動總開關
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- updated_at 自動更新
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_promotions_updated_at on public.promotions;
create trigger trg_promotions_updated_at
  before update on public.promotions
  for each row execute function public.set_updated_at();

-- 2) RLS：所有人可讀（顧客端要看），只有登入者能寫（你之後加 admin 角色就在這加 USING）
alter table public.promotions enable row level security;

drop policy if exists "promotions_select_all" on public.promotions;
create policy "promotions_select_all"
  on public.promotions for select
  using (true);

drop policy if exists "promotions_insert_auth" on public.promotions;
create policy "promotions_insert_auth"
  on public.promotions for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "promotions_update_auth" on public.promotions;
create policy "promotions_update_auth"
  on public.promotions for update
  using (auth.role() = 'authenticated');

drop policy if exists "promotions_delete_auth" on public.promotions;
create policy "promotions_delete_auth"
  on public.promotions for delete
  using (auth.role() = 'authenticated');

-- 3) 開啟 realtime
alter publication supabase_realtime add table public.promotions;

-- 4) orders 表加 3 個欄位（記錄套用了哪個活動 / 折抵多少）
alter table public.orders
  add column if not exists subtotal numeric,
  add column if not exists discount numeric default 0,
  add column if not exists promotion_id uuid references public.promotions(id) on delete set null,
  add column if not exists promotion_name text;

-- ============================================================================
-- 完成。可以到 Table Editor 確認 promotions 表已建立。
-- ============================================================================
