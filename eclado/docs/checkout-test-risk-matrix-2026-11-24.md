# ECLADO 結帳測試盤點與風險矩陣

盤點日期：2026-11-24，Asia/Taipei。

目前已有購物車、會員定價、優惠、雙錢包、付款恢復與部分資料庫競爭測試。本輪已拆分 Playwright 與 Node 入口，並抽離共用 fixture；全套執行結果見文末更新。R09 建單回應遺失已完成程式與隔離驗證，正式 SQL／schema cache／前端已依序發布並驗收；後續仍需真實銀行交易及 iPhone／LINE 操作。已有測試的交易規則，也需要固定發布檢查才能持續提供保護。

## 範圍與判讀方式

- 以目前 `main` 工作區為準，基底 HEAD 為 `bdbb9990bea6824bc889253f94e406e8397bf4dc`；包含已修改與尚未追蹤檔案。案例存在於本機，不表示已提交、已部署或近期在 CI 通過。
- 掃描 `tests` 及 `payment-api` 共 153 個測試檔：73 個 Playwright 檔、80 個 Node 測試檔。依交易關聯分為直接或跨流程相關 97 檔、相鄰營運流程 29 檔、其他 27 檔。這是檔案分類，不是覆蓋率。
- 一般商品、會員／訪客、代客下單、課程付款均納入；出貨、取消、退貨及通知列為交易後續，相鄰財務／會員流程另列索引。
- [逐檔索引](checkout-test-inventory-2026-11-24.md) 列出全部測試檔與案例宣告位置；[JSON 清單](checkout-test-inventory-2026-11-24.json) 包含檔案 SHA256、runner、條件與工作區狀態，方便之後比較。這份逐檔索引與 SHA256 保留原始盤點快照；本輪搬移後的位置見 `tests/fixtures` 與文末入口修正更新。
- 「已覆蓋」表示讀到對應斷言，不表示完整系統或所有組合已通過；本次實際執行結果獨立列於後段。
- 「缺口」限於這次盤點未找到的完整證據，不直接判定產品必定有 bug。未連線檢查 GitHub 分支保護、Vercel 設定、正式 schema 或實際客戶交易，因此遠端強制檢查與部署一致性仍待核對。

優先級依交易影響、影響範圍、目前證據強度及發現難度排序；沒有可靠事故分母，故不虛構發生機率或風險分數。P0 為下一輪優先處理的交易／驗收風險，P1 為其後補強，P2 為擴充。

## 測試入口與剩餘執行限制

| 入口 | 目前行為 | 風險與處置 |
|---|---|---|
| `npm test` | 依序跑 `test:node`、`test:payment-api`、`test:e2e`，失敗即停止 | 原先混用 runner 的問題已修正；不是 CI required check 已配置。 |
| `npm run test:e2e`／`test:list` | Playwright `testMatch` 限定 `**/*.spec.ts`；單一 Chromium project 收集 677 案例、73 檔 | 不再收進 Node 檔；實際執行與 skip 見文末更新。 |
| `npm run test:node` | 遞迴收集 `.test.cjs`／`.test.mjs`；以 Node 執行，並為 `src` JSON 提供測試載入支援 | 資料庫案例仍依 runtime 條件執行；固定 runtime 與多連線工作尚未接到 CI。 |
| `npm run test:integration` | 明確設定兩個 RUN 開關，只跑 `tests/integration` 的 Playwright 案例 | 現在不再混入 Node；仍不等於 Node SQL 全套，缺設定時仍可 skip。 |
| `npm run test:transactions` | 保留通知／crypto／提醒／逾期與付款 API 局部入口 | 不包含一般瀏覽器與大部分隔離 SQL。完整本機入口改用 `npm test`。 |
| `npm run test:payment-api` | 明確轉交 `payment-api` 的 `node --test` | 銀行、Supabase 使用替身，不能當成真實銀行驗收。 |
| 隔離 SQL 測試 | 多數須指定 `PGLITE_MODULE` 或 `EMBEDDED_POSTGRES_MODULE` | 兩個 runtime 未列在前端 package 的 devDependencies；本輪另在暫存目錄安裝 PGlite 0.6.0 驗證，沒有新增專案依賴。缺少時常以 skip 結束。應提供固定安裝版本與獨立必跑工作。 |
| 真實 PostgreSQL 競爭分支 | 部分在 `if (process.env.EMBEDDED_POSTGRES_MODULE)`／`if (db.connect)` 內 | PGlite 主測試通過時，競爭分支可能沒有執行，且不一定以獨立 skip 顯示。需拆成可識別的工作與結果。 |
| repo 內 GitHub workflow | 目前僅發現 `payment-api-release.yml`；對付款 API 路徑變更跑 API tests、runtime 封裝啟動檢查 | 未見一般前端／SQL 改動必跑的結帳工作，也未見 nightly 結帳排程。遠端 required checks 是否另有設定，仍待核對。 |

