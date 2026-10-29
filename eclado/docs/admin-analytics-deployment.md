# 自訂期間營業分析

## 範圍與口徑

整合於現有「營業分析」頁，預設本月，支援自訂起訖日期、本月／上月／近 30 天／近半年。查詢後整頁共用期間。每次查詢最多一個曆年（起日至隔年同日前一天；閏日按 PostgreSQL 曆年規則處理），前端與資料庫均驗證。每日／每月切換不改變期間總額；跨月只計所選日期，營業額趨勢採會員身分顏色堆疊柱狀圖，圖例與上方身分分布一致，每柱總高度代表該日／月營業額；滑鼠停留顯示身分金額。圖表保留完整時間軸，缺少銷售的日期補零。營業額明細預設隱藏訂單數為 0 的日期／月份，提供「顯示無訂單日期」開關及隱藏筆數提示；有有效訂單但營業額為 0 的列仍保留。此開關只影響明細表，不影響圖表、摘要或商品排行。

依訂單 `date`（空值則使用 `created_at`），以 Asia/Taipei 日期篩選，包含結束日整天。只計入 `paid`、`preparing`、`ready_for_pickup`、`picked_up`、`shipped`、`delivered`，排除 `historical_manual`。不依付款日期篩選：期間內下單、期間後付款的訂單，在付款後重新查詢會納入。

營業額沿用 `orders.total`，含運費，沿用現有折扣與購物金結果，不重新計算價格，不作會計淨收款或退款對帳。院線金額包含 pro/instructor/distributor。

排行依訂單商品快照，保留下架商品；可依商品合併或依規格拆分。缺少規格不推測，顯示「未記錄規格」。商品 ID 缺少時以名稱作 fallback，規格 ID 缺少時使用保存的容量文字，無法完全還原缺少識別資訊的舊資料。贈品（line_type=gift 或 is_gift/isGift=true）另計，不參與銷售排行。非正數／無效數量不猜測為一件。排行可看整段期間或選取單日／單月，銷售件數占比的分母隨排行範圍變動。

## 會員身分營收分布

營業額趨勢上方顯示各身分營收柱狀圖：訪客、一般會員、美容師、師資、經銷商、內部人員。可用灰階雙按鈕切換圓餅圖／柱狀圖，手機（900px 以下）首次進入預設圓餅圖，較寬畫面預設柱狀圖。圓餅圖附各身分金額、訂單數及占比圖例，窄畫面不需水平捲動；切換圖形不重新查詢資料。使用不同顏色、完整金額、訂單數及占期間總營業額比例，零銷售身分也顯示。未知身分歸入「其他／未記錄」，確保總額不漏算。

使用訂單保存的 type，不連接現今 profiles.role，以免日後升級身分改寫歷史分析。pro/instructor/distributor/staff 按訂單身分分類；consumer 且 user_id 存在為一般會員，consumer/guest 且 user_id 為空為訪客。綁定訪客訂單至會員後可能改變一般會員與訪客分布。此分布共用查詢期間、有效狀態、歷史補登排除及含運費訂單總額口徑，不輸出會員個資。RPC 每日總計的 byRole 保存各身分金額，前端按月份加總，堆疊金額與每日／每月總營業額一致。

## 部署順序

1. 先在目標資料庫執行 `supabase-admin-analytics.sql`（可重複執行）。需既有後台權限函數及支援 pg_input_is_valid 的 PostgreSQL 版本，與現有 dashboard 相同。
2. 以有 analytics.read 的管理員確認 `get_admin_analytics` 可查詢，確認未授權帳號遭拒。
3. 再部署前端。此頁只呼叫彙總 RPC，不再透過 AdminApp 載入全部訂單／會員／商品。
4. 驗證一段已知活動期間的總額與訂單明細一致，切換每日／每月與商品／規格後總額不變；確認沒有匯出功能。

RPC 是 stable/security definer、固定 search_path 及台灣時區，要求已登入且 is_eclado_admin() 與 analytics.read。只回傳每日總計、每日商品／規格數量，不含會員、地址或付款機密，不修改訂單、付款或庫存。

回復時先回復前端；SQL 為新增只讀函數，可保留，若要移除再執行 `drop function public.get_admin_analytics(date,date)`。無資料回填或資料格式遷移。

## 驗證

- `npm run build`
- `npx playwright test tests/admin-analytics.spec.ts tests/admin.spec.ts --project=chromium --project=mobile-chrome --workers=1 --grep '自訂期間|日期驗證|歷史補登|營業分析'`
- `PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node --test tests/integration/admin-analytics-db.test.cjs`

SQL 測試覆蓋超過 1,000 筆訂單、台灣日界線、無效日期、未付款／取消／歷史補登排除、贈品及無效數量分離、空結果、錯誤日期區間及存取權限。瀏覽器測試覆蓋桌面與手機的共同期間、跨月、排行切換、驗證錯誤和重試。
