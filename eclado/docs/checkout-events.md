# 結帳事件追蹤

用途：辨認「訂單沒存入」「訂單已存但瀏覽器沒收到回應」「付款服務未收到請求」「銀行拒絕」「銀行成功但保存／回傳失敗」。只增加觀測，不改變建單、防連點、訂單狀態、庫存、錢包或付款重試規則。

## 資料與信任

`checkout_events` 以 `flow_id` 串起同一分頁 24 小時內的結帳提交；每次提交另有 `attempt_id`，瀏覽器事件另含 `previous_attempt_id`。重新整理保留流程；新分頁／瀏覽器及儲存空間被清除後，不保證能接續。新購物車不一定代表新流程；不能只憑 flow_id 認定重複訂單，仍須對照訂單內容與時間。

| source | 代表的證據 | 不代表什麼 |
|---|---|---|
| browser | 瀏覽器回報執行過的階段、錯誤分類與當時是否離線 | 未驗證客戶身分、訂單所有權、銀行成功；所有客戶端欄位可被偽造 |
| database | 訂單 INSERT 與事件在同一交易提交；或付款授權確實記錄金流建立成功 | 流程編號仍由客戶端提供；不證明瀏覽器收到回應 |
| payment_api | 付款服務完成限流後收到請求，及後續 claim、銀行、保存與回傳準備階段 | 收到請求不代表已驗證訂單所有權；`payment_response_ready` 不證明瀏覽器收到回應 |

`occurred_at` 是來源時鐘；`received_at` 是資料庫收件時鐘。瀏覽器事件可能延遲、重送、時鐘不準；以事件名稱、嘗試編號、兩種時間共同判讀。**缺少事件不等於該動作沒發生**：追蹤也會斷線、被瀏覽器攔截或在程序崩潰時遺失。資料庫 trigger 例外會隔離，交易仍可成功而沒有事件。

僅收固定欄位及允許的階段：UUID、訂單編號、毫秒耗時、在線／可見狀態、錯誤分類、有限格式的 PostgREST／SQLSTATE／銀行錯誤碼、HTTP 狀態及版本。無 JSON 自由欄位、不收錯誤原文／stack／URL、姓名、電話、email、地址、購物車、IP 原文、完整 user agent 或 payment token。IP 僅於伺服器 HMAC 後交給既有短期限流表；原 IP 不寫入事件表。

## 寫入與權限

- 瀏覽器透過同源 `POST /api/checkout-events`，避免金流網域連不到時連追蹤也一起消失。
- 每批最多 10 筆／16KB；只接受最近 24 小時、未來最多 5 分鐘的瀏覽器時間。時間嚴重錯誤的批次可能被捨棄。
- HTTP API 白名單重建資料，不採客戶傳入的 source；SQL RPC 再固定 source=browser，表約束拒絕來源／事件名稱不相符。
- 每 IP 15 分鐘最多 60 批，共享資料庫限流。Vercel 使用平台 `x-vercel-forwarded-for`，其他執行環境使用 socket address，不信任任意 x-forwarded-for。平台語義參考 [Vercel Request headers](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for)。
- `anon` 不能讀寫；一般會員 SELECT 由 RLS 隔離，不能寫入；僅 `is_eclado_admin()` 管理員能讀，service_role 可寫及清理。事件表不提供客戶端查詢 API。
- 訂單編號故意不設外鍵，容許建單前事件、延遲補送與訂單清理後的短期診斷；browser.order_id 是未驗證的參考值。
- 每個 RPC 使用既有 Supabase CORS 允許的 `x-client-info` 傳流程 UUID，沒有改全域 client，也沒有改報價參數或 RPC 簽章。舊版前端沒有此 header，就不會有 order_stored 事件。

## 不影響結帳與保留期限

瀏覽器事件不 await：sessionStorage 最多 40 筆、最長 24 小時，500ms 合併送出，暫時失敗採退避並遵守 429 的 Retry-After。storage 被封鎖則改記憶體佇列；重新整理／關閉後可能遺失。4xx 無效資料捨棄，503／網路錯誤重試。成功刪除佇列採 event_id，避免誤刪期間新進的事件。重送使用相同 event_id，資料庫主鍵去重。pagehide 用 keepalive 嘗試送出，但不保證送達；下次載入會重送原 ID。

付款 API 診斷非同步批次寫入、每次最多等 2 秒（不阻擋付款主流程），寫入失敗只輸出固定警告，沒有原始錯誤。只追蹤帶有效 UUID 的網站建立付款請求；拒絕限流的請求不另寫事件，防止繞過限流灌表。舊版／既有重新付款路徑不自動產生瀏覽器結帳追蹤。

事件依 `received_at` 保留 30 天：瀏覽器收件 RPC 每次有界清理最多 500 筆；既有 `/api/cancel-expired-orders` 每日排程另刪除全部過期事件，獨立 2 秒 timeout，清理失敗不影響訂單逾期作業。正常排程下可能多保留到下一個每日執行時間；需監看固定的 retention unavailable 警告。

## 部署順序與回復

