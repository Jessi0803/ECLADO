# 階段 5｜銀行資料、全額提領與人工匯款

2026-10-12。本機實作與隔離驗證；正式未安裝／部署，未 commit／push，未進入階段 6。分支 `codex/instructor-student-rewards`，基線 `67c249b316dd0a30b0dc36c6d7f27c54070740fc`。原四個未追蹤檔案不屬本次範圍。正式學生價維持 OFF。

## 檢查與已確認決策

已完整閱讀專案外「統一開發.md」v1.6（含階段4 Git紀錄）及本次附件。現有程式確認：

- `supabase-student-reward-snapshots.sql:16` 保存不可變師生／商品快照；返饋收入不由提領重算。
- `supabase-instructor-reward-ledger.sql:72` 的 `append_instructor_reward_event` 使用 Auth 父列→帳戶 row lock；`:101` 的 `reconcile_instructor_reward_order` 用有效收款及 delivered／picked_up，退貨依原快照 reverse。
- `supabase-instructor-reward-checkout.sql:58` 的 `reward_credit_event` 在建單保留時減少 signed 可用 balance，購物保留存在 reserved_balance；`:205` 的 `create_order_with_wallets` 與版本確認已存在，不能再從 balance 重扣一次購物保留。
- `supabase-instructor-reward-queries.sql:57` 的 `assert_instructor_reward_read_admin` 是兩 read 權限及 admin 身分；`:98` 本人 RPC 只目前 instructor。
- `supabase-internal-staff-member.sql:84` 的 `set_member_role_with_membership` 鎖 profile，降級不刪返饋帳務；`api/admin-delete-member.js:136` 刪 Auth，DB guard 控制帳務限制。
- 專案無老師收款銀行表、提領流程、銀行休假資料或可直接沿用的銀行資料加密金鑰。既有 `order_payment_instructions.atm_account` 是顧客繳款虛擬帳號，不能當老師收款帳號。
- `api/professional-quarterly-notices.js` 已有台北時區、LINE優先／Resend備援與delivery key；`supabase-payment-notification-reliability.sql` 有訂單通知重試。階段5不呼叫或改寫通知，只保存 requested／paid／failed 等可供階段6取用的事件，不宣稱通知已實作。

開始前重新執行隔離 PostgreSQL17.6 階段4測試：1通過、0跳過、deadlocks=0，未發現新的本機帳務一致性阻擋。正式銀行金額契約／Auth／Schema未驗證限制保留。估計含驗證32–48工程工時，非實際計時。

使用者本次已確認五項：

