# 階段 6｜通知可靠性與財務對帳實作紀錄

2026-10-13，基線`codex/instructor-student-rewards`／`e81b4ccbf57707fc5e1c29fa819a50119afd7dce`。本機實作與隔離驗證；未正式安裝／部署、未進入7、正式學生價維持OFF要求。階段5已提交／push，但人工验收仍待確認。

開始前已讀統一開發v1.8、開發規範及2A～5文件；程式／來源行號與工作量52–80工程工時估算見`instructor-reward-notifications-reconciliation-plan.md`（非實際計時）。本文件代表後續實作與驗證狀態，草案不自動成為營運規則。

## 已確認決策

- A：無LINE直接Email，LINE明確HTTP失敗（含429／5xx）立即Email；timeout／連線中斷同key重試LINE。官方核對5xx仍可能已接受後，使用者明確選擇維持立即Email並接受雙管道重複。
- B：管理員明確指定Email名單，本機假名單；缺名單或老師無有效管道保留紀錄。已成立提領降級仍通知，不放寬降級本人查詢；未新增老師站內通知信箱。
- C：unknown固定「待查核／未確認成敗／仍保留／勿重複申請」；更正預設稽核，明確選擇才另寄固定說明，不轉述內部自由輸入原因或改原結果。
- D：每事件／收件人／管道最多6次，首次＋5次，間隔1／5／15／60／360分鐘；永久Email錯誤停止。原通知補發同key；已成功、未知、超窗口或耗盡後需確認新版本及稽核。
- E：通知read需有效管理員＋提領read；補發／更正需提領manage＋notifications.send。對帳read需有效管理員＋orders.read＋members.read，執行另需提領manage；正式排程／平台／env另准。

## 實際修改16檔（相對eclado/）

| 檔案 | 用途 |
|---|---|
| supabase-instructor-reward-notifications.sql | Outbox／attempt、原子事件／刪戶清理Trigger、claim／complete／補發／更正／查詢RPC、ACL |
| supabase-instructor-reward-reconciliation.sql | run／finding、私有一致讀檢查及受限執行／查詢RPC |
| supabase-instructor-reward-operations-verify.sql | READ ONLY OFF／RLS／ACL／一致性／S1核對，ROLLBACK |
| api/_reward-notification-delivery.js | 固定繁體中文模板、既有LINE／Resend HTTP與品牌Email版型、安全分類／timeout |
| api/reward-notification-worker.js | CRON_SECRET、有限派送／對帳入口、銀行key隔離拒絕、安全工作日誌 |
| src/services/rewardOperations.js | 受限RPC，無客戶端財務金額或任意收件內容 |
| src/admin/pages/RewardOperationsPage.jsx | 原reward-view樣式通知／對帳、補發、更正、同key重送、撤權清舊資料 |
| src/admin/AdminApp.jsx | 頁面／操作權限 |
| src/admin/components/Sidebar.jsx | 選單 |
| src/admin/domain/access.js | 原能力交集，不新增角色或permission |
| tests/support/eclado-mocks.ts | 未安裝6的安全mock |
| tests/instructor-reward-operations.spec.ts | 桌面／手機／唯讀／補發／更正／對帳／錯誤 |
| tests/integration/instructor-reward-notifications-db.test.cjs | 真SQL／PG並發／權限／財務異常注入及rollback／刪戶 |
| tests/integration/reward-notification-worker.test.cjs | 全Mock provider／worker／模板／timeout／金鑰隔離 |
| docs/instructor-reward-notifications-reconciliation-plan.md | 盤點、技術草案及決策歷史 |
| docs/instructor-reward-notifications-reconciliation.md | 本紀錄 |

外部單一追蹤文件另更新v1.9，原`.claude/launch.json`及三份student-pricing-production文件不修改。

## 資料、RPC及投遞

四表：`instructor_reward_notification_outbox`／`instructor_reward_notification_attempts`／`instructor_reward_reconciliation_runs`／`instructor_reward_reconciliation_findings`。全部RLS無policy，撤銷PUBLIC／anon／authenticated／service_role直接表與sequence權限；SECURITY DEFINER空search_path。attempt／run不可UPDATE／DELETE，Outbox／finding禁止DELETE。財務表、Ledger、銀行快照及1～5 posting／付款／購物金／庫存未放寬或重設計。

`queue_reward_withdrawal_notice()`接5的withdrawal events AFTER INSERT；requested老師／管理員兩入口，paid／failed／unknown老師入口。source／recipient／version unique，另有withdrawal／type／recipient／version unique防另audit key反覆標unknown而重寄初始通知。correction透過明確確認RPC建立。同DB交易保存事件及Outbox，不等HTTP。Outbox INSERT失敗回滾未提交申請以防漏事件；第三方發送失敗不回滾已提交財務。

