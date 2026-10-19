# 正式發布前檢查｜2026-10-19 最新狀態

本文件保留分次核對紀錄。**最新狀態：使用者要求接續合併／發布步驟後，main已快轉至010d08c並由Git自動Production部署Ready；學生價與worker仍OFF。** 最新正式發布結果及未驗證限制見 `reward-production-release-2026-10-19.md`，下列尚未發布的敘述屬先前時間點紀錄。

正式登入後銀行儲存發現Production缺少SUPABASE_URL／SUPABASE_ANON_KEY，使用者已批准補齊並以Git自動部署載入；不修改產品碼或資料庫。根因與未完成驗收見 `reward-bank-production-config-fix-2026-10-19.md`。早期401／405只能證明未登入／方法保護，不能宣稱銀行服務設定與加密驗收已通過。

## 發布判斷

資料庫與付款配套已準備，兩管道受控通知已實際收件；使用者已接受新版入口直接顯示、學生價先 OFF。仍須整理可追溯提交、回復限制與未完成的正式驗收；這項入口決策不等於批准合併 main。網站發布、學生價啟用、通知／對帳排程啟用分別批准。

## 已驗證與證據

| 項目 | 結果及限制 |
|---|---|
| Git | 本次 fetch 遠端 main 為 `b267571`；已包含於目前 `codex/instructor-student-rewards`，main-only 0、本分支-only 33；HEAD `5006797` 與追蹤的開發分支一致。本輪文件、worker 工具與證據尚未提交；`.claude/launch.json` 保留、不納入。 |
| 正式 SQL | 使用者批准後，優惠券修補＋10 份返饋 SQL 共11檔逐步安裝／驗證完成。15張返饋表具 RLS、原208函式 owner／ACL 無差異、活動定價核心不變。安裝後既有待付款聚合1筆、舊訂單返饋折抵0、新財務資料／通知佇列0、學生價 OFF/version0。這是當時證據，不代表往後即時資料量。 |
| 付款主機 | 仍使用 `/opt/eclado-payment-api` 主機管理；server SHA256 `485150d4e6bd6a99f4a1514ce71448587f4723a763efdc8e3c3810fa6ea963b3` 本輪再次一致；公開 HTTPS `/health` 回應 ok。新欄位唯讀相容探測已通過，未建立銀行交易。 |
| Production 銀行金鑰 | Vercel Production 兩個專用秘密設定已儲存，未修改 Preview；私有備份0600／Git忽略，本機假銀行 AES-GCM roundtrip／owner隔離通過。**未部署，因此尚未證實新 deployment 載入與正式銀行 API 可用。** |
| 獨立 worker | VPS 無sudo／nologin帳號，root持有runtime與0640設定，沒有銀行金鑰。本輪確認正式憑證已配置、flag=false、兩 timer disabled/inactive；設定檢查0網路。沒有啟用自動通知。 |
| 通知 | LINE bot/info 200，官方帳號 `ECLADO TAIWAN`／`@379sdyrk`；Resend domain `ecladotaiwan.com` verified。指定 Email 及更正後 LINE ID 的單則連線測試均經使用者確認收到。這不是 Outbox、失敗備援、lease／重試的正式全流程驗收。後續已批准測試的收件人由 `.env.notification-test` 讀取，不用舊腳本寫死ID。 |
| 隔離資料庫 | 當日正式 catalog 離線 PostgreSQL17.6 重演11檔、10次verify通過；原 ACL208一致、7個活動／定價函式一致；扣款／自選提領併發2/2、deadlocks0。沒有正式測試單。 |

證據入口：`docs/evidence/reward-production-migration-execution-20261019.json`、`reward-production-postinstall-20261019.json`、`reward-production-original-acl-postinstall-20261019.json`、`reward-production-preflight-20261019.json`、`reward-provider-readonly-verification-20261019.json`、`reward-controlled-notice-test-20261019.json`、`reward-line-confirmed-id-test-20261019.json`。

## 入口及開關：重要發布範圍

