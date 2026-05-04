-- ============================================================================
-- 修補：讓後台可以寫入 promotions 表
-- ============================================================================
-- 問題：原本 RLS 要求 auth.role() = 'authenticated'，但後台用的是密碼閘而非
-- Supabase 登入，所以送出的 request 角色是 anon，會被擋。
--
-- 本檔將 promotions 的 insert/update/delete 改為允許任何人寫入。
-- 安全性依賴兩件事：
--   1) /admin 網址沒公開宣傳
--   2) admin.html 前端用 sessionStorage 密碼閘保護
--
-- 請到 Supabase → SQL Editor 貼上整段執行一次。
-- ============================================================================

alter table public.promotions enable row level security;

-- select 維持公開（顧客端要讀）
drop policy if exists "promotions_select_all" on public.promotions;
create policy "promotions_select_all"
  on public.promotions for select
  using (true);

-- insert / update / delete：移除舊的 authenticated 策略，改為全開放
drop policy if exists "promotions_insert_auth" on public.promotions;
drop policy if exists "promotions_update_auth" on public.promotions;
drop policy if exists "promotions_delete_auth" on public.promotions;

drop policy if exists "promotions_insert_all" on public.promotions;
create policy "promotions_insert_all"
  on public.promotions for insert
  with check (true);

drop policy if exists "promotions_update_all" on public.promotions;
create policy "promotions_update_all"
  on public.promotions for update
  using (true) with check (true);

drop policy if exists "promotions_delete_all" on public.promotions;
create policy "promotions_delete_all"
  on public.promotions for delete
  using (true);
