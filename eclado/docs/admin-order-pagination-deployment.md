# 訂單列表分頁與明細按需載入

`supabase-admin-order-pagination.sql` 新增兩個只讀 RPC：

- `get_admin_orders_page(p_page, p_page_size, p_status, p_inventory, p_search)`：預設每頁 50 筆，伺服器上限 100 筆。依 `created_at DESC, id DESC` 排序，搜尋訂單編號、訂購人、Email、電話、托運單號；搜尋字元按字面比對，不當成 SQL wildcard。狀態、庫存數量與總筆數皆在伺服器以完整搜尋範圍計算，超出最後一頁時自動夾至有效頁。
- `get_admin_order_detail(p_order_id)`：只回傳指定訂單的白名單欄位、商品與價格快照、完整且經過濾的付款嘗試、庫存分配、內部備註及該單所屬的合併出貨批次。付款網址、虛擬帳號與未來新增的未列白名單欄位不會自動進入回應。

三個 `_admin_order_*` helper 不授權給 anon/authenticated。兩個公開 RPC 仍要求有效管理員及 `orders.read`，與既有訂單 RLS／付款 RPC 相同。會員備註沿用 `orders.read` 可讀規則；會員連結及會員選單按需讀取仍遵守會員權限，歸戶入口另要求訂單與會員寫入權限。

庫存摘要與舊前端 mapper 對照測試：以正式配置為優先，再使用歷史快照；歷史補登與未配置庫存不會誤顯示現貨。最新付款嘗試決定列表付款狀態，明細則保留所有嘗試，因此較早的成功付款不會因較新的失敗紀錄而消失。

## 前端行為

進入訂單管理時只查列表，不載入所有會員、商品、訂單及付款歷程。搜尋輸入等待 250ms 才送出；變更篩選或搜尋會回第一頁。開啟詳情顯示載入／錯誤／重試狀態，未取得完整資料前不開放明細操作；關閉或切換訂單會取消舊請求。列表舊請求也不能覆蓋新搜尋結果。

列表改狀態時先取得該單明細再沿用既有流程；出貨通知不依賴當頁是否包含該批次的其他訂單。列印與永久刪除判斷使用已載入的完整明細。歸戶會員選單與代客開單所需商品／會員在開啟工具時才載入，不會因開啟訂單列表而讀取完整訂單。會員歷史訂單、營業分析與 AI 補貨仍沿用完整資料來源；儀表板保持獨立摘要。

列表備註 tooltip 保留會員備註及最多 1,000 字的顧客備註，完整顧客備註在明細中。每次查詢的筆數、篩選與資料來自同一 SQL snapshot；跨頁是即時資料而非凍結快照，因此新單或狀態異動時，列表可隨刷新重新排列。

## 部署與回復

1. 確認正式專案 PostgreSQL 16+、必要欄位與付款／庫存／備註／合併出貨資料表存在。
2. 執行 `supabase-admin-order-pagination.sql`；只新增函式與執行權限，不修改商業資料或既有 RLS。
3. 比對各函式 `md5(pg_get_functiondef(...))` 與隔離資料庫測試相符；確認 helper 不可由 API 角色執行。
4. 以管理員登入比對新舊所有有效訂單 ID、狀態、付款狀態、庫存標記及選定訂單的商品／價格快照／總額。
5. Commit / push main 自動部署前端，再驗證正式資產、分頁、搜尋、詳情及實測速度。

回復時 revert 前端 Git 提交再部署即可；新增的只讀函式可先保留，不影響舊程式。不刪除或還原任何訂單、付款、庫存或帳務資料。

## 驗證與效能量測

```sh
PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node --test tests/integration/admin-orders-pagination-db.test.cjs
npx playwright test tests/admin.spec.ts --project=chromium --project=mobile-chrome --workers=1 --grep '訂單|儀表板|會員內部備註|只有訂單權限|列表響應式切換|手機上一頁|會員詳細可一次匯入|營業分析與 AI|導覽列可|出貨可寫入|已有成功通知紀錄|未填托運單號|未付款狀態依|已出貨與已到貨'
npx playwright test tests/assisted-orders.spec.ts tests/admin-mappers.spec.ts tests/admin-analytics.spec.ts --project=chromium --project=mobile-chrome --workers=1
npm run build
```

隔離 PostgreSQL 使用 120 筆訂單驗證固定排序、跨頁無遺漏、全範圍計數、篩選、搜尋、最新付款與早期已付款保留、敏感欄位排除、空資料、非法參數、匿名／非管理員／停用帳號與私有 helper ACL。UI 涵蓋分頁、搜尋、慢回應取消、載入與重試、通知、出貨、列印、歸戶、雙向跳轉、歷史補登與代客流程。

正式量測使用同一個已登入 Chrome，每次先重整到儀表板，再從實際點選「訂單管理」開始計時。MutationObserver 偵測列表資料列出現，等待兩次 requestAnimationFrame 記錄可顯示時間；另記錄該次導覽發起之 REST 請求的最後 responseEnd。前後各五次，保留首次新資產下載與網路波動，不把它們當成純資料庫時間。此數字是儀表板到訂單列表的導覽時間，不是整個網站重整或付款耗時。
