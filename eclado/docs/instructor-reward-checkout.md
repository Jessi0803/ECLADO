# 階段 4｜返饋金折抵與雙錢包整合

2026-10-12。本機實作／隔離驗證完成，待使用者驗收。分支 `codex/instructor-student-rewards`，開始時 HEAD `23f920799341b2c4fab0d649d9afd25525eabb1a`。未 commit／push、未操作正式 DB、未部署／操作 Vercel、未合併 main、未啟用正式學生價格、未進入階段 5。

## 已確認規則與最小範圍

- 目前 instructor 本人只能在一般網站訂單使用自己的返饋金；代客訂單不提供此折抵。兩錢包獨立，購物金不得為負。
- 兩錢包合計只折抵活動／優惠券後的商品金額，不抵運費；銀行總實付至少 NT$1。
- 已保留的返饋金在角色降級或學生退貨造成可用餘額負數後仍履行；禁止新保留／重新保留。
- 明確付款失敗只釋放返饋金，購物金維持原保留至取消／逾時行為。原訂單重試重新檢查 instructor、餘額並保留原額。
- 已釋放而未重新保留時收到有效晚付款：保存收款證據及異常，阻止自動扣用／訂單啟用，由管理員處理；不自動銀行退款。
- 取消後不得復活的保護限定「使用返饋金或已有學生返饋快照」訂單。其他原有晚付款復活／代客重新配庫存路徑經使用者確認獨立列管，不在此重構。
- 返饋收入快照及學生計算基準不受任何錢包折抵影響。原商品定價、促銷、優惠券、贈品、庫存與代客購物金沿用既有核心。

檢查基礎包括 2A `student_reward_snapshots`、2B 帳戶／Ledger／有效付款證據及訂單 Trigger、3 的受限報表、原 shopping-credit quote/create／事件與永豐 claim/retry／通知接點。預估含驗證 28–44 工程小時，為範圍估算，非實際計時。

## 修改檔案（17 檔，相對 eclado/）

| 檔案 | 實際用途 |
|---|---|
| supabase-instructor-reward-checkout.sql | 原子 Migration、雙錢包計價、獨立消費帳務與受限 RPC |
| supabase-instructor-reward-checkout-verify.sql | 唯讀 Schema／ACL／OFF 驗證 |
| payment-api/reward-payment-evidence.cjs | 綁定銀行查詢的明確失敗與金額提取 |
| payment-api/reward-payment-evidence.test.cjs | 查詢證據／失敗／金額純函式測試 |
| payment-api/reward-payment-persistence.test.cjs | 收款持久化、阻擋異常、權威銀行金額測試 |
| payment-api/server.js | 有效收款、失敗釋放及重試接點 |
| src/services/orders.js | 新 quote/create 契約，不降級繞過錢包驗證 |
| src/services/instructorRewards.js | 本人可用返饋金 RPC |
| src/services/rewardPayment.js | 人工收款異常明確報錯 |
| src/pages/CheckoutPage.jsx | 老師雙錢包操作、焦點刷新與提交前報價確認 |
| src/components/checkout/CheckoutOrderSummary.jsx | 折抵／銀行實付摘要 |
| src/components/account/InstructorRewardsPanel.jsx | 保留額及消費 Ledger 顯示 |
| src/admin/pages/InstructorRewardsPage.jsx | 保留額與帳務異常數 |
| tests/support/eclado-mocks.ts | 新本人餘額 RPC mock |
| tests/instructor-reward-checkout.spec.ts | 桌面／手機折抵及失效情境 |
| tests/integration/instructor-reward-checkout-db.test.cjs | 真實 SQL、ACL、回滾及多連線競爭 |
| docs/instructor-reward-checkout.md | 本報告 |

外部單一追蹤文件「統一開發.md」另外更新為 v1.6。既有 `.claude/launch.json` 與三份 student-pricing-production 紀錄／備份／回復檔未修改，不屬本次範圍。

## Schema、RPC 與付款契約

