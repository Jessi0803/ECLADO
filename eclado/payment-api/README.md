# ECLADO Payment API（永豐豐收款 / QPay 代理）

部署於 **Vultr**（`pay.ecladotaiwan.com`，主機 IP `202.182.120.159`），用 PM2 常駐。
這是唯一持有豐收款金鑰、唯一對豐收款 API 溝通的服務（正式環境只有它的固定 IP 在白名單內）。

## 職責

- `POST /api/sinopac/create-payment` — 呼叫豐收款 `OrderCreate` 建立付款（信用卡/ATM/Apple…）。
  信用卡預設 `AutoBilling=Y`（自動請款）；BackendURL 一律強制指向本服務。
- `GET|POST /return` — 信用卡(含行動支付)付款結果的同步回拋。用 PayToken 向豐收款
  `OrderPayQuery` 確認後，標記訂單已付款，再導回前台 `/payment-result`。返回網址只帶
  訂單編號與非權威的結果提示，不會把 PayToken 暴露給瀏覽器；前端會再以付款授權
  token 查詢權威狀態。
- `POST /api/sinopac/notify` — 各付款方式的非同步通知（BackendURL）。確認後標記已付款。
- `POST /api/sinopac/query-payment` — `OrderQuery` 查詢。
- `POST /api/orders/payment-instructions` — 驗證會員身分與訂單所有權後，恢復原付款資訊。
- `POST /api/orders/guest-lookup` — 以短查詢碼與結帳手機查詢訪客訂單，成功後簽發短效憑證。
- `POST /api/orders/guest-details` — 以短效訪客憑證更新該筆訂單、付款與物流狀態；不再次傳送手機號碼。
- `POST /api/orders/expire-overdue` — 清理逾期未付款訂單；必須帶正確的 `X-Cleanup-Key`。
- `POST /api/orders/retry-payment-notifications` — 重送已付款但 LINE／Email 尚未成功的通知；
  必須帶正確的 `X-Cleanup-Key`，建議由 cron 每小時呼叫。

確認付款成功後，會轉發 `{OrderNo, Status:'S'}` 給 Vercel 端
（`ecladotaiwan.com/api/sinopac/notify`）負責標記 paid + 寄送 LINE／Email，
本服務再補寫一次 paid 作為保險。詳見整體架構說明。

正式啟用通知重試前，必須先在 Supabase SQL Editor 執行
`supabase-payment-notification-reliability.sql`。它會新增通知送達狀態、原子 claim／complete
RPC 與重試索引；既有已付款訂單會標記為歷史已處理，避免部署時大量重寄舊通知。

訂單讀取與狀態更新一律使用 Vultr 端的 `SUPABASE_SERVICE_ROLE_KEY`；
瀏覽器公開的 anon key 不具備訂單存取權，也不應提供給本服務作為後端權限。
建立或查詢付款時必須帶上權威訂單 RPC 回傳的一次性 `paymentToken`。

`ORDER_CLEANUP_KEY` 是必填環境變數。未設定時服務會拒絕啟動，清理端點也不會執行。
`PAYMENT_NOTIFY_SECRET` 同樣為必填，Vultr 轉發付款完成通知時會以
`X-ECLADO-Payment-Secret` header 傳給 Vercel；Vercel 只接受密鑰完全一致的請求。
`GUEST_LOOKUP_SECRET` 也是必填且應使用另一組獨立隨機值；訪客手機只在伺服器端比對，
不會寫入瀏覽器。訪客付款單建立成功後，Payment API 會以 `PAYMENT_NOTIFY_SECRET`
呼叫 Vercel 的訂單信 API，寄出短查詢碼與查詢連結。
逾期判斷以 Supabase 訂單的 `payment_due_at` 為唯一依據；新訂單預設為建立後 48 小時。
建立永豐 ATM 付款單時，`ExpireDate`／`ExpireTime` 同樣由 `payment_due_at` 轉換，不接受前端自訂期限。
資料庫只保存 token hash，且會原子鎖定建單流程，避免同一訂單重複建立付款單。

## 付款狀態判定（豐收款 PayStatus，規格書 §10.2）

`isPaidLike` 認定為「已付款」：`1C300`(已授權未請款)、`1C400`(請款完成)、
`1A400`(ATM付款完成)、`1M400`(行動支付付款完成) 等（樣式 `1[A-Z](300|400)`）。
注意 `1C200`=待付款、`1C250`=逾期，**不算**已付款。

## 本機開發 / 測試

```bash
cd payment-api
npm install
cp .env.example .env   # 填入實際金鑰（不提交）
npm start              # 本機啟動
npm test               # 跑單元測試（node --test）
```

正式豐收款整合測試不再自行偽造金額或訂單。先由網站建立兩張全新、可拋棄的權威訂單，
再分別設定 `PAYMENT_INTEGRATION_ATM_ORDER_NO`／`PAYMENT_INTEGRATION_ATM_TOKEN` 與
`PAYMENT_INTEGRATION_CARD_ORDER_NO`／`PAYMENT_INTEGRATION_CARD_TOKEN`，最後以
`RUN_PAYMENT_INTEGRATION=1` 執行整合測試。每組 token 只能用於原本那張訂單。

## 部署到 Vultr（手動，一行）

> 主機上的 `.env` 不在 repo 內，部署只覆蓋程式碼，不動 `.env`。

```bash
scp payment-api/server.js root@202.182.120.159:/opt/eclado-payment-api/server.js \
  && ssh root@202.182.120.159 'cd /opt/eclado-payment-api && node --check server.js && pm2 restart eclado-payment-api'
```

部署後確認：

```bash
ssh root@202.182.120.159 'curl -s http://127.0.0.1:3000/health'
```