設定證據：[package.json](../package.json)、[Playwright 設定](../playwright.config.ts)、[付款 API package](../payment-api/package.json)、[GitHub workflow](../../.github/workflows/payment-api-release.yml)。修正前本機 Playwright 預設 testMatch 包含 `.test.cjs`；歷史收集錯誤摘要見 [本次驗證紀錄](evidence/checkout-test-audit-20261124/verification.md)。

## 其他驗證資產與歷史證據

下列資產不包含在 153 個測試檔的計數，不能因檔名有 verify／acceptance 就當作日常會執行。

| 資產 | 已有用途 | 限制 |
|---|---|---|
| `supabase-*-verify.sql` | 報價、coupon、gift、會員價、雙錢包、付款 ACL、事件診斷等安裝／權限查核 | 部分由隔離 DB tests 呼叫，部分需人工執行；schema／函式存在不代表使用者流程可完成。 |
| [reward-production-preflight.cjs](../scripts/reward-production-preflight.cjs)、[reward-stage7a-schema-check.cjs](../scripts/reward-stage7a-schema-check.cjs)、[check-reward-staging-upgrade.cjs](../scripts/check-reward-staging-upgrade.cjs) | catalog 離線重演、安裝順序與升級相容性檢查 | 需要額外 runtime／catalog；未接到一般結帳預設指令。歷史正式設定重演已存在，缺的是可持續、對應最新版本的執行流程。 |
| [reward-acceptance-local.mjs](../scripts/reward-acceptance-local.mjs)、[reward-acceptance-full.mjs](../scripts/reward-acceptance-full.mjs)、[reward-acceptance-smoke.mjs](../scripts/reward-acceptance-smoke.mjs) | 一次性本機 PostgreSQL 驗收站、UI、錢包與通知收件匣 | 假登入／假銀行／假 provider，依賴特定本機 server；不等於真實 Auth／REST／銀行端到端，亦不自動成為發布檢查。 |
| [real-notification-test.cjs](../scripts/real-notification-test.cjs) | 專用帳號與收件人的真實通知驗收 | 可發送外部訊息且可能寫測試 DB；本輪未執行，不宜混入無隔離資料的通用 smoke。 |
| [recommendation-pricing-validation.md](recommendation-pricing-validation.md)、[member-cart-production-2026-11-18.md](member-cart-production-2026-11-18.md)、[reward-release-checklist-2026-10-19.md](reward-release-checklist-2026-10-19.md) 及既有 evidence | 過往加購、會員購物車、財務升級與發布驗收紀錄 | 證明當時指定版本／環境做過的檢查；不能代表目前工作區或下一次發布仍通過。 |

## 結帳風險矩陣

證據層級：**靜態**檢查原始碼／SQL 字串；**規則**執行函式；**UI 模擬**操作瀏覽器但攔截後端；**隔離 SQL**執行 repository SQL，但 schema／部分依賴為測試建置；**混合**將瀏覽器 RPC 導向隔離 SQL；**外部整合**呼叫設定的服務。完整端到端需要同一筆交易跨實際前端、Auth、RPC、付款服務及付款確認。

