# 階段 2B｜返饋帳戶、Ledger 與訂單事件

2026-10-12：本機實作及隔離驗證；使用者已接受本機驗收。沒有正式 DB 操作、部署、commit／push、main 合併或階段 3；學生價格未啟用。

## 先檢查與規劃

依統一開發 v1.3，2A 本機驗收已由使用者接受。一般及代客建單透過 2A 私有 snapshot INSERT 接入，無需再次 patch 定價／建單函式。

原 `set_order_first_paid_at()` 是按 paid／配送狀態填時間；`OrdersPage.updateStatus()` 可手動 paid。原 `resolvePaymentQueryState()` 還可能從本地訂單狀態推導付款表 paid。因此 paid_at、orders.status、payment tables 的 paid 均不作獨立發放證據。

最小方案：新增私有帳戶／訂單返饋狀態／不可變 Ledger／不可變收款證據，加 snapshot INSERT、order status／DELETE 及 profile DELETE trigger；銀行代理只在實際銀行 query 確認成功時寫證據。原價格、庫存、促銷、購物金、銀行金額及付款重試授權保持原樣。預估含併發與回歸 18–28 工程工時。

## 本次使用者確認

- 老師餘額非 0（含負數）或有待入帳返饋時拒絕刪除；零餘額且無待入帳可刪，永久保留 UUID／帳務歷史。規則按帳戶身份執行，角色降級不清除帳務。
- 學生刪除不清除老師的快照／帳務，沿用 1B 結束關係。原有「擁有代客訂單時 Auth SET NULL 被保護拒絕」保持獨立待辦。
- 人工匯款／現金使用管理員明確確認收款，後端記應付金額、操作者、時間；不靠單純 paid／delivered 或 paid_at 自動認定人工收款。

## 資料與流程

`supabase-instructor-reward-ledger.sql` 新增四表：

| 表 | 用途 |
|---|---|
| instructor_reward_accounts | signed balance、非負 pending_balance、active／closed、version |
| instructor_reward_order_states | snapshot amount／老師 UUID，pending／credited／cancelled／reversed |
| instructor_reward_ledger | 一訂單每事件唯一；pending／credit／cancel／reverse 的金額、signed delta、兩餘額 after、actor UUID／時間 |
| instructor_reward_payment_receipts | 首份有效 bank／admin 收款證據、原應付金額、provider ref／proof_kind 或操作者 UUID／時間 |

四表 RLS 無客戶 policy，PUBLIC／anon／authenticated／service_role 都不可直接讀寫或 TRUNCATE；Ledger sequence 同樣封閉。Ledger／收款證據 UPDATE／DELETE trigger 拒絕任意改寫。無 Auth／orders 的 cascading FK，不複製姓名、Email、地址、銀行帳號或 PayToken。

- snapshot 建立 → 同一原建單交易初始化 pending 狀態／Ledger／帳戶待入帳額。OFF 無 snapshot 就沒有返饋帳務。
- 有效收款證據且配送 delivered／現場 picked_up → credit 一次，待入帳額轉 signed balance；付款先到或完成先到都會重檢。
- pending 取消／整筆退貨 → cancel，僅扣 pending；credited 取消／退貨 → reverse，按快照全額扣回一次，允許 signed balance 為負。
- cancelled／reversed 不再發放。對有返饋狀態的原取消／退貨單，DB 拒絕重新開啟；晚到銀行成功仍可保留證據，但不重開訂單、不再入帳。沒有放寬原代客保護。
- 未入帳 order DELETE 解除待入帳；已有 credit 的訂單不可刪，延續原「已付款訂單保留帳務」限制。快照／Ledger／收款證據不連鎖刪除。
- 入帳／扣回採 order → order state → Auth parent KEY SHARE → account row lock；同帳戶多訂單序列化，避免 Auth DELETE 與帳戶檢查倒置。profile DELETE guard 與 account closure 在同一刪除交易，非零／pending 拒絕時既有關係 cleanup 一併回滾。
- 關閉學生價不會取消已建立的金融義務；原有 pending／credit／reverse 繼續按證據／事件處理。

