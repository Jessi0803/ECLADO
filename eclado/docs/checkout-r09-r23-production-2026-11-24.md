# R09／R23 正式發布｜2026-11-24

已依 SQL migration → PostgREST schema cache → Git 前端發布的順序完成。

- 正式站：[ecladotaiwan.com](https://ecladotaiwan.com)
- 功能提交：`fa09d1cd6dc6736905c58c553ad936d3f1b06f6b`，前版 `642e1fc468658aaca30ab7e6e0d265c5cb4a688a`。
- 功能部署：`dpl_Fyc11kD2rwWVGvzsNbquYxqGhdwb`，Vercel Production Ready；正式網域已指向新版。
- 從最新 origin/main 建立 `/private/tmp/eclado-r09-r23-release` 隔離發布目錄，僅發布四個產品檔、兩個 SQL 及相關回歸／fixture／測試入口設定；沒有包含原工作區其他未完成開發。付款 API 無需發布。

## 資料庫

Supabase `ilvdvlkdpntwmaijncaz` main／PRODUCTION，PostgreSQL 17.6。已執行 `supabase-checkout-order-idempotency.sql`，SQL Editor 顯示成功；六項唯讀安裝檢查全部 true。已執行 `NOTIFY pgrst, 'reload schema';`。

原有 public 函式來源與 ACL 指紋（排除四個新增函式）安裝前後均為 `73e959afef473bb402c260ce3e596b85`。既有建單函式保留；新私有表啟用 RLS 並拒絕 client／service_role 直接存取。

正式 PostgREST 查回隨機不存在 key 回傳 200/null；ordinary／wallet 新 overload 均能解析，無效 key 在進入既有建單前回傳 42501，沒有建立訂單。

正式資料庫於單一回滾交易內使用匿名 claims、現有公開商品與合成收件資料：報價、第一次建單、同 key 重播、查回原單；斷言三個結果的訂單編號一致且訂單數只增加一筆，通過後 ROLLBACK。再次唯讀檢查無合成測試訂單、無已提交請求記錄。沒有建立銀行交易。這一項是目標資料庫的交易內相容驗證；跨提交與 HTTP 丟失由隔離 SQL 測試覆蓋。

## 發布及驗收

完整 production build（含 SEO 預渲染 65 個商品、8 篇文章）exit 0；有既有 chunk size 警告與暫存 Vite dep-scan 關閉訊息，不是建置失敗。隔離來源桌機／手機 32 項通過。

正式資產桌機／手機 32 項通過，包括首次會員公司發票／購物金不受邀請橫幅阻擋、背景刷新保留表單、訪客／會員／雙錢包 commit 後回應遺失的 retry／reload、只建一單及不重複保留券／贈品／錢包、恢復故障阻擋新單、paid／cancelled／已有金流不新建金流。雙錢包 retry／reload 三輪另 12 項通過。

首次正式資產執行為 31 通過、1 測試等待逾時；失敗截圖已顯示原單付款頁。原 predicate 的 isEnabled 等待已消失按鈕，修正為即時 enabled locator count 後全套及三輪重跑通過。只修測試，不修改產品等待時間。

正式資產測試只放行 `ecladotaiwan.com` GET 頁面與靜態資產；其他未攔截網路全部阻擋。Auth／目錄／通知／銀行替身，建單與查回為隔離 SQL；沒有正式訂單、付款或客戶通知。

`/`、`/shop`、`/checkout`、`/payment-result` 全部 HTTP 200，載入 `/assets/main-ld_ivJRz.js`；付款服務 `/health` 200/ok。

## 尚未涵蓋及回復限制

實體 iPhone Safari／LINE，以及真實銀行付款未驗收。舊分頁未帶 key、清除 sessionStorage 或新瀏覽器的歷史請求無法自動還原，不可猜測無單而重建。

保留私有請求記錄與新 SQL 函式。需要回復時使用仍能辨識未完成 key 的相容修補；不能只退回會忽略未知結果並重新建單的舊前端。不要刪表／清空 result。

[機器可讀證據](evidence/checkout-test-audit-20261124/production-release.json)；[風險矩陣](checkout-test-risk-matrix-2026-11-24.md)。
