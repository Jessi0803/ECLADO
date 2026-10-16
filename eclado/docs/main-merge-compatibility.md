# main 合入師資分潤分支｜2026-10-16

## 範圍

將 origin/main `dcc6bcf9fceccc81931df41ed8fd8a95e28d502a` 合入
`codex/instructor-student-rewards`（合入前 `f15055f0a4602d7fbec0fa0f9aa2eedd1efab367`）。
main 三筆修正：購物金付款顯示／權威金額、會員代客付款入口、文件圖片 JPEG 備援。
無文字衝突。原有未提交變更先 stash，合併提交後還原，不混入 merge commit。

## 語意相容修補

main 新增付款快照驗證原僅計購物金。此分支另有返饋金，故最小擴充為：

`total = shopping_credit_amount + reward_credit_amount + payment_amount`

銀行應付仍至少 NT$1，完全使用後端快照，不信任前端傳入金額。
修改 `src/domain/orderPaymentAmounts.js`、會員訂單讀取／顯示、付款暫存／恢復、
`payment-api/server.js` 的快照欄位投影及建單驗證。
原有付款 token、claim、重試授權與雙錢包 Ledger／庫存 SQL 均未變更。
同步修正測試 mock：付款重試改回傳該筆訂單，取代固定 3980 元；不得放寬正式金額檢查。

## 本機驗證

- `node --test tests/integration/order-payment-amounts.test.mjs`：7/7。
- `npm --prefix payment-api test`：58/58，HTTP／銀行回應皆為本機 mock。
- `PGLITE_MODULE=… node --test tests/integration/assisted-member-link-db.test.cjs`：1/1，隔離 PGlite；非正式 PostgreSQL／銀行驗收。
- Playwright `order-wallet-payment-merge.spec.ts` + `instructor-reward-checkout.spec.ts`：桌面／手機 14/14。
- Playwright 原有購物金、代客連結、付款重試指定回歸：8/8。
- Playwright `product-image-optimization.spec.ts`：9/9。
- `npx vite build --mode test`：通過，既有大 bundle 警告仍在。
- `git diff --check`：通過。

## 上線限制

本次僅本地合併，不 push、不部署、不操作任何雲端 DB、不啟用學生價格。
main 帶入的 `supabase-assisted-order-member-link.sql` 未在本次安裝，test／正式實際安裝狀態須另行核對。
付款 API／前端依賴階段 4 的 `orders.reward_credit_amount`；正式上線須先按既定 Migration 相依順序驗證 Schema，不能只單獨發布此 API。
正式銀行交易、正式 Schema、通知 worker 均不在本次驗證範圍。