`supabase-instructor-reward-checkout.sql`：新增 orders.reward_credit_amount（預設 0）、帳戶 reserved_balance（預設 0）；Ledger 新增 reservation_cycle／reserved_delta／reserved_after（預設 0）及 reason_code。既有 Ledger 不 UPDATE，原收入事件保留 cycle=0，新消費事件 cycle>0。

新增私有 `instructor_reward_reservations`（每訂單一筆、循環版本）及不可任意修改的 `instructor_reward_payment_exceptions`。不增加 Auth／訂單 cascade FK，保留永久 UUID 帳務。RLS 啟用、無客戶端 policy，撤銷 PUBLIC／anon／authenticated／service_role 直接表權限，交易僅透過受限 SECURITY DEFINER、空 search_path 函式。

權威公式：

```text
商品上限 = max(0, min(floor(subtotal - discount), floor(total - 1)))
shopping_credit_amount + reward_credit_amount <= 商品上限
payment_amount = total - shopping_credit_amount - reward_credit_amount
payment_amount + shopping_credit_amount + reward_credit_amount = total
```

此 subtotal／discount／total 來自既有後端商品、活動、優惠券及運費核心。不是每錢包各扣一元。原只使用購物金與不使用錢包路径保留；新路徑也測試兩者。

新增 RPC：

- `get_my_reward_credit()`：authenticated，目前 instructor、auth.uid 自己；signed／available／reserved／version。
- `quote_order_with_wallets(jsonb,text,text,text,bigint,bigint)`：anon／authenticated 可呼叫；未登入／非 instructor 的非零返饋折抵拒絕；原 quote 核心＋雙錢包上限／帳戶驗證。
- `create_order_with_wallets(...,bigint,bigint,jsonb)`：同權限；重算、確認 quote／tender／銀行額／返饋帳戶版本，再沿用原 create 與原購物金保留，原交易內保留返饋金。
- `record_verified_reward_wallet_payment(text,text,text,numeric)`：僅 service_role，原銀行證據核心＋銀行金額核對；缺額／不符拒絕消費。
- `record_reward_credit_payment_failure(text,text)`：僅 service_role，當前 provider、尚無有效收款才釋放；舊嘗試失敗不能釋放新保留。

私有 helper：`reward_credit_event`、`settle_order_reward_credit`、`sync_reward_credit_order`、`guard_reward_credit_order`；不授客戶端或 service_role 直接 EXECUTE。新增訂單 guard／狀態同步及 exception 不可變 Trigger。

窄幅延伸已安裝函式：`set_order_payment_amount_defaults`、`append_instructor_reward_event`、`guard_instructor_reward_member_deletion`、`begin_order_payment_retry`、`record_verified_instructor_reward_payment`、`confirm_admin_instructor_reward_payment`、`get_admin_reward_payment_requirement`、`quote_assisted_order`、`claim_order_payment` 與階段 3 報表投影。保留 S1 claim/retry service-only ACL。代客 quote 只拒絕明確非零返饋折抵，不改 AUTO／MANUAL、購物金或分享付款。

銀行 creation 仍使用 claim 回傳的權威 `payment_amount`；測試確認銀行 NT$1 → Amount=100，忽略客戶端金額。有效回呼先持久化證據與完成帳務，再進原狀態更新／通知；異常在 DB 證據提交後阻止原狀態更新。沒有修改 `api/sinopac/notify.js`、付款重試授權、通知模板或傳送機制。

銀行查詢金額僅取绑定 provider 的 raw OrderQuery／PayQuery（Amount／Amt／Total／PayAmount）。目前沿用既有通知的元／分兼容核對；正式前必須核對永豐實際欄位及單位，不能把這個兼容策略當作已驗證的正式契約。新版 SQL 的原三參數 receipt RPC 禁止錢包訂單繞過金額驗證。只有 PGRST202 缺新 RPC 時作舊 DB 相容；新錢包建單沒有降級繞過。

## 帳務、鎖與冪等