| ID 與流程 | 已覆蓋與代表證據 | 主要缺口及交易影響 | 優先級 |
|---|---|---|---|
| R01 測試執行與發布 | API tests、runtime 打包、候選健康失敗回復；D01 | 收集入口已修正，共用 fixture 已抽離；UI／DB 仍未形成共同發布門檻，重要 skip 仍需識別。任何結帳改動都可能缺少驗收。 | P0 |
| R02 訪客與會員購物車 | UI 模擬：登入合併、離線重放、全新 context、跨分頁、登出切帳號、結帳後扣已購數量；規則＋隔離 SQL：去重、所有權、原子驗證；C01 | UI 的 server 行為使用相同 `applyCartOperation` 函式，存在共同假設；尚缺真實 Auth／REST 串接與會員購物車多連線競爭。可能還原錯量、遺失品項。 | P1 |
| R03 初載身分與背景刷新 | UI 模擬：等待角色再校驗院線商品；結帳保留同一 input；申請原選檔 input 保持 mounted；C02 | 尚缺結帳填寫中 token refresh 失敗／401、visibilitychange、跨分頁登出、付款請求途中換帳號的整組驗收；實機背景返回未重跑。可能清空表單或沿用舊身分。 | P0 |
| R04 LINE／Email 登入往返 | LINE callback 的 state、帳號綁定 handler 測試；UI 模擬返回 checkout／cart／course；外部 Email 整合另有開關；C03 | UI 返回路由案例沒有完成真實 LINE OAuth 再下單；缺 iPhone LINE 的 cookie／storage／跨頁往返驗收。可能登入完成卻無法續購。 | P0 |
| R05 會員價格與小數取整 | 規則、UI 模擬、隔離 SQL：商品倍率優先、六種原身分／學員價、18 品項 23 件、半元邊界、權威價格；Q01 | 未見每日以去識別化的實際設定重播；大購物車／不同角色＋活動＋運費邊界組合仍有限。可能反覆出現價差確認。 | P1 |
| R06 變價與最後一步加購 | UI 模擬：二次變價、返回保留資料、連點、同額活動分配改變；混合：5 種加購／優惠／錢包組合，各含預覽延遲／完成；Q02 | 此混合測試需 runtime；身分、目錄與銀行仍模擬。缺實際 REST 的 schema cache、權限與版本組合驗收。 | P1 |
| R07 活動券與受眾 | 隔離 SQL：自動分配、買贈、指定會員券、學員互斥政策、快照／回滾；獨立 oracle 對照 SQL，含 35＋70 組 seed；Q03 | 不是毫無性質／差分測試。仍缺跨獨立 DB 連線搶最後券額度／贈品、活動到期與提交並發、完整開關組合。可能超用、錯拒或回滾不完整。 | P1 |
| R08 購物金與返饋金 | UI 模擬＋隔離 SQL：共同至少付 1 元、額度／身分限制、reservation→consume／release／refund、故障回滾、銀行淨額；W01 | 競爭分支須 embedded PG；缺同筆交易經 HTTP callback、實際 SQL、庫存／券／雙錢包最終結果共同核對。 | P1 |
| R09 一般建單回應遺失 | **已重現並修正。** 原 4 項會重複建單；新增同請求 SQL 冪等保證及查回原單。訪客／會員／雙錢包 retry／reload 共 12 項通過；原生 PG 獨立連線、權限、優惠與額度測試 8 項通過；O01 | 正式 migration、schema cache 與前端已完成發布，六項權限驗證、原函式指紋、正式 SQL 交易內重播／恢復及正式資產瀏覽器驗收通過；實機與真實銀行交易仍待驗收。舊版未帶 key 的請求、清除恢復憑證不涵蓋；不得盲目重建。見[實作與驗證](checkout-order-idempotency.md)。 | 已上線；自動驗收通過；待實機／銀行 |
| R10 金流建立與連結續期 | UI 模擬＋API HTTP 模擬：長備註、錯誤欄位、ATM 3 萬、保留期限、timeout／empty／duplicate／missing URL、同單同時續期、銀行已付款擋重建；P01 | 銀行與 DB 行為為替身；`payment.spec.ts` 只驗證已有訂單可取得卡／ATM 付款入口，沒有完成付款。缺封裝版服務跨真實 REST 的流程。 | P0 |
| R11 信用卡與行動支付使用 | UI 模擬：同分頁付款、Apple／Google Pay mapping、結果憑證；API 模擬有效付款證據；P02 | 缺真實 3DS、使用者取消／返回、iPhone Apple Pay 與 LINE 外開；mobile-chrome 是模擬。可能測試有連結但顧客無法完成。 | P0 |
| R12 回站與付款回呼 | handler／API HTTP 模擬：拒絕錯訂單、驗商戶／幣別／分金額、延遲 pending、舊回呼不覆寫已付、重試 provider 對應；P03 | 缺同筆交易通過實際 callback HTTP→DB trigger→庫存／券／錢包的整合，以及程序在各持久化邊界崩潰後的復原。 | P1 |
| R13 刷新與重試恢復 | UI 模擬：卡／ATM 暫存、逾期／取消清除、原單重新付款、無原 session 的限時憑證、雙錢包快照恢復；P04 | storage 封鎖案例主要測 telemetry key；付款主暫存全不可用、瀏覽器被系統終止、舊前端新 API 尚無完整矩陣。可能失去續付入口。 | P1 |
| R14 逾期取消與晚到收款 | mocked cron：付款競爭時不誤報取消；雙錢包隔離 SQL：paid/cancel、舊回呼／retry 競爭；L01 | 已有局部競爭，不能列為完全沒測。缺實際排程 handler＋一般／ATM 訂單 SQL＋晚到銀行收款的共同驗收；需核對人工處理與通知。 | P1 |
| R15 現貨預購與庫存 | 靜態＋隔離 SQL：不負庫存、付款才配置、部分配置、重複 paid 不重扣、取消／退貨回補、FIFO；staging 測試另有開關；L02 | 舊 staging 案例直接寫 `products.stock`、無規格、以 service role 改狀態，不能代表現行公開建單／付款配置；缺最後現貨＋預購允許規則的雙連線驗收。 | P1 |
| R16 專業門檻與合併出貨 | UI 模擬：5 千起購、已付 open group 追加免運；14 個 SQL 靜態宣告；部分 DB fixture 執行 shipping prepare；L03 | 未找到整段 open→追加→鎖定→付款→滿額退首單運費的真實 SQL 專項；缺同時達 1.5 萬只退一次、舊 pending 付款、取消警示的完整生命週期。 | P1 |
| R17 代客下單 | UI 模擬＋API 模擬＋隔離 SQL：request key 同單恢復、權限、客戶同意錢包、並發建單、AUTO／MANUAL、私人連結；A01 | 一般建單不能借用此處的冪等保證；缺實際連結經 Auth／REST／付款服務的一筆交易驗收。 | P1 |
| R18 課程報名付款 | UI 模擬＋隔離 SQL＋route handler：免費／付費、代報名、LINE 返回、付款權限／淨額、同 key 去重、過期收款 review、單人取消；A02 | 缺真實服務串接與對應實機支付；課程付款有獨立訂單／callback，商品測試通過不代表課程成功。 | P1 |
| R19 付款與出貨通知 | handler 模擬：重送／fallback／已付缺收件紀錄補送；DB outbox／lease／去重另有條件測試；N01 | 缺一次 HTTP 付款事件跨真正 SQL outbox 與受控收件匣的共同驗收；實際送信腳本非預設測試。訂單成功時仍可能沒收到查詢入口。 | P1 |
| R20 觀測與診斷 | UI 模擬＋handler＋隔離 SQL：flow／attempt、去重、privacy、限流、日誌失敗不擋結帳；診斷 API 替身；D02 | repo 有觀測基礎，但未見結帳階段成功率／異常未付款積壓的自動告警測試；缺跨實際版本的完整追蹤驗收。不能只靠缺事件推斷未建單。 | P1 |
| R21 部署與 schema 相容 | API：缺 reward 欄位才 fallback、其他錯誤不可降級、schema cache 恢復；部署 script：缺模組擋下、候選 health 失敗回復；D01 | 全站 UI 多以 Vite dev server 測試；缺實際 build／前端、API 與 migration 版本組合、公開 DNS／TLS／CORS／callback 路由的發布驗收。 | P0 |
| R22 效能與可操作性 | 規則：分配搜尋預算拒絕；UI：320／390／1280 寬度摘要；Q02／Q03 | 390px 手機捲動斷言在全套曾失敗，單獨及失敗集重跑通過，未調寬門檻；根因未解。另缺目標負載／p95、pool 壅塞／429 及鍵盤完整路徑。 | P2 |
| R23 首次會員手機橫幅 | **程式與自動回歸已完成。** checkout 不渲染申請邀請；首次會員公司發票、購物金、背景刷新、延遲資格查詢、返回及重新整理共 6 項通過；相關回歸 18 項通過。[驗證紀錄](evidence/checkout-test-audit-20261124/r23-verification.md) | 不修改邀請資格或已看過狀態，離開結帳仍可顯示；正式資產 Chromium／手機模擬已驗證，iPhone／LINE 實機尚待確認。原始遮擋證據保留。 | 已上線；待 iPhone／LINE 實機 |

