# 發布前隔離結帳補驗｜2026-10-19

結論：本輪隔離結帳相關回歸通過。沒有修改產品邏輯、SQL或Preview付款開關，沒有正式資料庫寫入、銀行交易、commit／push或部署。**通過的是下列分層驗證，不是永豐真實收款或單一UI接真DB再接付款API的全鏈路驗收。**

## 實際結果

| 類型 | 結果 | 涵蓋範圍 |
|---|---|---|
| 本機 PostgreSQL17.6 | 4/4情境測試，0跳過，deadlocks0 | 1C定價／AUTO與MANUAL／OFF、2A快照、2B有效證據與Ledger、4雙錢包完整情境。這是4個大情境，不是僅4項斷言。 |
| 最新Schema離線重演 | 11檔、10次verify通過 | 來源為已保存正式catalog，只有結構／ACL與假資料；活動定價7函式保持一致、雙錢包付款退款smoke及最新扣款／自選提領Schema相容。沒有連雲端。 |
| API模擬 | 35/35，0跳過 | 付款金額契約、通知回呼驗證、逾時取消／重送、錯誤不得誤判成功。外部服務mock，非真銀行。 |
| Playwright | 60/60：桌面30、手機30 | 結帳6、人工收款3、付款快照恢復1、代客20，各跑兩種尺寸。DB／Auth／銀行API均mock。 |

資料庫情境已驗證無錢包、只購物金、只返饋金、雙錢包；促銷／優惠券後共同上限、不可折運費、NT$1界線、過期報價拒絕、角色失效、負餘額、建單失敗全交易回滾、保留／有效付款扣用／取消釋放／整筆退貨返還、防重複事件、失敗後retry重新保留、舊provider晚成功列異常並禁止啟用。

多連線涵蓋同帳戶兩單競爭保留、付款與取消、retry與舊回呼、收入／扣回與消費競爭；帳戶與Ledger累計一致、deadlocks=0。RLS／ACL實際角色直接讀寫拒絕斷言也通過。既有代客優惠券／購物金／贈品與付款分享回歸包含在情境與UI測試；未改代客可用返饋金規則。

## 執行方式與隔離

```sh
EMBEDDED_POSTGRES_MODULE=/private/tmp/eclado-commit-verify-tools/node_modules/embedded-postgres/dist/index.js \
node --test tests/integration/student-pricing-db.test.cjs tests/integration/student-reward-snapshots-db.test.cjs tests/integration/instructor-reward-ledger-db.test.cjs tests/integration/instructor-reward-checkout-db.test.cjs

node --test tests/integration/order-payment-amounts.test.mjs tests/integration/sinopac-notify.test.cjs tests/integration/sinopac-notify-crypto.test.cjs tests/integration/cancel-expired-orders.test.cjs

./node_modules/.bin/playwright test --config .playwright/release-checkout.config.ts
```

PG模組固定17.6.0-beta.15，實際二進位`postgres --version`回傳17.6，臨時cluster只listen 127.0.0.1，假Auth／假收款證據，不接受雲端DB連線字串。最新11檔重演命令沿用release checklist的private catalog路徑；私有catalog不提交。

臨時Playwright設定只啟動127.0.0.1:5196，`reuseExistingServer:false`、1 worker、0 retries、service worker block。為相容既有mock登入storage key，以production環境語義載入UI，但匿名key強制替換成無效假值，paymentMode=mock；銀行／Supabase請求皆以測試route.fulfill，未攔截外部請求經127.0.0.1:9無效proxy阻擋（只bypass localhost），**不是在本機啟用正式金流**。臨時設定在Git忽略`.playwright`內，不改既有Playwright／Vite產品設定。

首輪UI尚未執行測試便因webServer預設工作目錄為`.playwright`找不到Vite而停止；增加`cwd:process.cwd()`後完整60/60通過，沒有藉改產品程式消除失敗。測試時的Node module-type與Vite CJS警告未更改處理。本輪未改產品碼，因此沿用先前已完成的test Build472模組，不重複建置。

完整安全測試輸出與hash在 `docs/evidence/reward-checkout-isolated-20261019.json` 及其列出的4份log；舊stage7a或更早版本結果不能取代本次執行證據。

## 還未驗證

- 永豐真交易、真實失敗／晚回呼及信用卡退刷；未取得此類測試授權。
- 新Production deployment銀行API／金鑰載入、正式Outbox／備援／排程及監測，仍依release checklist列管。
- UI mock與真PostgreSQL是兩種分層測試，不冒稱一次真實全鏈路；Preview也仍未建單，付款OFF維持原樣。

本輪沒有發現需修產品程式的失敗，足以補上本機隔離結帳驗證證據；正式發布與啟用仍由使用者分別批准。
