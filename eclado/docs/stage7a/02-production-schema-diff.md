# 正式Schema與本機預期差異

使用者明確批准Supabase SQL Editor Metadata只讀，2026-10-13執行`BEGIN TRANSACTION READ ONLY`＋statement_timeout＋SELECT＋ROLLBACK；全文clipboard比對一致。輸出`read_only=on`，PostgreSQL17.6。只讀public catalog／既有角色與開關設定，未查會員、訂單、銀行列／金鑰，未呼叫業務RPC。[Metadata](../evidence/reward-stage7a/production-metadata.json)／[設定](../evidence/reward-stage7a/production-configuration.json)／[準備查詢](../reward-stage7a-production-metadata-readonly.sql)。第二查詢讀管理角色／權限設定與補充優惠券／購物金函式；設定enabled=false/version0。

本次觀察53張表／view、205函式、364約束、151索引、54policy、67非內部trigger。這些是整個public catalog的數量，不代表每個物件與完整本機商店一一相同或完成全庫安全稽核。無專案`supabase_migrations.schema_migrations`，不能還原安裝順序／時間。

| 分類 | 已核對結果 |
|---|---|
| A 已安裝且一致 | 1B四表＋1C開關表的欄位名／型別／NOT NULL與隔離基線一致，RLS啟用、anon/auth無直接SELECT。核心師生／學生定價函式normalized hash一致；有效綁定partial unique及刪除／audit trigger存在。 |
| A S1 | begin_order_payment_retry(text)、claim_order_payment(text,text) anon/auth EXECUTE=false、service=true；本體MD5分別fa7d19312d703e75ea947d9b382a7543／988815d333e5dd6b5f19283d4b56a8b5，與既有正式紀錄一致。 |
| A 設定 | 學生價OFF/version0；admin/super_admin有instructor_students.manage及member_pricing.manage。customer profiles仍六種角色；admin/super_admin/catalog_editor是另一層後台角色。 |
| B 尚未安裝 | 以下15張2A～6新表、新RPC／Ledger／withdraw與notice trigger皆不存在；orders.reward_credit_amount尚未新增。 |
| C 已有但不同 | 正式優惠券creator的member-target校驗較舊；報價helper已較新，重現quote/create不一致。此差異不能當作fixture可忽略。 |
| C ACL與fixture | 隔離1C基線在套S1前有PUBLIC EXECUTE；正式已正確收緊S1。正式service_role預設可執行某些1B／1Chelper，fixture無此grant。不依fixture ACL覆蓋正式ACL；新2A～6採顯式撤權。 |
| D 新功能缺依賴 | 2A～6本來尚未安裝，不能先呼叫新wallet／withdraw RPC；Payment API新證據模組也未發布。 |
| E 部署風險 | 舊API／新DB與UI不配套、Preview共用正式DB、coupon差異、舊migration重覆會覆蓋wrapper或授權。 |
| F 未確認 | 正式客戶資料一致性／數量／負載／歷史髒資料、銀行環境契約、完整Auth／Storage／Realtime schema、正式備份可復原性；本次未讀業務資料。 |

| 新表 | 正式狀態 | 本機預期 |
|---|---|---|
| `student_reward_snapshots` | B：尚未安裝 | 隔離SQL已建立／測試 |
| `instructor_reward_accounts` | B：尚未安裝 | 隔離SQL已建立／測試 |
| `instructor_reward_order_states` | B：尚未安裝 | 隔離SQL已建立／測試 |
| `instructor_reward_ledger` | B：尚未安裝 | 隔離SQL已建立／測試 |
| `instructor_reward_payment_receipts` | B：尚未安裝 | 隔離SQL已建立／測試 |
| `instructor_reward_reservations` | B：尚未安裝 | 隔離SQL已建立／測試 |
| `instructor_reward_payment_exceptions` | B：尚未安裝 | 隔離SQL已建立／測試 |
| `instructor_reward_bank_profiles` | B：尚未安裝 | 隔離SQL已建立／測試 |
| `instructor_reward_bank_calendar_versions` | B：尚未安裝 | 隔離SQL已建立／測試 |
| `instructor_reward_withdrawals` | B：尚未安裝 | 隔離SQL已建立／測試 |
| `instructor_reward_withdrawal_events` | B：尚未安裝 | 隔離SQL已建立／測試 |
| `instructor_reward_notification_outbox` | B：尚未安裝 | 隔離SQL已建立／測試 |
| `instructor_reward_notification_attempts` | B：尚未安裝 | 隔離SQL已建立／測試 |
| `instructor_reward_reconciliation_runs` | B：尚未安裝 | 隔離SQL已建立／測試 |
| `instructor_reward_reconciliation_findings` | B：尚未安裝 | 隔離SQL已建立／測試 |

## 既有付款、會員與購物金契約

- 正式orders CHECK仍是`payment_amount + shopping_credit_amount = total`，兩錢包新欄尚不存在；stage4預期擴充三项相加。商品專業價／規格numeric及RLS／FK／庫存trigger維持正式既有定義。
- profiles.id→auth.users CASCADE、orders.user_id→auth.users SET NULL仍在；protect_assisted_order不能改user_id，既有代客刪戶衝突仍存在。
- student settings／binding無財務cascading FK，正式partial UNIQUE保護一學生單有效綁定；一對多老師不是唯一鍵。
- 正式snapshot及Ledger不存在，不能以OFF或「沒有報錯」宣稱已安裝。
- 證據中的[baseline-1c-metadata](../evidence/reward-stage7a/baseline-1c-metadata.json)、[expected-stage6-metadata](../evidence/reward-stage7a/expected-stage6-metadata.json)由隔離真SQL產出。Auth helper、部分shipping及table fixture是測試替身；不能拿fixture所有列／default／policy當作完整正式Schema。比較清單明確標示實際差異，不以rerun migration代替核對。
- 2A兩creator來源marker、stage4付款defaults／retry／claim marker正式可見；create_discount來源member-target差異須先處理。每次正式安裝前重新抓當下定義／ACL，不能永久依賴此快照。