## 證據索引

以下是矩陣中的主要證據；逐項案例宣告與其餘相鄰檔案見逐檔索引。

| 代號 | 測試來源與重點位置 |
|---|---|
| C01 | [member-cart.spec.ts](../tests/member-cart.spec.ts) L37、67、92、107、152；[unit/member-cart.test.mjs](../tests/unit/member-cart.test.mjs) L43–151；[member-cart-db.test.cjs](../tests/integration/member-cart-db.test.cjs) L7。UI backend 於 L26 使用 production `applyCartOperation`。 |
| C02 | [eclado-frontend.spec.ts](../tests/eclado-frontend.spec.ts) L630 角色未載入保留購物車；[member-cart.spec.ts](../tests/member-cart.spec.ts) L92 保留 input 身分；[professional-registration.spec.ts](../tests/professional-registration.spec.ts) L200 原選檔欄位 mounted；[checkout-price-confirmation.spec.ts](../tests/checkout-price-confirmation.spec.ts) L105。 |
| C03 | [eclado-frontend.spec.ts](../tests/eclado-frontend.spec.ts) L297／313；[line-handler.test.cjs](../tests/integration/line-handler.test.cjs)；[auth-email.spec.ts](../tests/auth-email.spec.ts)；[email.spec.ts](../tests/integration/email.spec.ts)、[email-click.spec.ts](../tests/integration/email-click.spec.ts) 為有條件外部整合。 |
| Q01 | [member-price-rounding.spec.ts](../tests/member-price-rounding.spec.ts)；[member-pricing.spec.ts](../tests/member-pricing.spec.ts)、[member-pricing-db.test.cjs](../tests/integration/member-pricing-db.test.cjs)；[student-pricing.spec.ts](../tests/student-pricing.spec.ts)、[student-pricing-db.test.cjs](../tests/integration/student-pricing-db.test.cjs)；[cart-minimum-preview-db.test.cjs](../tests/integration/cart-minimum-preview-db.test.cjs)。 |
| Q02 | [checkout-price-confirmation.spec.ts](../tests/checkout-price-confirmation.spec.ts)；[automatic-price-allocation.spec.ts](../tests/automatic-price-allocation.spec.ts) L38；[product-recommendations.spec.ts](../tests/product-recommendations.spec.ts) L132／217／252；[recommendation-pricing-db.spec.ts](../tests/recommendation-pricing-db.spec.ts) L7、beforeAll、L69 起五組組合；[歷史驗證](recommendation-pricing-validation.md)。 |
| Q03 | [automatic-price-allocation-db.test.cjs](../tests/integration/automatic-price-allocation-db.test.cjs) L59–105 獨立 oracle 與 seed；[oracle 合約](../tests/integration/automatic-promotion-allocation-contract.test.cjs) 只測參考解，須配合 SQL 對照；[buy-x-get-y-db.test.cjs](../tests/integration/buy-x-get-y-db.test.cjs)；[promotion-student-policy-db.test.cjs](../tests/integration/promotion-student-policy-db.test.cjs)；[promotion-multi-gifts.test.cjs](../tests/integration/promotion-multi-gifts.test.cjs) 部分底層 SQL 使用 stub；[coupon-member-create-compat.test.cjs](../tests/integration/coupon-member-create-compat.test.cjs)。 |
| W01 | [instructor-reward-checkout.spec.ts](../tests/instructor-reward-checkout.spec.ts)；[instructor-reward-checkout-db fixture](../tests/fixtures/instructor-reward-checkout-db.cjs) 最低 1 元、回滾與 embedded PG 競爭；[Node 入口](../tests/integration/instructor-reward-checkout-db.test.cjs)；[student-reward-snapshots-db.test.cjs](../tests/integration/student-reward-snapshots-db.test.cjs) L162 起獨立連線／價格競爭；[reward-payment-persistence.test.cjs](../payment-api/reward-payment-persistence.test.cjs)。 |
| O01 | [SQL commit 後丟棄回應](../tests/checkout-order-response-loss.spec.ts)、[恢復防護](../tests/checkout-order-recovery.spec.ts)、[SQL 與獨立連線](../tests/integration/checkout-order-idempotency-db.test.cjs)、[儲存／身分隔離](../tests/unit/checkout-request.test.mjs)；[migration](../supabase-checkout-order-idempotency.sql) 與[唯讀 verify](../supabase-checkout-order-idempotency-verify.sql)。既有 [checkout-events](checkout-events.md) 仍只提供診斷，不作為恢復憑證。 |
| P01 | [payment-link-renewal.spec.ts](../tests/payment-link-renewal.spec.ts)；[payment-link-renewal.test.cjs](../payment-api/payment-link-renewal.test.cjs) L122–277；[payment-link-renewal-db.test.cjs](../tests/integration/payment-link-renewal-db.test.cjs) L14；[payment.spec.ts](../tests/integration/payment.spec.ts) L35–75 的 opt-in／受控訂單門檻；[server.test.cjs](../payment-api/server.test.cjs) L295–440 權威應付額。 |
| P02 | [eclado-frontend.spec.ts](../tests/eclado-frontend.spec.ts) L2066、2112、2152；[payment-return-auth.test.cjs](../payment-api/payment-return-auth.test.cjs)。 |
| P03 | [sinopac-notify.test.cjs](../tests/integration/sinopac-notify.test.cjs)、[sinopac-notify-crypto.test.cjs](../tests/integration/sinopac-notify-crypto.test.cjs) 真正 crypto 搭模擬 bank response；[payment-return-auth.test.cjs](../payment-api/payment-return-auth.test.cjs) L184–272；[reward-payment-evidence.test.cjs](../payment-api/reward-payment-evidence.test.cjs)。 |
| P04 | [eclado-frontend.spec.ts](../tests/eclado-frontend.spec.ts) L1523–1632、2200、2547–2805；[order-wallet-payment-merge.spec.ts](../tests/order-wallet-payment-merge.spec.ts)；[order-payment-amounts.test.mjs](../tests/integration/order-payment-amounts.test.mjs)。 |
| L01 | [cancel-expired-orders.test.cjs](../tests/integration/cancel-expired-orders.test.cjs) L222；[instructor-reward-checkout-db fixture](../tests/fixtures/instructor-reward-checkout-db.cjs) paid/cancel、retry/old callback 分支；[course-registration-db.test.cjs](../tests/integration/course-registration-db.test.cjs) 過期付款 review。 |
| L02 | [inventory-sql.spec.ts](../tests/inventory-sql.spec.ts) 為靜態文字檢查；[assisted-orders-db.test.cjs](../tests/integration/assisted-orders-db.test.cjs) 實際庫存配置／回補；[product-costs-db.test.cjs](../tests/integration/product-costs-db.test.cjs) FIFO 與 shortage；[staging-inventory.spec.ts](../tests/integration/staging-inventory.spec.ts) L26–93 是舊 product-level fixture。 |
| L03 | [professional-shipping-groups-sql.spec.ts](../tests/professional-shipping-groups-sql.spec.ts)；[eclado-frontend.spec.ts](../tests/eclado-frontend.spec.ts) L734／771；[cart-minimum-preview-db.test.cjs](../tests/integration/cart-minimum-preview-db.test.cjs) append minimum；[student-pricing-db fixture](../tests/fixtures/student-pricing-db.cjs) 安裝部分 shipping prepare，不等於全套 shipping-group lifecycle。 |
| A01 | [assisted-orders.spec.ts](../tests/assisted-orders.spec.ts) L132；[assisted-orders.test.cjs](../payment-api/assisted-orders.test.cjs) L45–102；[assisted-orders-db.test.cjs](../tests/integration/assisted-orders-db.test.cjs)；[student-reward-snapshots-db.test.cjs](../tests/integration/student-reward-snapshots-db.test.cjs) L226 同 key 並發；[assisted-member-link-db.test.cjs](../tests/integration/assisted-member-link-db.test.cjs)。 |
| A02 | [course-registration.spec.ts](../tests/course-registration.spec.ts)；[course-registration-db.test.cjs](../tests/integration/course-registration-db.test.cjs)；[course-shopping-credit-db.test.cjs](../tests/integration/course-shopping-credit-db.test.cjs)；[course-payments.test.cjs](../payment-api/course-payments.test.cjs) 為注入依賴的 route handler，沒有實際掛載 HTTP server／銀行。 |
| N01 | [server.test.cjs](../payment-api/server.test.cjs) L77–209；[sinopac-notify.test.cjs](../tests/integration/sinopac-notify.test.cjs) L493–616；[order-email.test.cjs](../tests/integration/order-email.test.cjs)；[instructor-reward-notifications-db.test.cjs](../tests/integration/instructor-reward-notifications-db.test.cjs)；[real-notification-test.cjs](../scripts/real-notification-test.cjs) 會對外寄送，非本次重跑範圍。 |
| D01 | [deploy-release.test.cjs](../payment-api/deploy-release.test.cjs) L48–69；[reward-schema-compatibility.test.cjs](../payment-api/reward-schema-compatibility.test.cjs)；[verify-release.cjs](../payment-api/verify-release.cjs)；[workflow](../../.github/workflows/payment-api-release.yml)。 |
| D02 | [checkout-events.spec.ts](../tests/checkout-events.spec.ts)；[checkout-events.test.cjs](../tests/integration/checkout-events.test.cjs)、[checkout-events-db.test.cjs](../tests/integration/checkout-events-db.test.cjs)；[sinopac-diagnostics-integration.test.cjs](../payment-api/sinopac-diagnostics-integration.test.cjs) 名稱有 integration，但外部 fetch 仍模擬；[payment-diagnostics-db.test.cjs](../tests/integration/payment-diagnostics-db.test.cjs)。 |

