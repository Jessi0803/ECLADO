# 已售產品成本本機驗證

在隔離的本機 Supabase 中，先具備商品管理、訂單配置、入庫單、庫存盤點、出貨資訊與系統稽核功能，再套用 `supabase-product-costs.sql`。資料庫沒有新增出貨觸發器。背景處理從已提交的出貨時間與交付稽核紀錄讀取訂單。

核對本機實體庫存後，以有 `procurement.manage` 的測試管理員呼叫 `start_product_costs`。`p_opening` 是按 FIFO 先後排列的明細陣列，例如 `[{"variant_id":101,"quantity":3,"unit_cost_twd":100,"evidence":"期初盤點及發票"}]`。每個規格未提供成本的期初件數會留為未知，期初只可建立一次。測試尚未確認來源時，也可傳入空陣列。

以本機 Supabase 的 service role key 啟動背景處理：

```sh
PRODUCT_COST_LOCAL_URL=http://127.0.0.1:54321 PRODUCT_COST_LOCAL_SERVICE_KEY='<本機 service role key>' node scripts/run-local-product-costs.mjs
```

加上 `--once` 可執行一次。預設每 30 秒輪詢一次，處理到約一分鐘前的來源事件。後台「營業分析 → 已售產品成本」使用 `analytics.read` 權限。現有的本機示範若使用自訂 RPC 模擬器，需要另外接入新版 SQL 與報表 RPC。

可再售退貨在確認實際回倉後，由具有 `procurement.manage` 的人員呼叫 `record_product_cost_return`，提供唯一的 `p_key`、原 `p_order_id`、從 0 起算的 `p_line_index`、實際 `p_quantity` 及 `p_evidence`。這是成本帳的回補，現有庫存回補仍由原本流程管理。第一版的期初與退貨確認使用 RPC，尚無專屬表單。

成本不足、未知或晚到的事件會留在待確認清單，後到貨的成本層不會自動沖銷已保存的舊出貨結果。日後要補登重算，應另行加入核准及版本紀錄。