1. Asia/Taipei，每月10日00:00截止；10日當天列下月。10日遇假日順延不延後申請截止；週六／日及銀行業休假不匯。管理員每年核對銀行公會資料後匯入，缺年度資料拒絕申請。銀行公會確實提供年度[金融業休假日資料](https://www.ba.org.tw/consumerHoliday/index)；使用版本快照，不採政府辦公日曆直接推定銀行營業日。
2. 明確失敗且確認銀行未付款：全額返還、不收15元，原申請永久保留為failed、不重匯；老師維護銀行資料後新申請。結果不明仍保留，查帳後再處理，不能先返還。
3. 申請前非instructor拒絕；已成立申請降級後履行。正餘額與歷史保留，恢復角色後恢復資格，不沒收。
4. pending→processing→paid／failed／unknown；先由一人領取處理權。完成必填實際日期／銀行交易序號／實匯金額，不必圖片。終態不可覆寫，只追加更正／異常事件，不自動重匯退款。銀行已匯而後台失敗時重送同結果，先查帳、不再匯款。
5. 銀行代碼／名稱／分行名稱／戶名／帳號必填，不收身分證。新 rewards.withdrawals.read／manage，只預設授admin／super_admin；read遮蔽、manage才可查看完整銀行快照。

## 修改檔案（17檔，相對 eclado/）

| 檔案 | 用途 |
|---|---|
| supabase-instructor-reward-withdrawals.sql | 原子Migration、4表、14函式、4 Trigger、Ledger與權限擴充 |
| supabase-instructor-reward-withdrawals-verify.sql | 唯讀OFF／RLS／ACL／帳務一致性核對 |
| api/_reward-bank-crypto.js | AES-256-GCM、owner AAD、key ID、格式與遮蔽 |
| api/reward-bank.js | Auth驗證、服務端加密／受限解密、no-store |
| src/services/rewardWithdrawals.js | quote／request／management／bank API契約 |
| src/components/account/RewardWithdrawalsPanel.jsx | 銀行管理、預覽確認、全額申請、歷史與保留額 |
| src/components/account/InstructorRewardsPanel.jsx | 提領子區塊與新Ledger事件 |
| src/admin/pages/RewardWithdrawalsPage.jsx | 日曆管理、領取處理、凭證／失敗／查帳／更正 |
| src/admin/AdminApp.jsx | 受權限保護的頁面接點 |
| src/admin/components/Sidebar.jsx | 提領選單 |
| src/admin/domain/access.js | 專用read／manage能力 |
| tests/support/eclado-mocks.ts | 未安裝stage5的安全mock預設 |
| tests/instructor-reward-withdrawals.spec.ts | 桌面／手機提領、銀行遮蔽、匯款／同鍵重送 |
| tests/integration/instructor-reward-withdrawals-db.test.cjs | 真SQL／權限／財務／多連線 |
| tests/integration/instructor-reward-checkout-db.test.cjs | 匯出既有stage4場景供相依測試，原斷言保留 |
| tests/integration/reward-bank.test.cjs | 加密／rotation／越權／API測試 |
| docs/instructor-reward-withdrawals.md | 本報告 |

外部「統一開發.md」另更新階段5決策、狀態與證據，不放第二份進repository。

## 資料與安全設計

四表：`instructor_reward_bank_profiles` 保存目前加密資料、遮蔽投影及version；`instructor_reward_bank_calendar_versions` 保存年度日期／來源／操作者及不可變版本；`instructor_reward_withdrawals` 保存UUID、本人request_key、金額／15元／實匯、銀行不可变cipher快照、原始批次／預定日／日曆版本、狀態與不可變終態結果；`instructor_reward_withdrawal_events` append-only操作及敏感快照查看稽核。

全部RLS、無客戶端policy、撤銷PUBLIC／anon／authenticated／service_role直接表與sequence權限，不增加cascading財務FK。snapshot、已完成／失敗結果禁止UPDATE／DELETE；更正只追加事件。現有profile刪除後清除目前bank_profile，但財務銀行快照保留；提領hold未結清時禁止刪戶。

銀行所有內容（包含戶名及完整帳號）在伺服器使用AES-256-GCM加密、随机12-byte IV、驗證tag，AAD绑定owner UUID。DB只保存cipher與masked資料，不保存解密金鑰；歷史snapshot保存key ID，rotation需保留舊key。獨立server-only `REWARD_BANK_ENCRYPTION_KEYS`（key ID→32-byte key的base64 JSON）與 `REWARD_BANK_ACTIVE_KEY_ID`；不得使用VITE前綴、銀行金流密鑰或SQL常數。本次沒有修改任何環境設定檔或生成正式key。

`reward-bank.js`先向Auth驗證Bearer，從真實user.id取得actor，不採caller owner。save／read本人需DB再次確認目前instructor；完整提領snapshot須active admin／super_admin及manage，並留下read事件。HTTP no-store，generic錯誤，不記錄request body／帳號／cipher；React只短暫memory，輸入與完整snapshot在focus清除、不存localStorage／sessionStorage。完整快照只在管理者明确點擊後解密返回，read-only一般報表只masked。

格式驗證是銀行代碼3位、帳號6–20位數字及必填長度／控制字元檢查；不是銀行帳戶存在、戶名一致或銀行代碼／名稱配對的外部驗證。人工匯款者仍應核對資料。本機純crypto實測；正式secret管理、備份／rotation／復原演練及真實serverless/Auth部署仍待驗證。

公開authenticated RPC：`quote_my_reward_withdrawal()`、`request_my_reward_withdrawal(uuid,jsonb)`、`get_my_reward_withdrawals(integer)`；管理員同角色/專用能力檢查：`get_admin_reward_withdrawals(integer)`、`manage_reward_withdrawal(uuid,uuid,text,bigint,jsonb)`、`publish_reward_bank_calendar(integer,date[],text)`。service-only銀行cipher RPC：`save_reward_bank_profile(uuid,jsonb,jsonb,bigint)`、`read_reward_bank_cipher(uuid,uuid)`，不能從客戶端直呼。

其他schedule、posting、projection、guard均private EXECUTE，SECURITY DEFINER空search_path。權限CHECK擴充原表达式，保留現有permission；沒有改原orders.write／shopping-credit／S1授權。前端入口與後端權限一致。

## 帳務與匯款流程

現有balance已扣購物保留，因此全額可提領=max(0,balance)，不再次扣reserved_balance。新增withdrawal_reserved_balance與Ledger withdrawal_reserved_delta／after，分開顯示購物與提領hold，但同一帳戶row lock及版本。

| 事件 | balance_delta | withdrawal_reserved_delta | 金額 |
|---|---:|---:|---|
| withdraw_reserve | −申請額 | +申請額 | 當下全部可用額，>15 |
| withdraw_complete | 0 | −申請額 | 原申請額；實匯=申請額−15 |
| withdraw_release | +申請額 | −申請額 | 明確未付款，全額含原15 |

Ledger.order_id只對提領允許NULL，新增withdrawal_id；CHECK規定兩種來源只能擇一，不偽造訂單。原unique(order,event,cycle)不變；新unique(withdrawal,event)只處理提領。舊Ledger不UPDATE，新增欄位0預設；收入及購物事件也寫當下withdrawal_reserved_after，維持逐筆running sum。

本人申請：Auth父列KEY SHARE→目前profile SHARE→帳戶FOR UPDATE→銀行profile SHARE→後端quote比較→insert immutable申請→post Ledger→requested event，同一交易。confirmation包含全額／fee／net、銀行version／masked、accountversion、批次／calendarversions。任何過期資料40001，重新報價確認，前端傳入額不作權威。不同key競爭相同可用額只一筆成功；相同本人key回原申請，不再扣。

管理結果：先lock withdrawal→Auth父列→同account，既有收入／消費帳戶鎖序保持。claim用version只允許一個processor；沒有自動逾時移交或釋放（避免銀行已付卻重匯）。paid必填日期（不可未來）、reference與後端net額；屬管理員提供的銀行憑證記錄，沒有查銀行API，不冒稱銀行已驗證。failed須confirmed_unpaid=true才Ledger全額release；unknown維持hold。paid／failed終態只允許correction追加，不覆寫或觸發額外入帳。

重送event_key若actor／action／details相同回現況，若不同40001。前端同步ref防連點，網路結果不明保留原key／payload重送，明確SQL拒絕則允許重填。無自動banktransfer，不可能以DB交易保證人工銀行端只操作一次；需先查帳、不重复在銀行匯款。

老師降級後禁止新申請，既有hold與手續費／net維持。學生退貨仍依原income Ledger reverse，可用變負，不改提領額；新收入抵銷。明確失败返還可抵銷負數。會員刪除guard加withdrawal_reserved_balance，零額／無其他義務才可刪並保留財務UUID與加密snapshot。

## 驗證

實際SQL：PGlite十檔批次11通過0跳過；最新stage5單檔通過。PostgreSQL17.6 stage5單檔1通過0跳過，包含原stage4及1C/代客斷言，多連線deadlocks=0。15／16門檻用新師資、實際學生訂單一元逐項返饋產生真Ledger，整段隔離rollback，不直接seed余额。

實測涵蓋0／15／16／負數／全額／fixed fee、缺銀行／缺calendar、10日邊界與週末／指定假日、bank更改不影響snapshot、paid／failed／unknown／更正與非法跳轉、同key、role downgrade履行、六角色資格／權限、terminal不可改、SQL同版本重跑、RLS/ACL、Ledger insert失败全交易回滾、帳戶sum(delta)與逐筆running sum、Auth拒刪及結清後成功刪除且snapshot保留。

PG實際獨立連線：兩提領、提領／購物折抵、提領／income reverse、提領／新income credit、多管理員claim；不宣稱所有排程窮盡。銀行crypto/API 7項通過：owner AAD／randomIV／竄改拒絕／key rotation／無key拒絕／真Authactor／假owner忽略／通用錯誤／masked；RPC／付款upstream mock，不實際匯款。

Playwright新增專檔22項桌面／手機通過；包含匯款記錄及結果不明同key重送、完整snapshot只memory且focus清除。最終完整六檔回歸104項全通過（含上述22項，不相加作唯一案例數）；首批100項有兩個舊查詢錯誤提示selector失败，已修正主查詢失敗不顯示提領子區塊並重跑，不將失敗批次當全通過。

隔離Build通過：463modules、1mock商品／8文章；語法與git diff --check通過，無Lint script，既有chunk警告。正式Auth/PostgREST／完整Schema／銀行帳戶驗證／真實匯款／production日曆與密鑰均未驗證；完整通知與發送重試未做（階段6）。

主要命令（eclado/）：

```sh
PGLITE_MODULE=/private/tmp/eclado-member-pricing-db.KB6hV3/node_modules/@electric-sql/pglite/dist/index.js node --test tests/integration/instructor-reward-withdrawals-db.test.cjs
EMBEDDED_POSTGRES_MODULE=/private/tmp/eclado-1b-postgres-tools/node_modules/embedded-postgres/dist/index.js node --test tests/integration/instructor-reward-withdrawals-db.test.cjs
node --test tests/integration/reward-bank.test.cjs
npx playwright test tests/instructor-reward-withdrawals.spec.ts tests/instructor-reward-checkout.spec.ts tests/instructor-reward-queries.spec.ts tests/instructor-reward-payment.spec.ts tests/student-pricing.spec.ts tests/assisted-orders.spec.ts --project=chromium --project=mobile-chrome --workers=1
node /private/tmp/eclado-1b-build-isolated.cjs
git diff --check
```

## 正式 gate、回復與剩餘限制

- 順序：S1／1B／1C／既有購物金checkout基線相容核對→2A→2B→3→4→5→各verify；此次完全未讀正式DB或正式資料量，不重跑舊Migration覆蓋目前wrapper／S1。stage5同版本guard不修復任意半安裝或來源異形，正式前保存定義／ACL／CHECK／Trigger並核對窄幅patch。
- 正式學生價保持OFF，2A～5正式尚未安裝，前端與serverless／PaymentAPI版本發布與rollback須按已批准的Git自動部署規範另准，不直接Vercel，不把Git push當正式功能已驗收。
- 實際bank API keyring必須由正式secret store另設，不寫Git／SQL／前端；先backup、rotation／解密歷史演練與真Auth權限驗證。缺key服務失敗，不改存明碼完成畫面。年度銀行休假表要人工核對完整後發布；缺年拒絕，不推估假日。
- 既有stage4元／分銀行金額兼容及真实失敗碼、stage3報表大資料負載、代客Auth刪除衝突與非返饋晚付款復活仍独立待辦。沒有修改價格、訂單、購物金、Sinopac金額、付款授權或原通知機制。
- 已領取管理員失去權限時沒有自動移交／保留逾時返還；不能假設他未匯款。暫停並查帳；若要新增授權移交流程／規則需另批准。已記錯憑證的更正只追加紀錄，不自動改paid或bank資金。
- 零額已結清刪戶後若又有原學生退貨可產生closed負債，保留UUID／帳務，不抹除；帳號恢復／債務營運處理不新增。跨年度假日調整不追改既有預定日，臨時停業另由管理員查核並保留原快照。
- 回復停止新提領入口／request EXECUTE，保留正在处理的結算RPC、keyring及全部申請／Ledger／cipher歷史。不可DROP欄位或直接退回不理解withdrawal_id的舊報表；正式rollback依未結義務再驗證。不執行此回復。

業務A～D及銀行欄位／權限已確認；其餘為上述實作選擇及正式未驗證限制，不冒稱營運規則已另获批准。階段6通知／自動銀行匯款均未開始。


## UI 樣式一致性補驗（2026-10-13）

- 使用者要求近期各階段新增頁面沿用原網站欄位、標題、文字大小與框線；本次只UI呈現，不修改SQL／RPC／授權／金額／Ledger／付款規則。
- 檢查依據：AccountPage／ShoppingCreditPanel／CheckoutField、後台admin.css的procurement-header、admin-primary-btn／secondary-btn及白底卡片。
- 修改九檔：
- `src/components/account/InstructorRewards.css`
- `src/components/account/InstructorRewardsPanel.jsx`
- `src/components/account/RewardWithdrawalsPanel.jsx`
- `src/admin/pages/InstructorRewardsPage.jsx`
- `src/admin/pages/RewardWithdrawalsPage.jsx`
- `src/admin/components/StudentPricingSettingsSection.jsx`
- `src/admin/components/InstructorStudentSection.jsx`
- `src/pages/CheckoutPage.jsx`
- `src/components/checkout/CheckoutOrderSummary.jsx`

- 新CSS只作用reward-view及相关元件，前台32／手機24px主標、11px欄位標題、14px底線欄位；後台既有28px主標／手機22px、12px控制項及1px淡框。沿用既有色彩／字體tokens、primary／secondary按鈕，補齊disabled/focus與手機單欄，不變更全站樣式。
- 結帳返饋金摘要移除重複顯示，只在購物金旁顯示一次；兩錢包任一使用時標示尚需付款。僅顯示調整，原paymentTotal計算不變。
- Playwright四檔桌面／手機54通過；最後結帳摘要另12通過（與54重疊）；隔離Build通過464modules、1mock商品／8文章，既有chunk警告保留；git diff --check通過。沒有Lint script，本次不重跑未修改的DB測試。
- 初期JSX標籤閉合錯誤已修正後Build通過，失敗不算通過。快速模擬器手機工具列遮擋選單已改為動態高度避讓；不把此暫存模擬器當正式部署。
- 快速畫面驗收仍在http://127.0.0.1:5180；全部mock，無正式DB／銀行。模拟器啟動時重置假資料；snapshot僅本機截圖，非正式金融／RLS驗收。
- 使用者觀感／人工驗收尚待確認。未commit／push、未操作正式DB／部署／Vercel、正式學生價OFF，未進入階段6。