## 優先補強順序與完成條件

每一項均以可檢查的結果作為完成條件；本輪已落實入口拆分與 fixture 搬移；其他項目仍為待辦，尚未修改產品邏輯或 CI。

| 順序 | 工作 | 完成條件 | 主要層級 |
|---|---|---|---|
| 1 | runner 拆分已完成；後續固定 DB runtime 與必跑範圍 | Playwright 僅收集自己的入口；Node 測試獨立執行；fixture 不再由測試入口匯入；全套收集成功。DB／競爭／外部整合各有明確 pass、fail、not-run；發布必要工作缺環境即失敗，不默默 skip。 | 測試基礎設施 |
| 2 | R09 已部署與自動驗收，待實機／銀行 | 對一般與雙錢包建單執行實際 SQL COMMIT 後丟棄回應，驗證再次點擊、重整、另一分頁；核對訂單數、券額度、贈品／錢包保留。結果未知時先查原單且保留同 key；本輪已確認 SQL 鎖定、回滾、憑證及持有量，發布仍須先 DB 後前端並核對目標環境。 | 瀏覽器＋SQL 故障注入 |
| 3 | 建立實際 build 的跨服務交易核心驗收 | 一筆交易跨隔離 Auth／REST、真實應用與封裝付款 API；銀行先用受控替身。至少涵蓋訪客卡、會員 ATM、專業追加單、學員優惠、師資雙錢包、代客、課程。核對 DB 最終狀態及金額。另以供應商測試環境獨立驗證外部契約。 | 跨服務端到端 |
| 4 | 將核心驗收接到 PR／發布 | 前端、auth、cart、SQL、API 共用改動都觸發對應工作；固定核心回歸必跑；發布測試指向同一 revision／build；保留必要結果與 artifact；查證遠端 required checks。 | CI 與發布 |
| 5 | 補身分刷新與真實行動裝置驗收 | 結帳兩步各測 focus／visibility／token refresh、401、登出切帳號、慢回應；同會員表單保持 mounted，換身分重驗資格。加入 WebKit 自動測試，iPhone Safari／LINE 實機測登入、3DS 返回、背景返回與原生選檔。 | UI 狀態與實機 |
| 6 | 固定 embedded PG 的交易競爭工作 | 明確執行現有 wallet paid/cancel、retry/old callback、price race；補最後贈品／券額度、兩個一般付款流程、付款與取消 handler 並發。每項使用獨立連線，驗證 final ledger、庫存與零重複副作用。商品可預購時依既有規則檢查配置，不能把允許預購當成超賣 bug。 | 真實 PostgreSQL 多連線 |
| 7 | 補合併出貨與舊版 staging fixture | 建立完整 shipping-group SQL lifecycle：5 千／1.5 萬上下邊界、鎖定前 pending、同時達門檻只退一次、取消後人工警示。更新 staging 測試走當前公開 RPC、規格與實際付款證據。 | SQL 與 staging |
| 8 | 發布環境一致性與事故回流 | 核對前端 build、API runtime、SQL 安裝版本；驗證 DNS／TLS／CORS／callback 路由；以前一版仍開著的頁面測新服務。為 timeout、未能續付、付款狀態長期 pending 設可測告警，保留去識別化事故 fixture。 | 部署與觀測 |
| 9 | 擴大組合與效能驗收 | 固定角色×付款×優惠×環境矩陣；擴大現有 oracle 對照，加入 transaction invariant、目標負載與鍵盤操作。先定義可接受延遲、資料規模與交易規則，再做測量。 | P2 擴充 |

