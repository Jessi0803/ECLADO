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
- `POST /api/orders/expire-overdue` — 清理逾期未付款訂單；必須帶正確的 `X-Cleanup-Key`。

確認付款成功後，會轉發 `{OrderNo, Status:'S'}` 給 Vercel 端
（`ecladotaiwan.com/api/sinopac/notify`）負責標記 paid + 寄送 LINE／Email，
本服務再補寫一次 paid 作為保險。詳見整體架構說明。

訂單讀取與狀態更新一律使用 Vultr 端的 `SUPABASE_SERVICE_ROLE_KEY`；
瀏覽器公開的 anon key 不具備訂單存取權，也不應提供給本服務作為後端權限。
建立或查詢付款時必須帶上權威訂單 RPC 回傳的一次性 `paymentToken`。

`ORDER_CLEANUP_KEY` 是必填環境變數。未設定時服務會拒絕啟動，清理端點也不會執行。
`PAYMENT_NOTIFY_SECRET` 同樣為必填，Vultr 轉發付款完成通知時會以
`X-ECLADO-Payment-Secret` header 傳給 Vercel；Vercel 只接受密鑰完全一致的請求。
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