| 消費事件 | 可用 balance delta | reserved delta | 後續狀態 |
|---|---:|---:|---|
| spend_reserve | −amount | +amount | reserved |
| spend_consume | 0 | −amount | consumed |
| spend_release | +amount | −amount | released |
| spend_refund | +amount | 0 | refunded |

`balance` 保持 signed 可用帳務額；`pending_balance` 為待入帳收入，`reserved_balance` 為消費保留，互不混合。只有收入 reverse 可造成負數；消費不允許新透支。退回消費可能抵銷既有負額。

Ledger unique(order_id,event_type,reservation_cycle)；同 cycle 不重複，retry 新 cycle。來源原因包含建單、重試、有效付款、明確失敗、取消／逾時／退貨。收款證據獨立不可變，paid_at／人工 paid 不足以扣用。

生命週期先鎖 order→reservation→Auth 父列→account；新建單先取得本人 Auth／profile，再固定購物金 account→返饋 account，沿用既有購物金同步的順序，避免雙錢包鎖倒置。同帳戶序列化、版本檢查、unique event 及整筆交易回滾，不以直接修改歷史餘額補洞。

角色降級不取消既有 hold；重新保留必須重新驗證。明確失敗釋放／逾時取消釋放／未付取消釋放；已 consume 取消或整退 refund。付款成功／取消競爭，終止訂單不復活，晚收款留下 exception。已正常退款後的重複原成功回呼不建立虛假新異常。

老師餘額非零、待入帳非零或 reserved 非零禁止刪除；沿用零餘額無義務可刪／保留 UUID 歷史策略。既有代客 Auth 刪除衝突仍獨立列管。

## 前端

沿用結帳摘要及購物金操作。只 instructor 顯示可用返饋金；RPC 未安裝不顯示新入口，其他錯誤明確提示。焦點重取兩錢包、不默默重置選擇，身份／角色改變重置返饋選擇。載入中／資格失效阻擋已選錢包提交。

提交前重新 quote，若商品／優惠／付款額或返饋選擇因上限調整而不同，顯示最新銀行應付及兩折抵金額要求確認；create 再重算，版本過期報錯並刷新餘額。前端只 preview，後端為唯一計價與授權權威。原同步 submittingRef 防連點保留；沒有新增跨獨立建單請求的全域 request-key。

## 實際測試證據

| 類別 | 實際結果 | 限制 |
|---|---|---|
| PGlite 九檔批次 | 10 passed，0 skipped | SQL 真執行，非正式 PostgreSQL |
| 最終階段 4 PGlite 單檔 | 1 passed，0 skipped | 追加逾時／原因紀錄後再通過；與批次重疊 |
| 最終 PostgreSQL 17.6 單檔 | 1 passed，0 skipped | 多情境斷言、獨立連線、deadlocks=0；非窮盡排程 |
| Payment API | 55 passed，0 skipped | upstream mock，非銀行交易 |
| Playwright 五檔桌面／手機 | 82 passed | RPC／付款 mock |
| 原購物金／結帳／付款／訂單回歸 | 18 passed | 選定相關既有案例，非全專案測試 |
| 最終階段 4 UI 專檔 | 12 passed | 與82批次重疊，不相加作唯一案例數 |
| Build | exit 0，460 modules | 隔離 mock catalog：1商品／8文章；既有大chunk警告 |

SQL 實测包括六角色、零／負／不足餘額、兩錢包各自與並用、商品 cap／運費／促銷及優惠券、實付恰好1、超上限、paid_at 不足、金額不符、服務权限、reserve／consume／release／refund、重複事件、retry cycle／舊失敗、晚成功阻擋、角色降級既有保留、全額保留刪戶拒絕、Ledger 寫入失敗的兩錢包／訂單／付款授權回滾、真實收入 reverse 形成負數及新收入抵銷、account=sum(delta)、OFF／Migration 同版本重跑／verify。

PostgreSQL 實際競爭：同師資兩訂單同時雙錢包保留只有一筆成功；收款／取消；重試／舊成功；收入入帳／消費；收入扣回／消費。每組核對終態及帳戶總數，deadlocks=0，不宣稱所有可能時序。