第 3、4 項應以小組核心案例先接通，再逐步擴大；不必等所有組合完成才建立發布門檻。外部測試使用專用測試商店／帳號與資料，不把正式付款當作日常自動 smoke。

## 建議固定的交易驗收組合

下表為待落實的驗收清單，不代表目前皆已端到端通過。

| 路徑 | 核對重點 | 正常路徑以外必測的中斷 |
|---|---|---|
| 訪客＋信用卡 | 建單、查詢碼、同分頁支付、權威結果 | 建單回應遺失、3DS 取消、無原 session 回站 |
| 一般會員＋ATM＋購物金 | 銀行淨額、帳號、期限、續付入口 | API timeout、逾期匯入、通知晚到 |
| 專業會員＋追加單 | 5 千門檻例外、免運與批次關聯 | 批次同時鎖定、跨 1.5 萬退運費、取消 |
| 學員＋活動／指定券 | 受眾、學生價互斥、快照與核銷 | 結帳中換綁／改價、最後額度競爭 |
| 師資＋雙錢包 | 共同付款下限、保留／核銷／釋放 | 查詢後餘額改變、retry 與舊 callback 競爭 |
| 代客＋會員同意 | 同一 request key、私人連結與指定折抵 | 同意後斷線、重複開連結、金流未知結果 |
| 課程＋混合報名 | 付款人權限、免費師資＋付費學員、單人取消 | 連點報名、逾期收款、LINE 返回 |

