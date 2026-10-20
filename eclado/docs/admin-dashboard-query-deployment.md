# 儀表板專用查詢

`supabase-admin-dashboard.sql` 新增 `get_admin_dashboard()`，一次回傳六個月營業額、已付款數量、待審核數量、低庫存摘要及最新五張訂單。付款歷程只讀取這五張訂單的最新狀態，不回傳付款網址、虛擬帳號、聯絡資料或價格快照。

## 相容性與部署順序

1. 確認 PostgreSQL 16+（使用 `pg_input_is_valid`），既有訂單來源、交易日期、代客付款欄位及付款嘗試表均已存在。
2. 在目標 Supabase 專案執行 `supabase-admin-dashboard.sql`。這是新增的只讀函式，不修改既有資料或 RLS。正式環境 2026-10-20 預檢為 PostgreSQL 17.6，新增前函式不存在。
3. 用真實管理員登入比對新舊六個月營業額、已付款數量、待審核數量及低庫存數量。
4. Commit / push main 觸發網站自動部署；確認正式 `/admin` 使用新的入口資產後重測。

管理員及 `orders.read` 都必須通過，與原訂單 RLS／付款 RPC 的角色邊界一致。沒有 `members.read` 或 `catalog.read` 時，不回傳相應區塊的資料。營業額沿用既有六種有效訂單狀態、排除歷史補登，依訂單日期（缺少時使用建立時間）與台北時區歸月；已付款卡片仍只統計 `paid` 狀態。商品庫存警示沿用啟用商品、`stock <= (min_stock || 3)` 規則。

儀表板啟動只呼叫摘要 RPC（另有登入權限及側欄偏好讀取）。首次切換至其他後台頁面時，沿用既有完整資料查詢；會員歷史訂單、營業分析與商品管理不會誤用最新五筆摘要。Realtime 在儀表板只刷新摘要；離開儀表板或新請求覆蓋舊請求時，過期摘要回應不會寫入狀態。

## 驗證

```sh
PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js TZ=Asia/Taipei node --test tests/integration/admin-dashboard-db.test.cjs
npx playwright test tests/admin.spec.ts tests/admin-analytics.spec.ts --project=chromium --project=mobile-chrome --workers=1 --grep '儀表板|後台重整等待權限|後台登入權限|商品小編|歷史補登|列表響應式切換|訂單管理可查看明細並更新狀態|導覽列可將頁面'
npm run build
```

資料庫測試實際執行 PostgreSQL 函式，涵蓋匿名、非管理員、停用管理員及權限縮限、空資料、跨月台北日期、歷史補登排除、付款重試與敏感欄位排除。UI 測試涵蓋摘要獨立載入、載入／錯誤／重試狀態、頁面切換與既有操作。

效能以同一個已登入 Chrome、一般重整、前後各五次觀察。從 navigation start 到該次 `/rest/v1/` 初始請求全部 `responseEnd` 的最大值，作為資料請求完成時間；另檢查摘要內容確實顯示。此指標包含網路與伺服器時間，不代表精確最後繪製時間。新資產首次下載另外保留，快取與網路波動不應歸因為純 SQL 加速。

## 回復

如需回復，revert 前端提交並透過 Git 部署即可；保留新增的只讀函式不影響舊客戶端。不要執行資料刪除、全庫還原或帳務回復。若將來要移除函式，應先確認所有客戶端已停止使用，另行安排。
