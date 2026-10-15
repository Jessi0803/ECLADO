# 指定會員優惠券 quote／create 最小相容修補

日期：2026-10-14。此修補只處理一般網站指定會員優惠券報價成功、建單卻回傳 SQLSTATE `22023` 的既有差異；不屬於返饋金計算變更。

## 原因與範圍

正式來源基線的 `quote_order_pricing_discount_v2` 已透過 `coupon_campaign_allows_identity()` 檢查 `coupon_campaign_members`，但 `create_order_with_pricing_discount_v2` 仍直接檢查 `audience_roles` 與 `allow_guest`。`audience_mode='members'` 時前者會接受名單內會員，後者因 `audience_roles={}` 而拒絕。

`supabase-coupon-member-create-compat.sql` 僅將 creator 的兩個舊條件替換成同一 helper。Migration 在來源形狀不同時停止，重跑不重複修改，且執行後核對函式 owner 與 ACL 不變。未修改報價算術、活動、使用次數、優惠券保留、訂單、庫存、付款、購物金、返饋或代客訂單流程。

## 實際驗證

- 隔離 PostgreSQL 17.6：1／1 通過。先載入正式匯出的舊 creator 並重現 quote 成功／create 22023，再套修補；指定學生建單與 `coupon_redemptions.status='reserved'` 成功，非指定會員拒絕，第二次套用成功，owner／ACL 相同。
- 優惠券 SQL 靜態回歸：10／10 通過。
- 階段4雙錢包 PostgreSQL 回歸：1／1 通過，包含雙錢包鎖定、付款、取消、重試、晚到回呼及併發；deadlocks=0。
- test Supabase `qqlgqasbmbicnmvnlqbr`：修補成功，`helper_present=true`、`legacy_removed=true`。`07-test-coupon-member-create-compat.sql` 透過目前雙錢包 quote／create 驗證指定學生成功、非指定老師拒絕；全交易回滾後測試訂單與測試優惠券皆為0。
- Build：只修改 SQL／測試／文件，仍另執行 test mode Vite build；結果記錄於本次工作回報。

## 正式狀態

正式 Supabase 未操作，正式網站未部署，Git 未提交／推送，學生價格開關未變。此問題已在本機及 test 修正，正式環境仍須在正式 Metadata 重核、備份及明確批准後，單獨套用相同 SQL，再執行唯讀 verify 與受控結帳 smoke test。在此之前，正式放行仍為 No-Go。