- `src/pages/AccountPage.jsx:40`：目前 instructor 即可見師資返饋頁籤；沒有等待學生價 ON 的條件。銀行／提領操作由獨立 RPC/API 驗證，不是由學生價開關停用。
- `src/pages/CheckoutPage.jsx:123` 及返饋折抵區：instructor 可查可用返饋金並按共同上限折抵；銀行應付至少1元。學生價 OFF 不能當成錢包停用。
- `src/admin/domain/access.js:59` 起：四頁依有效管理員與 orders／members／withdrawals 權限顯示，不由學生價開關控制。
- `api/reward-bank.js`：POST＋Auth驗證＋受限服務 RPC，需 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`（或別名）及獨立 keyring；沒有整套發布開關。正式 keyring 儲存成功不等於新函式已載入。
- `api/reward-notification-worker.js:34` 起：POST、CRON_SECRET，且拒絕帶銀行金鑰的環境；正式 Vercel 同專案因帶 keyring 不應用此路徑執行 worker。VPS CLI 為選定執行方式。
- `vercel.json` 仍只有既有兩個 cron，沒有新增返饋排程。付款 API GitHub workflow 僅手動 dispatch 可部署；本次不採用、不配置 Secret、不執行。既有草稿 PR／主機備用帳號待另准清理。

**已確認（2026-10-19）：**使用者接受新版正式發布後，符合既有角色／權限者直接看到返饋金、銀行資料與提領入口；學生價格先保持 OFF。沿用現有資格、餘額與後端驗證，不新增入口隱藏或停用方案。本決策不批准 commit／push、合併 main、部署或 worker／學生價啟用；原監測與回復限制繼續列管。

## 尚未完成，不能當成 PASS

1. 新 Production deployment 上銀行 API、環境連線與加密設定的驗證；目前未發布，亦未使用正式會員儲存假銀行資料。
2. 真實會員 LINE Login 身分與 Messaging API User ID 的 Provider／綁定一致性。單一開發者收件成功不能證明所有老師可收；不同 Provider 的 ID 不可直接互換。不能以 Email 或任意ID補綁會員。
3. 正式 Outbox claim／complete、失敗備援／重試、對帳 run 的完整受控驗收；直接 provider 測試沒有經過正式佇列。已有隔離與mock證據，正式不得製造假財務事件。
4. worker 正式啟用的頻率與監測責任：每分鐘通知、每日台北03:00對帳仍是建議；queue age、unknown／失敗及run告警、日誌保存尚未配置。需先制定當班查看與異常處理方式，不宣稱有自動告警。
5. 正式銀行交易、退款／晚回呼、提領匯款等真實情境未驗收。本次不自行建立付款／提領來補證。
6. 平台備份最新已記錄台北15:10:47、主機完整備份已校驗；尚無實際服務／全庫還原演練，也沒有銀行 keyring 異地還原演練。public catalog 不是交易資料備份，Supabase DB 備份不含 Storage 物件。

## 發布／啟用順序（尚未執行）

1. 入口範圍已確認直接顯示、學生價先 OFF，不需新增隱藏方案；其餘未覆蓋風險與發布放行仍須確認。
2. 核對所有候選檔案及敏感資訊，依授權 commit／push 開發分支；確認 Git Preview Ready，驗收測試專案環境。保留秘密、private-backups及 `.claude/launch.json` 不提交。
3. 另批准 main 合併／push；執行前再次 fetch 核對差異、必要回歸、付款公開health、最新備份與正式學生價OFF。11檔已安裝，**不重跑**。
4. 透過 Git 自動 Production 部署；核對部署 SHA、Production 專案連線、環境標示／登入／商品／原購物金與付款頁、返饋頁權限、銀行 API 服務狀態。不要直接Vercel redeploy／promote，不把畫面測試當成銀行交易成功。
5. 先完成受控正式整合與人工監測安排，再分別批准 worker／timer 與學生價啟用。啟用學生價後建立的真實學生訂單才會產生快照／返饋事件；不可提前開折扣再假設自動補發。

## 回復界線

- 網站回復以已批准的 Git revert／相容修補及自動部署進行，不用 Vercel 直接 rollback。
- 不 DROP／清空帳務、不刪舊 keyring；不能用全庫還原作為一般功能回退，會回退備份後真實交易。
- 出現返饋折抵訂單後，付款 API 必須繼續理解雙錢包及有效付款證據；不可直接套用安裝前舊API備份。保留既有保留、晚回呼與提領義務的處理能力。
- 停學生價只停新學生價格／快照入口，不能當作錢包／提領熔斷。緊急停止新財務操作的具體 RPC／應用方案仍須審核、演練與批准，不能臨場任意撤權破壞結算。

## 本輪驗證

36項：付款金額、銀行API／AES／CSV、通知mock、host worker；全部通過、0跳過。付款API全套65/65通過，合計101/101；首輪受sandbox禁止loopback listen影響，取得權限後重跑成功，不計首輪為PASS。付款使用mock／假設定，不是真銀行交易。`vite build --mode test` 472 modules通過，既有large chunk警告；node／bash語法及git diff檢查通過。另有既有Node module-type警告。本次未重跑Playwright或Production完整 `npm run build`（含SEO預渲染），不把test Vite Build等同正式全流程建置；正式Git部署仍需核對完整Build結果。

未新增產品邏輯、未執行DB寫入、未發通知或啟動服務；本輪health誤查loopback3001失敗後以正確公開HTTPS health確認正常，不能把未確認的埠當服務故障。檢查結果保存 `docs/evidence/reward-release-check-20261019.json`。

## Git Preview 已確認（接續 d49fdf0）

32檔發布準備已提交／push為 `d49fdf0c267ce35930c3a87ae1a013af147d9636`。Vercel唯讀Deployment Details確認同一分支／SHA、Environment Preview、Ready，建置19秒；網址 https://eclado-joi9oqga8-eclado-s-projects.vercel.app 。未操作任何部署按鈕。首頁與商品頁有TEST／銀行付款停用標示，測試商品100ml為1200、切200ml為2000；未登入會員專區及後台皆要求登入。這是未登入smoke，不是已登入老師／管理員或結帳全流程驗收，也不是新一輪完整網路隔離稽核。已開啟新Preview後台登入頁供後續驗收。證據 `docs/evidence/reward-preview-d49fdf0-smoke-20261019.json` 及同前綴Ready／登入畫面。main／Production未變，學生價與worker未啟用。

使用者其後登入test管理員，四頁籤唯讀檢查完成：老師列表／側邊明細、歷史學生訂單與Ledger可讀；測試老師餘額／可用30000、待入帳0。提領共5筆，11月批次4筆皆失敗，待處理合計0（排除終態）符合契約。通知15筆待設定／無可用管道、最後派送空，僅驗證載入，不宣稱test通知派送可用。財務對帳頁可載入但目前無報告；未按執行、補發、匯出、銀行快照或匯款異動。仍待老師端及結帳／寫入流程驗收，正式環境未操作。證據已補入相同smoke JSON，管理畫面 `docs/evidence/reward-preview-d49fdf0-admin-rewards-20261019.jpg`。

使用者回報已在外部完成師資端檢查（屬使用者回報，不視為Codex重驗），並於Preview登入測試老師後，已檢查商品師資單價700、8件商品5600／運費120、可用返饋30000、畫面折抵5600後尚需付款120，未折運費。只填假收件資料到付款確認步驟，未按建立付款單、未建單／保留／付款；購物金餘額0，雙錢包組合尚未由此帳號驗證。`CheckoutPage.jsx:388` 的停用guard在quote/create前返回，故Preview付款OFF也阻止建單；不能視為建單／錢包生命週期雲端驗收。後續應沿用隔離工具補驗，不接正式銀行或等正式才測。畫面 `docs/evidence/reward-preview-d49fdf0-checkout-wallet-20261019.jpg`，結果補入smoke JSON。

## 隔離結帳補驗已完成

使用者批准繼續後，已用真實本機PostgreSQL17.6通過4個情境（含多連線、deadlocks0），最新正式catalog離線11檔／10verify通過，付款金額／回呼／逾時API mock35/35，桌面手機結帳與代客UI mock60/60（各30）。一般／兩種單錢包／雙錢包、NT$1、促銷優惠券、保留扣用釋放返還、付款retry及舊回呼、併發一致性均有隔離證據。只修臨時測試設定的啟動cwd，沒有產品修改；未改Preview開關或建立雲端訂單／銀行交易。

這解除「缺本輪隔離結帳證據」待辦，不解除正式銀行交易、銀行API部署金鑰、Outbox／排程監測與回復演練限制。真PG與UI mock分層驗證，非單一UI→真DB→付款API全鏈路。完整指令、結果、隔離方式及風險見 `reward-checkout-isolated-acceptance-2026-10-19.md`，數量與log hash見 `docs/evidence/reward-checkout-isolated-20261019.json`。本批Preview／隔離補驗文件與證據尚未commit／push。