`append_instructor_reward_event()`、`reconcile_instructor_reward_order()` 及 Trigger helper 均私有。只有 `record_verified_instructor_reward_payment()` 授予 service_role（函式內再次檢查 auth.role 與付款嘗試歸屬）；管理員的 requirement／confirmation RPC 授予 authenticated，但函式內限定有效 admin 及 orders.write。沒有老師餘額／報表公開 RPC，未進入階段 3。

## 銀行證據與人工確認

- `payment-api/reward-payment-evidence.cjs` 只選既有簽章驗證後 query 的 `OrderList` paid code，或帶相符 OrderNo 的 OrderPayQuery `Status=S`＋PayOut／CaptureOut。不採 webhook body claim、local paid status 或 paid_at；缺少可核對 OrderNo 的 PayOut result 不猜測歸屬。
- 銀行 RPC 核對 provider ref 確屬原 order authorization／instruction／attempt；金額由不可變原 `orders.payment_amount`（否則 total）取得，不接受 caller amount、不改舊金額計算。
- `server.js` 在 ReturnURL／webhook 的原 status／通知寫入前記收款證據；query-payment 在真正 bank query 之後記證據。證據持久化錯誤往外拋，供失敗重試，不被付款 state save 的既有 catch 吞掉。只對缺少新 RPC 的 PGRST202 做 pre-2B 相容；42883 內部相依錯誤不靜默降級。
- AdminApp／OrdersPage 沿用權限、元件與樣式。標記 paid 時若有 snapshot 且無證據，先要求明確全額收款確認；另有「確認人工收款」處理完成狀態先到的情況。API 僅傳 order_id／confirmed，不傳金額或操作者，後端取權威資料。
- 無 snapshot 或舊 DB（PGRST202）維持原收款流程；人工確認 RPC 沒有更新銀行金額、庫存或購物金。通知仍由原 status flow 處理，沒有新增通知／銀行退款 API。

## 修改檔案（本階段 13 檔，不含之前未提交的 2A／正式紀錄）

| 檔案 | 用途 |
|---|---|
| supabase-instructor-reward-ledger.sql | 四表、10 函式、六 Trigger、ACL／生命週期 |
| supabase-instructor-reward-ledger-verify.sql | OFF、權限、快照／Ledger／逐筆餘額對帳 |
| payment-api/server.js | 原 bank query 的證據接點，不改金額／授權 |
| payment-api/reward-payment-evidence.cjs | 正面銀行證據選取 |
| payment-api/reward-payment-evidence.test.cjs | 拒絕推導狀態／body claim／錯誤 reference |
| payment-api/reward-payment-persistence.test.cjs | RPC 參數／持久化失败重試／舊DB與部分安裝區分 |
| src/services/rewardPayment.js | 管理員收款 requirement／confirmation |
| src/admin/AdminApp.jsx | 原 orders.write＋admin 權限傳入 |
| src/admin/pages/OrdersPage.jsx | 明確確認收款、拒絕不寫入、同步防重 |
| tests/support/eclado-mocks.ts | 預設無 snapshot 的完整 mock，避免新RPC外連 |
| tests/instructor-reward-payment.spec.ts | 桌面／手機确认、唯讀權限、依賴錯誤 |
| tests/integration/instructor-reward-ledger-db.test.cjs | 真實引擎／財務／Auth／併發及原 paid_at Trigger |
| docs/instructor-reward-ledger.md | 此設計／證據／限制 |

## 實際測試結果