## 原始盤點驗證結果

| 檢查 | 結果 | 能支持的結論 |
|---|---|---|
| 預設 Playwright `--list --project=chromium` | exit 1，29 則「test file should not import test file」，0 tests | 預設入口目前無法完成收集，已重現。 |
| 限定 `.spec.ts` 的同一收集 | exit 0，677 tests／73 files | Playwright 案例可以分離收集；沒有啟動瀏覽器或宣稱 UI 通過。 |
| 6 個本機 Node 檔 | 48 pass，0 fail，0 skip | 購物車規則、金額快照、付款通知／crypto、逾期取消、事件 ingress 的局部行為通過。 |
| 付款 API `npm test` | 107 pass，0 fail，0 skip | 規則、替身 HTTP、代客／課程 handler、診斷及模擬發布腳本通過。最初沙箱禁止 localhost listen；允許本機監聽後重跑成功，非產品失敗。 |
| 隔離 SQL／embedded PG 深度測試 | 本次未執行 | runtime 未配置；矩陣中的覆蓋依程式斷言判斷，歷史通過紀錄另列來源。 |
| 真實銀行、外部 Auth、iPhone／LINE、正式部署 | 本次未執行 | 本次沒有建立正式訂單、發起銀行付款、發送客戶通知或改動部署。 |

本次 Node 版本為 `v24.16.0`；workflow 設定 Node 20，故本機通過仍不能替代 Node 20 CI 結果。可重跑指令、失敗摘錄與限制見 [驗證紀錄](evidence/checkout-test-audit-20261124/verification.md)。

## 入口修正後驗證更新

本輪已完成 Playwright／Node 分離、四個共用 fixture 抽離、Node 前端 JSON 載入支援與過時測試維護；產品程式、SQL、CI 與專案相依套件沒有改動。執行方式見 [測試 README](../tests/README.md)。

| 驗證範圍 | 最新結果 |
|---|---|
| Playwright 收集 | 1,354 案例、73 檔，沒有 Node 混入／互相匯入錯誤。 |
| Node 不配置 DB | 190 通過、0 失敗、48 跳過。 |
| Node 配置暫存 PGlite 0.6.0 | 256 通過、0 失敗、6 跳過；embedded PG 分支尚未執行。 |
| 付款 API | 107 通過、0 失敗、0 跳過。 |
| Playwright 全套首輪 | 1,283 通過、20 失敗、51 跳過；首輪失敗內容已保留。 |
| 修正後原 20 個失敗案例 | 20 全數通過；沒有再宣稱完整 1,354 項在修正後重跑。 |
| 混合 SQL／瀏覽器完整重跑 | 20 通過、0 失敗、0 跳過。 |

