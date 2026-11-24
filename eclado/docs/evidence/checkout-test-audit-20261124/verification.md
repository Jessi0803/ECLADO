# 結帳測試盤點驗證紀錄

日期：2026-11-24，Asia/Taipei。Node v24.16.0。以下均在目前工作區執行；未對正式服務建立交易。

## 預設 Playwright 收集

執行目錄 `eclado`。清除 RUN_*、PGLITE_MODULE、EMBEDDED_POSTGRES_MODULE、BINDING_NOTICE_PREVIEW 的繼承值，避免啟用外部或 DB 測試。

```sh
node node_modules/@playwright/test/cli.js test --list --project=chromium
```

結果：exit 1，Total: 0 tests in 0 files。共 29 則測試檔互相匯入錯誤，完整錯誤標題如下。--list 不代表完整測試執行。

```text
Error: test file "integration/automatic-price-allocation-db.test.cjs" should not import test file "integration/student-pricing-db.test.cjs"
Error: test file "integration/automatic-price-allocation-db.test.cjs" should not import test file "integration/instructor-reward-checkout-db.test.cjs"
Error: test file "integration/buy-x-get-y-db.test.cjs" should not import test file "integration/student-pricing-db.test.cjs"
Error: test file "integration/buy-x-get-y-db.test.cjs" should not import test file "integration/instructor-reward-checkout-db.test.cjs"
Error: test file "integration/cart-minimum-preview-db.test.cjs" should not import test file "integration/student-pricing-db.test.cjs"
Error: test file "integration/coupon-member-create-compat.test.cjs" should not import test file "integration/student-pricing-db.test.cjs"
Error: test file "integration/instructor-reward-checkout-db.test.cjs" should not import test file "integration/student-pricing-db.test.cjs"
Error: test file "integration/instructor-reward-ledger-db.test.cjs" should not import test file "integration/student-pricing-db.test.cjs"
Error: test file "integration/instructor-reward-notifications-db.test.cjs" should not import test file "integration/instructor-reward-checkout-db.test.cjs"
Error: test file "integration/instructor-reward-notifications-db.test.cjs" should not import test file "integration/student-pricing-db.test.cjs"
Error: test file "integration/instructor-reward-queries-db.test.cjs" should not import test file "integration/student-pricing-db.test.cjs"
Error: test file "integration/instructor-reward-withdrawals-db.test.cjs" should not import test file "integration/instructor-reward-checkout-db.test.cjs"
Error: test file "integration/instructor-reward-withdrawals-db.test.cjs" should not import test file "integration/student-pricing-db.test.cjs"
Error: test file "integration/promotion-student-policy-db.test.cjs" should not import test file "integration/student-pricing-db.test.cjs"
Error: test file "integration/promotion-student-policy-db.test.cjs" should not import test file "integration/instructor-reward-checkout-db.test.cjs"
Error: test file "integration/reward-redemption-export-db.test.cjs" should not import test file "integration/instructor-reward-checkout-db.test.cjs"
Error: test file "integration/reward-redemption-export-db.test.cjs" should not import test file "integration/student-pricing-db.test.cjs"
Error: test file "integration/reward-stage7a-production-coupon-compat.test.cjs" should not import test file "integration/student-pricing-db.test.cjs"
Error: test file "integration/reward-withdrawal-deductions-db.test.cjs" should not import test file "integration/instructor-reward-checkout-db.test.cjs"
Error: test file "integration/reward-withdrawal-deductions-db.test.cjs" should not import test file "integration/student-pricing-db.test.cjs"
Error: test file "integration/reward-withdrawal-mock-fixtures-db.test.cjs" should not import test file "integration/instructor-reward-checkout-db.test.cjs"
Error: test file "integration/reward-withdrawal-mock-fixtures-db.test.cjs" should not import test file "integration/student-pricing-db.test.cjs"
Error: test file "integration/reward-withdrawal-operations-db.test.cjs" should not import test file "integration/instructor-reward-checkout-db.test.cjs"
Error: test file "integration/reward-withdrawal-operations-db.test.cjs" should not import test file "integration/student-pricing-db.test.cjs"
Error: test file "integration/reward-withdrawal-partial-db.test.cjs" should not import test file "integration/instructor-reward-checkout-db.test.cjs"
Error: test file "integration/reward-withdrawal-partial-db.test.cjs" should not import test file "integration/student-pricing-db.test.cjs"
Error: test file "integration/student-reward-snapshots-db.test.cjs" should not import test file "integration/student-pricing-db.test.cjs"
Error: test file "recommendation-pricing-db.spec.ts" should not import test file "integration/instructor-reward-checkout-db.test.cjs"
Error: test file "recommendation-pricing-db.spec.ts" should not import test file "integration/student-pricing-db.test.cjs"
```

## 限定 Playwright 檔案收集

```sh
node node_modules/@playwright/test/cli.js test '.*\.spec\.ts$' --list --project=chromium
```

結果：exit 0，Total: 677 tests in 73 files。含全站非結帳功能、SQL 靜態斷言與條件整合測試；不是通過數。只收集，未啟動瀏覽器。

## 本機 Node 局部回歸

```sh
node --test tests/unit/member-cart.test.mjs tests/integration/order-payment-amounts.test.mjs tests/integration/sinopac-notify.test.cjs tests/integration/sinopac-notify-crypto.test.cjs tests/integration/cancel-expired-orders.test.cjs tests/integration/checkout-events.test.cjs
```

結果：48 tests，48 pass，0 fail，0 cancelled，0 skipped，0 todo；約 114 ms。銀行、Supabase、通知呼叫使用案例內替身；沒有實際付款或寄信。Node 顯示既有 MODULE_TYPELESS_PACKAGE_JSON 警告，不影響結果。

## 付款 API 全套

執行目錄 `eclado/payment-api`：

```sh
npm test
```

第一次受沙箱禁止 localhost listen 限制，產生 EPERM，不能當作產品故障。取得本機監聽權限後重跑：exit 0，107 tests，107 pass，0 fail，0 cancelled，0 skipped，0 todo；約 5.14 秒。

此組包含規則、注入依賴的 handler、127.0.0.1 HTTP 端點及使用假 PM2／命令的發布測試。測試啟動時載入付款目錄既有 .env；沒有讀取或保存環境值到本報告。案例本身攔截外部銀行／資料庫呼叫。此結果不證明實際供應商或 production 連線。

## 未執行的範圍

- 本輪 UI 操作、完整前端 build、隔離 SQL／embedded PostgreSQL 多連線測試。
- 真實 LINE／Email Auth、銀行測試商店付款、iPhone／LINE 實機。
- 遠端 required checks、正式 migration／服務版本核對。

資料庫 runtime 需另外配置，沒有因本次盤點而安裝相依套件。矩陣中的既有案例以程式斷言為證據，不能套用本次 155 項局部通過結果。
