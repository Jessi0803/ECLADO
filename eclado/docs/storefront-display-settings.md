# 前台商品供貨資訊顯示

後台入口：系統設定 → 前台商品顯示 →「顯示現貨／預購與出貨時間」。
沿用系統設定的 `member_pricing.manage` 權限；前台可公開讀取，只有通過此權限檢查的 RPC 可以儲存。

- 開啟：商品詳情、購物車頁、側邊購物車及結帳品項顯示原供貨資訊。
- 關閉：上述逐項資訊隱藏，結帳含非贈品預購品項時，仍顯示一次約 7–14 個工作天的交期提醒。純現貨訂單不顯示此提醒。
- 商品小卡維持原外觀。購物須知、訂單紀錄、代客下單付款頁及 SEO 結構化資料不受此設定影響。
- 不改動庫存計算、零庫存下單、贈品保留、付款或訂單快照。

## 上線

1. 在目標 Supabase 執行 `supabase-storefront-display-settings.sql`，依賴既有 `has_backoffice_permission` 函式。
2. 部署前後台程式。
3. 用具管理權限帳號進入系統設定，關閉開關並按「儲存顯示設定」。
4. 確認商品詳情、兩種購物車及含預購品項的結帳頁。

初次安裝預設開啟，重跑 SQL 不覆寫已儲存值。未安裝資料表或讀取失敗時，前台回到原顯示行為；後台無法載入時會禁用儲存並顯示錯誤。前台透過 Realtime 追蹤更新，重新整理或切回頁面時也會重新讀取。

回復原顯示方式只需重新開啟並儲存，無須刪除資料表。

## 驗證

- `npm run build`
- `npx playwright test tests/storefront-display.spec.ts --project=chromium --project=mobile-chrome --workers=2`
- `PGLITE_MODULE=<isolated pglite module path> node --test tests/integration/storefront-display-db.test.cjs`
