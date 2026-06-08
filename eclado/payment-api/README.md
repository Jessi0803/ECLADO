# ECLADO Payment API（永豐豐收款 / QPay 代理）

部署於 **Vultr**（`pay.ecladotaiwan.com`，主機 IP `202.182.120.159`），用 PM2 常駐。
這是唯一持有豐收款金鑰、唯一對豐收款 API 溝通的服務（正式環境只有它的固定 IP 在白名單內）。

## 職責

- `POST /api/sinopac/create-payment` — 呼叫豐收款 `OrderCreate` 建立付款（信用卡/ATM/Apple…）。
  信用卡預設 `AutoBilling=Y`（自動請款）；BackendURL 一律強制指向本服務。
- `GET|POST /return` — 信用卡(含行動支付)付款結果的同步回拋。用 PayToken 向豐收款
  `OrderPayQuery` 確認後，標記訂單已付款，再導回前台。
- `POST /api/sinopac/notify` — 各付款方式的非同步通知（BackendURL）。確認後標記已付款。
- `POST /api/sinopac/query-payment` — `OrderQuery` 查詢。
- `POST /api/orders/expire-overdue` — 清理逾期未付款訂單。

確認付款成功後，會轉發 `{OrderNo, Status:'S'}` 給 Vercel 端
（`www.ecladotaiwan.com/api/sinopac/notify`）負責標記 paid + 寄送 LINE／Email，
本服務再補寫一次 paid 作為保險。詳見整體架構說明。

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