主要指令（由 eclado/ 執行）：

```sh
PGLITE_MODULE=/private/tmp/eclado-member-pricing-db.KB6hV3/node_modules/@electric-sql/pglite/dist/index.js node --test tests/integration/instructor-reward-checkout-db.test.cjs
EMBEDDED_POSTGRES_MODULE=/private/tmp/eclado-1b-postgres-tools/node_modules/embedded-postgres/dist/index.js node --test tests/integration/instructor-reward-checkout-db.test.cjs
npm --prefix payment-api test
npx playwright test tests/instructor-reward-checkout.spec.ts tests/instructor-reward-queries.spec.ts tests/instructor-reward-payment.spec.ts tests/student-pricing.spec.ts tests/assisted-orders.spec.ts --project=chromium --project=mobile-chrome --workers=1
npx playwright test tests/instructor-reward-checkout.spec.ts --project=chromium --project=mobile-chrome --workers=1
node /private/tmp/eclado-1b-build-isolated.cjs
git diff --check
```

九檔 PGlite 批次另包含 queries／ledger／snapshots／student-pricing／binding foundation／member-pricing／assisted-orders／payment-rpc-access。原18項依既有測試名稱篩選，不宣稱完整 regression suite。專案沒有 Lint script；執行語法／差異空白檢查，不將其冒稱 ESLint。早期 fixture 的金額／免運門檻假設及 selector 失敗已修正重跑；失敗／中止批次不列通過。

## 正式前置、回復與剩餘風險

1. 未驗證正式 Auth／PostgREST、完整正式 Schema／函式本體與 ACL、銀行 sandbox／正式卡／ATM／行動支付及晚回呼。必須核對銀行金額欄位／單位／明確失敗碼；未知／網路／pending（包括0）不釋放，留待既有取消／逾時處理。
2. 正式 Migration 順序：已存在的 S1／1B／1C／購物金 checkout 相依確認→2A→2B→3→4→各 verify；不重跑會覆蓋 S1 或目前 wrapper 的舊付款 Migration。此次沒有正式 Metadata／資料量核對。2B 非空 snapshot 無 state 的既有阻擋條件仍有效。
3. Stage4 原子安裝有 source marker 與同版本 rerun guard，但不能修復任意異名／異形或半安裝 Schema；正式前保存全部受影響定義／ACL／CHECK／Trigger 指紋，核對每項替換與相依，遇不一致先停。新增預設欄位保持舊資料相容。
4. SQL／Payment API／前端必須相容部署，舊三參數銀行入口在錢包訂單被拒絕；未核對真正 Payment API 的 Git 自動發布流程。僅允許使用者另外批准的 Git 自動部署，禁止直接 Vercel。正式學生價保持 OFF，不因此階段完成自行啟用。
5. 異常證據永久保留；沒有自動銀行退款或新異常結清 API。管理員仍須依既有退款／對帳流程人工處理，不得直接刪 exception、改 Ledger 或改餘額繞過。後续營運處理畫面／規則若需新增另准。
6. 非返饋訂單的既有取消後晚付款復活與代客重新配庫存，以及既有代客 Auth 刪除衝突獨立待辦。本次非全域付款安全重構。
7. 本機測試不覆蓋正式高資料量／所有併發排程／真實銀行重送。不同成功 create 請求仍可建立不同訂單；財務冪等以同訂單及 reservation cycle 為單位，不能宣稱所有跨請求建單去重。
8. 回復先停止新返饋折抵入口／撤新建單 EXECUTE並依 Git 流程發布相容版本，已保留訂單仍需原版本完成結算；不可直接降回不理解第三錢包項的 Payment API，不 DROP 帳務表／欄位／Ledger。正式回復腳本與停用順序須視實際未結 obligations 另行驗證，不能只 rollback migration。

建議接受階段 4 **本機驗收**；上述正式整合 gate 尚未通過，不建議直接正式部署／啟用。階段 5 未開始。