完整指令、6 項 DB skip、測試維護內容及新產品風險見 [入口拆分驗證](evidence/checkout-test-audit-20261124/runner-verification.md)。R01 的入口問題已解決，固定 runtime／CI required checks／發布門檻仍待完成；R09 後續修正見文末；真實端到端與實機缺口繼續保留。R23 後續已補首次會員回歸並修正顯示條件，結果見下一節；原入口拆分的歷史結果維持原記錄。

## R23 修正後驗證更新（發布前紀錄）

固定底部申請邀請原本只排除登入頁與打開的購物車，仍會覆蓋結帳的確認按鈕。本輪在 `src/app/App.jsx` 加入 checkout 頁面排除條件，保留原有邀請資格及狀態，沒有寫入已看過標記，也沒有更動共用會員狀態。

新 [首次會員回歸](../tests/checkout-first-member-banner.spec.ts) 先在修正前重現失敗，修正後桌機／手機模擬共 6 項全部通過；另 18 項相關回歸全部通過。測試以普通點擊完成公司發票與購物金結帳，核對一次建單、付款應付額，並驗證背景刷新不卸載原 input、延遲查詢不插入邀請、離開後仍可顯示邀請，以及返回／重整後不再遮擋。

詳細範圍與重跑指令見 [R23 驗證紀錄](evidence/checkout-test-audit-20261124/r23-verification.md)。R23 程式與自動回歸已完成；尚未部署，亦未以 iPhone Safari／LINE 實機驗收。其餘矩陣項目與原始盤點快照維持原範圍。

## R09 修正後驗證更新（發布前紀錄）

先以隔離 SQL 的 autocommit 真正建立訂單，再丟棄 HTTP 回應。修正前訪客／會員各自 retry／reload 的 4 項都多建一單；修正後改由保留的隨機識別碼、恢復憑證與預期登入身分，在同一 SQL 交易內去重與保存原結果。查回失敗時不允許盲目重送；確認沒有記錄後仍沿用同 key，以防原請求只是晚到。

驗證已涵蓋訪客、會員、雙錢包搭配優惠券與贈品的 12 項 SQL／瀏覽器情境。相關瀏覽器套件 75 通過、1 項既有條件跳過，另 14 項恢復防護通過；原生 PostgreSQL 獨立連線、重播、權限、額度與回滾 8 項全通過。Node 預設全套為 196 通過、49 項條件跳過；test mode build 通過。本輪未重跑完整全站或連線正式服務。

[R09 實作與驗證](checkout-order-idempotency.md) 記錄 migration、唯讀 verify、部署／回復及適用邊界。程式尚未部署，正式使用前必須先套用 SQL 並更新 PostgREST schema cache，才可發布前端；舊版分頁及失去憑證的歷史請求仍須查核，不能因此宣稱正式 R09 已結案。

## 維護方式

每次結帳事故更新對應 R 編號，補上「觸發條件、跨過哪個提交邊界、最終資料結果、能自動重現的測試、必跑入口」。新增案例後同步更新證據層級與執行門檻，不只增加測試數量。

在核心端到端、實機及發布門檻完成前，對外描述應維持為「多層局部交易測試已建立，完整發布驗收仍待補強」。

## R09／R23 正式發布更新

2026-11-24 已先套用 R09 migration、更新 PostgREST schema cache，再以 Git 發布前端。功能提交 `fa09d1cd6dc6736905c58c553ad936d3f1b06f6b`，Vercel Production Ready，正式網域已指向新版。既有 public 函式來源與 ACL 指紋在新增範圍之外一致；六項安裝檢查全部為 true。

正式資料庫在回滾交易內驗證同 key 重播、查回同一張原單、訂單數只增加一筆；交易已回滾，沒有留下測試訂單或請求。正式 PostgREST ordinary／wallet 新 overload 均可解析，錯誤憑證會拒絕；未知 key 的查回回傳 null。

隔離發布版 32 項回歸通過；正式站實際資產 32 項通過，雙錢包 retry／reload 三輪另 12 項通過。首次正式資產執行曾有一項測試等待逾時；截圖已在原單付款頁，原因是 `isEnabled()` 等待已消失的按鈕。改用不等待的 enabled locator count 後全套與三輪重跑通過，未改動產品行為。

正式資產測試僅放行正式網域的 GET 頁面／靜態資產，其他未攔截請求全部阻擋；Auth、目錄、通知及付款為替身，建單／查回使用隔離 SQL。沒有真實付款或發送客戶通知；這些測試加上正式 SQL 回滾驗收，不能宣稱已完成正式銀行端到端或實體 iPhone／LINE 驗收。

發布詳情見 [正式發布紀錄](checkout-r09-r23-production-2026-11-24.md)。上列發布前紀錄為歷史證據，以本節目前狀態為準。
