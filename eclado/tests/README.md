# 測試執行方式

以下指令在 `eclado` 目錄執行。

| 指令 | 範圍 |
|---|---|
| `npm test` | 依序執行 Node、付款 API、Playwright；任一入口失敗即停止並回傳非零狀態。 |
| `npm run test:node` | 遞迴收集 `tests` 中的 `.test.cjs`／`.test.mjs`，使用 Node test runner。 |
| `npm run test:payment-api` | 執行 `payment-api` 的獨立 Node 測試。 |
| `npm run test:e2e` | 執行 `.spec.ts`，包含桌面 Chromium 與 Pixel 7 模擬。部分檔案是純函式／SQL 靜態斷言。 |
| `npm run test:list` | 只列出 Playwright 案例，不執行。 |
| `npm run test:integration` | 明確啟用外部 staging／付款整合，執行 `tests/integration` 的 Playwright 案例；不包含 Node SQL 測試。 |

例如，只跑桌面或特定 Node 案例：

```sh
npm run test:e2e -- --project=chromium
npm run test:node -- --test-name-pattern='member carts'
npm run test:list -- --project=chromium
```

## 檔案與共用 fixture

- Playwright 案例使用 `.spec.ts`，由 `playwright.config.ts` 明確限定。
- Node 案例使用 `.test.cjs`／`.test.mjs`；`scripts/run-node-tests.mjs` 收集它們，不依賴 shell glob 或 Playwright。
- 共用資料庫初始化放在 `tests/fixtures/*.cjs`，只匯出函式，不註冊測試。測試入口與 preview scripts 都直接匯入 fixture；不要由另一個 `.test.*`／`.spec.*` 匯入共用函式。
- fixture 本身不是獨立案例；對應 `.test.cjs` 保留原有斷言、skip 條件與 timeout。
- Node 入口以 `--import` 載入專用 bootstrap，讓 `src` 內的 JSON 匯入沿用 Vite 行為；其他模組仍由 Node 正常載入。需要 Node 20.6 以上。

## 條件執行與結果判讀

沒有配置隔離資料庫 runtime 時，Node SQL 與混合 SQL／瀏覽器案例仍會 skip。這次入口拆分沒有安裝或改變資料庫引擎，也沒有把 skip 改成通過。

`PGLITE_MODULE` 必須指向可用的 PGlite module；支援 `EMBEDDED_POSTGRES_MODULE` 的案例可使用獨立 PostgreSQL。某些多連線競爭分支只在 embedded PostgreSQL 執行，不能用 PGlite 的通過結果替代。

```sh
PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js npm run test:node -- --test-concurrency=2
PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js npm run test:e2e -- tests/recommendation-pricing-db.spec.ts
```

外部整合另需專用 staging 設定／受控付款訂單。`test:integration` 會設定 `RUN_STAGING_INTEGRATION=1` 與 `RUN_PAYMENT_INTEGRATION=1`；付款案例的預設 URL 是現有付款服務，請在受控驗收時明確設定測試端點及訂單。一般本機回歸不要啟用這些開關。

發布驗收必須分別記錄 pass、fail、skip 與未執行；入口分開不代表 CI 門檻或外部端到端已完成。完整覆蓋範圍見 [結帳風險矩陣](../docs/checkout-test-risk-matrix-2026-11-24.md)。

## 付款服務封裝檢查

```sh
node payment-api/verify-release.cjs /absolute/path/to/payment-api.tgz
```

檢查會在新的暫存目錄解開封裝、安裝正式依賴，並以隔離設定啟動服務。只呼叫本機 `/health` 及課程付款路由的無效輸入，不使用工作目錄的 `.env`、正式資料庫或銀行服務。服務及暫存目錄會在檢查結束後清理；缺少必要模組或路由時回傳非零狀態。

Payment API workflow 的 push／pull request 會執行測試與封裝檢查；正式金流部署仍限定原有的 `workflow_dispatch` 與 production environment 流程。本次沒有更動這項部署限制。
