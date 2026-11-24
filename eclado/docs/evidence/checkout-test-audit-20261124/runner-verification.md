# 測試入口拆分驗證

日期：2026-11-24，Asia/Taipei。以目前工作區執行，Node v24.16.0、Playwright 1.60.0；隔離 SQL 使用暫存安裝的 PGlite 0.6.0。沒有修改產品程式、SQL、套件依賴或 CI。

## 入口與共用程式

- Playwright `testMatch` 僅接受 `**/*.spec.ts`，73 檔、兩個 project 共 1,354 案例，可正常收集。
- `test:node` 遞迴收集 `tests` 中的 `.test.cjs`／`.test.mjs`，共 68 檔；`test:payment-api` 另執行付款目錄的 12 檔。
- `npm test` 依序呼叫三個入口，任一失敗就回傳非零狀態。三個入口本輪分別執行，沒有額外重複整條 `npm test`。
- 學員計價、雙錢包、師資採購及師生通知四個共用 fixture 搬到 `tests/fixtures/*.cjs`。測試及 preview scripts 直接匯入 fixture，不再匯入另一個測試入口。
- Node 專用 loader 讓測試載入 `src` 的 JSON 時沿用 Vite 行為；其他模組由 Node 載入。沒有更動 production 的 JSON import。
- 部分提領案例將多連線競爭明確拆成子測試：PGlite 跳過該子項，其餘單批限制、冪等重試、持有／退款、剩餘錢包與財務一致性照常驗證。

## 結果

| 執行 | 結果 |
|---|---|
| `npm run test:list -- --reporter=list` | 1,354 tests／73 files，exit 0；沒有 Node 檔案混入。 |
| `npm run test:node` | 190 pass、0 fail、48 skip。未配置隔離 DB runtime。 |
| `PGLITE_MODULE=… npm run test:node -- --test-concurrency=2` | 256 pass、0 fail、6 skip，約 4.7 分鐘。 |
| `npm run test:payment-api` | 107 pass、0 fail、0 skip。 |
| `npm run test:e2e -- --workers=4` 首輪 | 1,283 pass、20 fail、51 skip，約 14.3 分鐘。首次完整執行揭露過時斷言、fixture 問題與橫幅遮擋。 |
| 修正後 `npm run test:e2e -- --last-failed --workers=4 --reporter=line` | 原先 20 項全部 pass，約 24.8 秒。沒有再跑完整 1,354 項；本列與首輪結果分開記錄。 |
| `PGLITE_MODULE=… npm run test:e2e -- tests/recommendation-pricing-db.spec.ts --workers=1 …` 首輪 | 18 pass、2 fail。延遲預覽的案例仍假設原生確認對話框。 |
| 更新確認步驟後，同一個混合 SQL／瀏覽器檔完整重跑 | 20 pass、0 fail、0 skip，約 59.6 秒；含桌機／手機、5 種優惠與錢包組合、預覽延遲／完成。 |

計數包含 runner 的子測試，不能把不同輪次的 pass 全部相加。上述 SQL／瀏覽器案例原本位於 Playwright 首輪的 skip 中。付款與通知使用替身，沒有建立正式訂單、發起銀行付款或發送客戶訊息。

PGlite 本輪剩下的 6 個 skip：指定會員券相容案例、師生獨立 PostgreSQL 競爭案例、正式券相容離線重演、提領測試 fixture、完整批次提領營運案例，以及新拆出的雙連線提領子測試；它們仍需要 embedded PostgreSQL，不能視為通過。部分其他 fixture 的 embedded PG 分支也尚未執行。

## 測試維護修正

- 同額活動變更及延遲預覽改為檢查現行頁內金額確認提示；在確認前仍斷言 0 訂單、0 付款，確認後保留原有 SQL 快照／銀行應付額檢查。
- 課程計數以可及名稱核對筆數，不再假設畫面只含裸數字。
- 商品點擊改用具體的商品連結，避免圖片失敗後的替代文字造成 strict locator 衝突。
- 會員推薦加購核對會員專用購物車 cache，取代已不適用的訪客 key。
- 補上營業分析成本摘要的本機 mock，避免 mock token 被送往真實 RPC。成本專項仍可用自己的 route 覆寫。
- 內部錯誤測試使用英文內部錯誤訊息，保留泛用中文提示及不洩露原始錯誤斷言；沒有刪除錯誤不洩漏檢查。
- 付款失敗恢復檢查現行「原訂單保留／繼續付款」入口，仍禁止沿用舊付款頁連結。

## 入口拆分當時的產品風險與不穩定案例

後續更新：R23 已完成程式修正及首次會員自動回歸，詳見 [R23 修正驗證](r23-verification.md)。以下保留入口拆分當時的發現，不能視為最新修正狀態。

**R23 手機首次會員橫幅遮住確認按鈕。** 一般會員公司發票及購物金兩個 mobile 案例，Playwright click 多次被「美容師專業會員」橫幅攔截並逾時。產品尚未修正。這個檔案的既有交易案例改為明確使用已看過橫幅的回訪會員；因此重跑通過不代表首次會員結帳也通過。應另外修正橫幅與 checkout CTA 的空間，再補首次會員驗收。

**R22 手機捲動位置不穩定。** 390px 案例在全套中量到偏移 3.828125px，超過原 3px 斷言；單獨重跑及最後失敗案例重跑均通過。沒有放寬容許值，也沒有宣稱根因已修正。

原始錯誤摘錄保存在 [首輪失敗紀錄](runner-initial-browser-failures.json)。首次失敗用來保留問題來源，不代表入口修正後仍有同樣的 runner 錯誤。

## 重跑環境與限制

PGlite 安裝在 `/private/tmp/eclado-runner-db`，沒有加入專案依賴或改動 lockfile。對應設定：

```sh
PGLITE_MODULE=/private/tmp/eclado-runner-db/node_modules/@electric-sql/pglite/dist/index.js \
  npm run test:node -- --test-concurrency=2
```

Playwright／API 本機監聽曾受沙箱 EPERM 限制，取得權限後重跑；不把 EPERM 當產品失敗。外部 staging／銀行、embedded PostgreSQL、iPhone／LINE 實機、Node 20 CI 及遠端發布門檻尚未驗證。