服務端RPC：`claim_reward_notifications(integer,text[],text)`／`complete_reward_notification(uuid,uuid,text,text)`；authenticated管理員RPC：`get_admin_reward_notifications(integer)`、`retry_reward_notification(uuid,uuid,boolean,text)`、`queue_reward_correction_notice(bigint,uuid)`、`get_admin_reward_reconciliation(integer)`、`run_reward_reconciliation(uuid)`（亦授service_role）。逐項DB能力驗證；helper及Trigger禁止客戶／service_role直接EXECUTE。

claim使用SKIP LOCKED、2分鐘租約及隨機fencing token；舊／過期complete不能覆寫。SQL批次最多20，API最多5，每HTTP／RPC上限5秒。管理名單placeholder拆每地址一job，缺名單blocked，不寄預設正式客戶。收件／sender／key／模板版本1固定；每claim／complete／人工補發留attempt。全地址／LINE ID短期私有保存，成功或超窗口清除；profile刪除清老師routing／mask／lease，保留UUID／事件，不從歷史orders補聯絡資料；已進外部API的訊息無法召回。

LINE用現有Messaging API及profiles.line_user_id；2xx或帶accepted-request-id的409視為provider接受。HTTP錯誤／缺token切Email，timeout同key重試；分別記line_server_error／line_rate_limited／line_rejected／line_unavailable。Email用既有Resend、ORDER_EMAIL_FROM及_email-template，429重試、5xx／timeout未知、永久錯誤停止，缺設定blocked。模板只白名單原申請日期／金額／15元／淨額／預定日／狀態，paid日期／實匯，failed全額返還與再申請步驟；管理員老師UUID與固定入口。不含銀行／交易序號／學生聯絡資料／自由原因，HTML沿用轉義。

