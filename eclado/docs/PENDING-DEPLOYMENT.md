# 待部署項目

## 歷史訂單補登

目前狀態：程式與 migration 已完成；正式資料庫 SQL 已由管理者執行。

部署後驗證：

1. 使用有 `orders.write` 權限的後台帳號，從會員詳情補登一筆歷史訂單。
2. 驗證該筆訂單顯示於會員訂單紀錄與後台訂單列表。
3. 驗證不改變現有庫存、會員累計消費、營業額及熱門商品。

Migration：`supabase-historical-orders.sql`
