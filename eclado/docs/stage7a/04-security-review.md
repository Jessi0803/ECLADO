# 7A安全與權限檢查

範圍為師生／價格／返饋／付款接點與依賴；採來源、正式Metadata、真SQL角色測試及Mock API驗證。非全倉庫窮盡攻擊掃描，也不保證未測路徑無漏洞。

| 控制 | 結論與實際證據 |
|---|---|
| S1 | 正式Metadata anon/auth無EXECUTE、兩本體hash與S1紀錄相同；隔離payment-rpc-access測試及Payment API合法會員／訪客憑證回歸通過。 |
| RLS／直接ACL | 2A～6新15表RLS且無客戶policy，撤anon/auth/service直接表／sequence存取；PG SET ROLE實際42501。正式尚未安裝新表，不標正式PASS。 |
| SECURITY DEFINER／search_path | 新公開helper採空search_path、逐欄schema限定，私有計算／posting拒客戶及service直接EXECUTE。既有creator保留原public/auth/extensions path，不宣稱全庫空path。 |
| 教師／學生隔離 | auth.uid本人及目前instructor校驗，歷史snapshot授權；不直接回傳學生email／phone／address或比較價／折數。商品金額與返饋可反算比較價已由使用者接受。 |
| 管理權限 | admin/super_admin與orders.read＋members.read交集；withdraw read/manage，補發manage＋notifications.send；實際permission函式測試拒絕缺權限。catalog_editor不是金融admin。 |
| 後端計價 | quote/create共用學生與wallet核心、DB CHECK三項付款公式、商品cap與銀行>=1；frontend不傳可信角色／餘額。PGRST202相容只認真正缺RPC，部分安裝不降級。 |
| 付款證據 | paid_at／本地paid不足；必須綁provider的銀行正面query或人工明確確認。重複／晚到／retry cycle／取消競爭在PG及mock API通過；正式bank單位仍NOT VERIFIED。 |
| Ledger／hold／冪等 | unique event與cycle、version、固定鎖序、不可變trigger、全交易rollback；return可負、新支出拒負。多連線不是所有排程證明。 |
| 銀行加密 | `_reward-bank-crypto.js:14 encryptBank` AES256GCM、12byte IV、owner AAD、keyID；AAD不符／竄改／rotation測試拒絕／成功。keyring僅server、禁止VITE、HTTP no-store／generic錯誤。尚未配置正式key或復原演練。 |
| 銀行授權 | `reward-bank.js:12` Auth user.id→p_actor，DB再校驗instructor／admin manage；read-only不能看完整snapshot，記錄查看事件。格式驗證非銀行戶名／帳號存在驗證。 |
| Worker | `reward-notification-worker.js:19` core拒銀行keyring，endpoint再次拒；claim/complete service-only、token fencing及原target/key，有限6次／23h窗口。 |
| 對帳 | `reward_financial_checks`唯讀statement快照；run只寫runs/findings，故障不解除原異常。受限入口不能改餘額。 |
| Service Role邊界 | 新返饋表對service直接ACL封閉；**service_role憑證不是專用worker最小能力**。正式現有購物金表對service可UPDATE，銀行cipher RPC亦授service；只有env不含key不能宣稱此憑證無其他能力。若要求worker憑證絕不能改任何財務，需另准專用受限DB身份／gateway及RPC身份改造，不能只刪env欄位。 |
| 日誌與保存 | 通知固定模板不含銀行／reference／內部自由原因；worker只記action／時間／count／status；cipher／key不記log。會員刪除清目前聯絡／bankprofile，財務snapshot UUID歷史保留；有餘額／pending／hold拒刪。 |
| 正式既有ACL | Metadata可見部分legacy表有較廣TRUNCATE grant，RLS不限制TRUNCATE。未發現客戶端可直接發TRUNCATE的入口，不據此宣稱已可利用漏洞；另案收斂ACL及可信SECDEF路徑審核。 |

## 已知／待決風險

- 指定會員優惠券quote/create差異是已驗證結帳相容性問題，需獨立修補，不套用未驗證舊SQL。
- 非返饋訂單的既有取消後晚付款復活、代客Auth刪戶衝突仍獨立列管，保護範圍不得擅自擴張。
- 普通成功create沒有全域request-key去重；同訂單帳務冪等不保證不同請求只建一訂單。UI同步ref與代客request-key已有測試。
- 零額刪戶後原學生再退貨可能closed負債；保留UUID，不新增債務營運規則。
- 官方LINE5xx可能已接受；立即Email備援可能重複，屬使用者已接受策略。timeout同key、成功不等於可達或已讀。
- Preview正式連線寫死、正式API版本不同、真Auth／PostgREST、keyring操作及worker隔離未驗證，皆不能以Mock宣稱正式安全。

來源：`supabase-instructor-reward-checkout.sql:183 quote_order_with_wallets`、`:205 create_order_with_wallets`、`:283 record_verified_reward_wallet_payment`；`supabase-instructor-reward-withdrawals.sql:165 request_my_reward_withdrawal`、`:183 manage_reward_withdrawal`；`supabase-instructor-reward-notifications.sql:71 claim_reward_notifications`、`:122 complete_reward_notification`；`supabase-instructor-reward-reconciliation.sql:131 run_reward_reconciliation`。精確簽章與ACL見Metadata，隔離驗證見03矩陣。