- PGlite七檔批次 8通過／0跳過；之後 2B 最新單檔再通過（含原 paid_at Trigger、原購物金折抵100及銀行應付式、逐筆 running balance verify）。
- 最新 PostgreSQL17.6 2B整合檔 1通過／0跳過。不同 backend PID：receipt／delivered、重複 returned、receipt／cancel、同帳戶不同 order credit／reverse；Auth DELETE 確實 lock wait，提交後見 pending 拒絕；deadlocks=0。
- 覆蓋 pending→credit／cancel→禁止重開、credit→reverse只一次；證據先到／完成先到；現場 picked_up 與一般 delivered 區分；收款金額只用銀行應付，不因普通購物金減少返饋快照。
- 原 paid_at Trigger 實際把 delivered 填 paid_at，仍不入帳；付款表 paid 也不入帳。只有獨立 bank／admin receipt 後才入帳。
- Ledger credit INSERT 注入失败：帳戶／狀態／receipt 同交易回滾，重試一次成功；沒有錯帳或重複 credit。
- 負額案例用 owner-only fixture 模擬未來已使用余额，再 reverse成負數、新credit抵銷，並驗證負額／pending拒絕刪除；整段 BEGIN／SAVEPOINT／ROLLBACK，沒有把虛構支出留下Ledger，不宣稱已实现折抵／提領。之後每筆 balance_after／pending_after與 running sum、帳戶與總Ledger、snapshot与投影均核對。
- 學生只擁有普通訂單可成功 Auth 刪除，教師 pending／snapshot保留；老師正負額／pending拒絕，零額且無pending可刪、帳戶closed、歷史留存。獨立代客刪除衝突不修補。
- 四表直接存取／TRUNCATE、內部 posting RPC拒絕；學生不能人工確認；不可變Trigger；SQL重跑／唯讀verify通過；原有函式定義＋ACL指紋一致，未重寫原購物金／定價／付款SQL。
- 金流代理單元回歸51通過；最後兩證據檔再3通過，含42883不能降級。
- Playwright含學生價格／代客／人工確認桌面手機56通過；最後人工確認／讀取失敗專檔6通過，與批次有重疊，不加總當獨立案例數。
- 既有訂單管理／狀態更新與出貨托運單／LINE通知回歸：桌面與手機共4項通過。
- 最後隔離 Build通過：457模組、1mock商品／8文章；既有大chunk警告保留。node --check／diff空白檢查通過，專案無Lint script。
- 開發中曾修正SQL CASE括號、fixture漏載出貨相依、新UI fixture與native dialog等待；失敗／中止批次不算通過。

## 正式前置／尚未涵蓋

1. 真實 Auth／PostgREST／完整正式Schema、銀行sandbox回應格式與重送機制仍需核對。本次驗證是實際SQL隔離fixture及mock API，不是正式付款驗收。
2. 正式銀行代理目前未部署本次接點；SQL、前端、payment-api必須版本相容後才可考慮啟用學生價。網站及代理的Git自動部署對應要另外核對；不得直接操作Vercel。此階段不授權任何部署或啟用。
3. 缺少可定位bank query證據時不發返饋，需重查或管理員明确確認；不把原付款表的paid當銀行證據。
4. Migration拒絕已有2A snapshot但沒有2B狀態的資料，不自動依目前status／paid_at補發；若遇此狀況先停下規劃獨立 reconciliation。首次正式安裝前須核對資料量，不能假定一定為空。
5. 負額算式已驗證，折抵／提領仍屬後續階段，沒有spend／withdraw API。未來零餘額刪戶後再退貨可能留下closed帳戶負債，階段4／5需要在既定刪除規則下安排對帳／處理，不刪除既有帳務。
6. 併發覆蓋所列排程，不是全部排程的證明；出貨group準備與其相依使用實際SQL，追加quote沿用1C stub，完整運費退還組合仍待整合驗收。
7. 独立待辦：既有擁有代客訂單的Auth刪除衝突；不以放寬protect_assisted_order避開。
8. 回復優先學生價OFF，暫停新流程；另行批准保存／恢復版本及ACL。保留帳戶、Ledger、receipt與UUID歷史，禁止把rollback當成刪金融資料。正式操作另准，本機成果尚未commit／push。

## Git 提交授權（2026-10-12）

使用者接受 2B 本機驗收，批准將 2A 前置成果與 2B 分為兩筆 commit 並 push 至 `codex/instructor-student-rewards`。先前未 commit／push 的敘述為當時實作紀錄；實際提交結果記於外部「統一開發.md」。階段 3 尚在檢查，因本次 Git 任務暫停，未修改其程式。