1. 在隔離／staging DB 執行 `supabase-checkout-events.sql`；依賴已存在的 `orders`、`order_payment_authorizations`、`consume_rate_limit_internal`、`is_eclado_admin()`。
2. 驗證 ACL、RLS、trigger、主鍵去重與故障隔離後，再對正式資料庫執行同一 migration。migration 可重跑；不回填歷史事件。
3. 部署網站/API（包含 api/checkout-events.js、payment-api/checkout-events.cjs 的 Vercel 依賴追蹤）；既有 SUPABASE_SERVICE_ROLE_KEY／SUPABASE_SERVICE_KEY 足夠，不需新增公開密鑰。Preview 必須沿用既有隔離 DB 設定。
4. 部署付款服務時，runtime archive 必須包含 `checkout-events.cjs`，已更新 GitHub workflow 與 deploy-release.sh 的檔案白名單。
5. Vite 從 VITE_BUILD_ID 或 VERCEL_GIT_COMMIT_SHA 注入版本，未設定的本地版本為 local。以 mock 流程確認一個 flow 可串起 browser/database/payment_api；不以正式下單或付款作 smoke test。

回復：先還原網站與付款服務版本；資料表可留到保留期限。需要停用 DB 追蹤時，只移除 `trg_checkout_order_stored` 與 `trg_checkout_gateway_recorded`，不更改付款／報價函式。診斷表不存在／暫時不可寫時，設計上不阻擋原交易；不要靠刪除正式表驗證故障隔離。

## 查詢範例（管理員／SQL Editor）

```sql
-- 先由訂單找到流程，再取得同流程的建單前事件與其他嘗試。
with flows as (
  select distinct flow_id from public.checkout_events
  where order_id = 'ECL-替換成訂單編號'
    and source = 'database' and event_name = 'order_stored'
)
select e.flow_id, e.attempt_id, e.previous_attempt_id, e.order_id, e.source,
  e.event_name, e.occurred_at at time zone 'Asia/Taipei' as occurred_taipei,
  e.received_at at time zone 'Asia/Taipei' as received_taipei,
  e.elapsed_ms, e.online, e.error_kind, e.error_code, e.http_status, e.app_version
from public.checkout_events e join flows f using (flow_id)
order by e.occurred_at, e.received_at, e.event_id;
```

判讀例：database.order_stored 有、browser.order_received 無，可能是資料庫回應未到瀏覽器，也可能只是瀏覽器追蹤未送達。browser.payment_requested 有、payment_api_received 無，可能是 DNS／TLS／連線／跨網域問題，也可能是限流或付款端診斷不可用。只有 network 類別時，不應聲稱已分辨 DNS、TLS、CORS 或是哪一方網路故障。

## 本地驗證（2026-10-23）

- 隔離 PGlite PostgreSQL：migration 重跑、anon／一般會員／管理員權限、SQL 交易回滾、去重、限流、過期刪除、錯誤 header／診斷表不可用仍保存訂單，通過。
- 新增 HTTP／寫入測試、既有逾期訂單與發布包測試共 14 項通過；付款服務全套 65 項通過（發布包更新後另重跑其 3 項）。
- 桌機／手機新流程 6 項及既有結帳回歸 8 項通過：失敗重試、流程關聯、無敏感資料、追蹤服務故障／儲存被封鎖不阻擋付款、重載補送、原有防連點與成功／失敗提示。
- `npm run build` 完整建置與 SEO 預渲染成功；`git diff --check` 通過。
- 本地驗證未使用正式客戶憑證或呼叫銀行；不回填本次客戶的歷史缺失紀錄。

## 正式資料庫套用（2026-10-23 08:58 台灣時間）

依使用者要求，在正式 Supabase 專案 `ilvdvlkdpntwmaijncaz` 的 SQL Editor 執行完整 migration，結果 Success。預檢確認事件表／同名觸發器不存在，依賴均具備。

唯讀驗收確認：16 欄、4 索引、RLS 啟用、管理員讀取政策、一般會員不得寫入、anon 不得讀寫、收件 RPC 僅 service_role 可執行、兩個觸發器皆啟用。REST limit=0 查核 service_role 得到 200、匿名得到 401／42501。套用前後訂單數均 104，事件數 0；未建立正式訂單／付款交易。

[正式驗收證據](evidence/checkout-events-production-20261023.json)；重跑唯讀查核可使用 `supabase-checkout-events-verify.sql`。

**此階段僅正式 DB 已完成，尚未 commit／push 或發布網站／付款服務。** 新版前端與同源收件 API 必須經網站部署才能開始完整追蹤。付款 API 沿用 [HOST-DEPLOYMENT.md](../payment-api/HOST-DEPLOYMENT.md) 記錄的 Vultr 直接管理方式，需另外部署 server.js 與 checkout-events.cjs；不能把網站 push 當作付款主機已更新。現有 GitHub payment-api-release workflow 只更新封裝相依檔案，這次沒有觸發或切換部署管道。只有表建好時，舊版前端沒有流程 header，不會回填或自動產生新追蹤。