[LINE](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)及[Resend](https://resend.com/docs/dashboard/emails/idempotency-keys)防重期限24小時；保守23小時停止自動重送列unknown。不是外部exactly-once；sent是provider接受，非本人已讀／Email可達。5xx立即備援可能重複已由使用者接受。

## Worker及排程

只POST＋CRON_SECRET，action只dispatch／reconcile，忽略任意client收件／金額／內容。對帳使用UUID run key。worker不載入銀行crypto；環境若有REWARD_BANK_ENCRYPTION_KEYS或REWARD_BANK_ACTIVE_KEY_ID直接拒絕執行。**不能直接在注入銀行keyring的同一Vercel全域env執行worker**；正式需另批不含銀行解密key的環境，可評估既有Vultr獨立worker／允許清單env，不照搬Payment API全部secret。

使用既有CRON_SECRET、SUPABASE_URL／SUPABASE_SERVICE_ROLE_KEY、LINE_CHANNEL_ACCESS_TOKEN、RESEND_API_KEY、ORDER_EMAIL_FROM；名單設定名稱REWARD_NOTIFICATION_ADMIN_EMAILS（上限10）。沒有填真env／改vercel.json／新增平台或正式process。service_role仍是高信任憑證，更強專用DB角色隔離需另審核，不宣稱全既有RPC已縮到最小權限。

本機排程模擬推進next_retry_at／lease再claim及Mock worker呼叫；沒有常駐serverless。後台summary提供待發／待查核數及最近實際attempt；空批次與中斷用不含PII結構化工作日誌記開始／完成／結果，不把最近attempt當空批次heartbeat。正式cron觸發、日誌保存／告警／quota及成本另核，不在此次設定。

## 對帳不變條件與人工查核

私有STABLE `reward_financial_checks()`同statement MVCC唯讀核對；`run_reward_reconciliation`用advisory transaction lock拒絕並跑，相同request-key回原結果。先有界計數，V1來源50,000／異常10,000筆上限；超限或失敗記failed，不解除舊異常。

- 帳戶四餘額＝Ledger四delta加總、各after＝同帳戶id running sum；FULL JOIN抓缺帳戶。balance已扣保留，不重扣，負balance合法。
- snapshot老師／總返饋／逐項reward＝state／收入Ledger；pending一次、credit／cancel互斥、reverse只在credit後一次，獨立標重複credit／reverse。有效receipt與完成／終止一致，不靠paid_at，不查現價重算。
- pending帳戶＝pending income；購物hold＝reserved reservations；提領hold＝pending／processing／unknown原額。
- 每購物cycle reserve一次、consume／release互斥、refund在consume後一次，reservation／訂單／receipt／退款與三項付款公式一致；缺reservation／孤立spend列異常，付款失敗後訂單仍unpaid而released合法。
- 提領reserve一次、complete／release互斥；paid需net=amount−15、fee_charged15及憑證；failed全額release、fee_charged0。quoted fee15與failed charged fee0不誤報。unknown保留不改結果。
- 原晚付款exception／unknown匯款列人工查核；合法已取消pending order刪除不一律誤報。實匯憑證仍是管理員輸入，不代表銀行資金已驗證。

finding唯一rule／source，first／last_seen、expected／actual、present及run ID；重掃復用、不DELETE。完整成功掃完才解除未再見到的異常；失敗rollback finding更新，保存failed run＋SQLSTATE，不保存敏感原始error。原immutable payment exception未新增結清制度，保留供人工核對。

只發現／記錄／查詢；沒有餘額修正、Ledger重寫、重發返饋、退款、銀行匯款或unknown改paid／failed操作。通知列表20筆、近期attempt上限200、對帳finding20及run10；完整attempt歷史仍存在DB，不宣稱目前UI提供無限歷程匯出。

## 測試證據

- PostgreSQL17.6最新6單檔1通過0跳過，包含非空不同PID worker競爭／持鎖SKIP LOCKED、lease舊回覆／恢復同target-key、六次上限及間隔、缺管道／降級／重複unknown、SQL重跑／verify／實際權限／RLS／ACL、結清Auth刪除清個資留歷史，deadlocks=0。不是所有排程證明。
- 財務writer未commit時reader一致舊值，commit後一致新值；真提領後退貨負額合法。Owner-only BEGIN／ROLLBACK注入重複入帳／扣回、帳戶／hold／net異常，偵測但不修正、不重複finding，修復後present解除。強制Outbox失敗申請完整回滾；finding失敗留failed run、不清舊異常。全在隔離DB。
- PGlite十檔批次11通過0跳過，覆蓋2A／2B／3／5／1C／1B／定價／代客／S1，6亦含4；最新6單檔1通過（與批次重疊）。
- 新通知／worker Mock13通過；與季度／管理信／永豐通知／催款／逾時七檔批次53通過（含13，不相加）。沒有真LINE／Email投遞。
- Payment API無.env暫存副本＋假商店代碼55通過，非真銀行。Playwright四檔桌面／手機62通過，含新6的16項及3／4／5回歸；最後新專檔16通過（重疊）。RPC／付款皆Mock。
- 隔離Build466模組、1mock商品／8文章通過；既有large chunk警告。node --check、git diff --check及新檔空白／憑證模式核對，無Lint script。
- 初期沙箱EPERM／舊PGlite工具缺失、SQL同名變數、fixture缺登入／真實admin權限、constraint名稱假設、worker日誌作用域錯誤及刪戶斷言誤含管理員地址已修正／重跑；失敗／中止批次不當通過。暫存工具不改package或lockfile。

主要指令（eclado/）：

```sh
EMBEDDED_POSTGRES_MODULE=/private/tmp/eclado-1b-postgres-tools/node_modules/embedded-postgres/dist/index.js node --test tests/integration/instructor-reward-notifications-db.test.cjs
PGLITE_MODULE=/private/tmp/eclado-stage6-tools/node_modules/@electric-sql/pglite/dist/index.js node --test tests/integration/instructor-reward-notifications-db.test.cjs
node --test tests/integration/reward-notification-worker.test.cjs
npx playwright test tests/instructor-reward-operations.spec.ts tests/instructor-reward-withdrawals.spec.ts tests/instructor-reward-queries.spec.ts tests/instructor-reward-checkout.spec.ts --project=chromium --project=mobile-chrome --workers=1
node /private/tmp/eclado-1b-build-isolated.cjs
git diff --check
```

## 正式前置、回復與狀態

建議接受6本機驗收；正式仍未驗證：2A～6 Schema／Auth／PostgREST、5人工驗收、真銀行及LINE好友／Email可達性、獨立worker秘密隔離／排程／名單／sender／quota、正式資料量／DB statement timeout及日誌保存。HTTP Abort不保證DB工作已停；未知結果靠同run key／lease恢復。

Migration：S1／1B／1C及購物金基線→2A→2B→3→4→5→6通知→6對帳→verify。若5已有歷史requested／paid／failed／unknown但未安裝6，**拒絕默默回補寄舊通知**，另案確認處理。未讀正式資料量；同名異形／半安裝先保存定義／ACL／Trigger／CHECK核對，不靠rerun修復。

回復先停worker／新入口／EXECUTE及按另批Git流程回復相容UI；保留Outbox／attempt／run／finding／金融UUID與歷史。事件Trigger停用期漏通知策略另核，不能DROP佇列或金融表；保留刪戶個資清理。不得直接Vercel。

既有代客Auth刪除衝突、非返饋取消後晚付款復活、銀行元／分契約與人工帳務修正制度仍獨立列管。未正式DB／Migration／部署／匯款／真通知／Git提交推送／學生價啟用／階段7。停止等待使用者驗收。


## Git提交（2026-10-13）

使用者授權commit／push至`codex/instructor-student-rewards`。階段6本機實作16檔獨立提交，驗收工具與證據另提一筆；實際hash／push結果記錄於外部統一開發.md。提交前再次通過worker13測試、Git差異與敏感資訊檢查。維持正式學生價OFF、未執行正式Migration或直接Vercel操作，不合併main；Git既有自動部署可能由push觸發。本機完整驗收20組證據另見`reward-local-manual-acceptance-results.md`，不等於正式服務驗收。
