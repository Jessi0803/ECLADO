# 階段 6｜通知可靠性與財務對帳：檢查與設計草案

日期：2026-10-13。依外部「統一開發.md」v1.8及本次階段6附件。
**此為開始前盤點草案的歷史紀錄；A～E及5xx補充決策已確認，後續本機實作／驗證見 `instructor-reward-notifications-reconciliation.md`。**
本文的候選表名、RPC、重試與權限均為設計草案，不是已確認營運規則或已安裝功能。

## 現況與授權

- 分支 `codex/instructor-student-rewards`，HEAD `e81b4ccbf57707fc5e1c29fa819a50119afd7dce`，本機與遠端追蹤分支同步。
- 階段5及UI調整已commit／push，共23檔。階段5人工畫面驗收尚未獲明確確認，不改成已驗收。
- 任務開始前只有四個未追蹤檔：`.claude/launch.json`及三份`docs/student-pricing-production-*`紀錄／備份／回復檔，保留不修改。
- 本次未讀正式DB、不部署、不操作Vercel、不修改正式排程／金鑰、不寄真實通知、不匯款、不commit／push、不進入7。正式學生價格維持先前OFF要求，本次未連正式DB重新核對。

## 已驗證的程式接點

| 範圍 | 現有來源與結論 |
|---|---|
| 2A快照 | `supabase-student-reward-snapshots.sql:16`，`student_reward_snapshots`及`persist_student_reward_snapshot`；商品／師生／返饋不可變，不用當前價格重算 |
| 2B收入 | `supabase-instructor-reward-ledger.sql:72`，`append_instructor_reward_event`／`:101 reconcile_instructor_reward_order`；pending、credit、cancel、reverse，receipt及完成狀態才入帳 |
| 3查詢 | `supabase-instructor-reward-queries.sql:10`，`instructor_reward_report_internal`；`:57 assert_instructor_reward_read_admin`須admin＋orders.read＋members.read；既有基本旗標非完整对帳 |
| 4消費 | `supabase-instructor-reward-checkout.sql:58`，`reward_credit_event`及`:110 settle_order_reward_credit`；cycle保留／扣用／釋放／返還；balance已扣購物hold；payment exceptions保留未知／晚收款 |
| 5提領 | `supabase-instructor-reward-withdrawals.sql:150 post_reward_withdrawal`、`:165 request_my_reward_withdrawal`、`:183 manage_reward_withdrawal`；申請／結果與Ledger／事件同交易，unknown仍hold |
| 5事件 | 同SQL`:58 instructor_reward_withdrawal_events`，requested／paid／failed／unknown／correction及bank_snapshot_read；事件append-only、業務event_key防重；不能把每個稽核事件都當通知 |
| LINE／Email | `api/professional-quarterly-notices.js:49 send`直接用Messaging API與Resend，LINE HTTP失敗轉Email；兩者有provider防重鍵；fetch拋錯直接進failed，沒有統一timeout分類 |
| 季度佇列 | `supabase-professional-renewals.sql:129`為季度專用表，`:1383 claim_professional_quarterly_notices`使用SKIP LOCKED、15分鐘恢復；沒有本階段要求的管道嘗試明細、領取token或有限重試制度 |
| 付款通知 | `supabase-payment-notification-reliability.sql:55 claim_order_payment_notification`、`:101 complete_order_payment_notification`；orders單組欄位，5分鐘租約，5／30／120分鐘重試，未設次數上限／claim token |
| 付款發送 | `api/sinopac/notify.js:419 pushLinePaymentNotice`與`sendPaymentEmailNotice`；LINE失敗Email備援；非本階段修補目標，不變更原付款／取消路徑 |
| Email模板 | `api/_email-template.js`的`buildBrandedEmailHtml`／`escapeHtml`；可沿用品牌版型及HTML轉義，CTA只允許服務端固定入口 |
| 管理員收件 | `api/professional-application-admin-notice.js:74`使用專業申請專用環境變數及預設Email，不能自行當提領收件制度 |
| 通知授權 | `api/_notification-auth.js requireNotificationAuthorization`驗證internal／特定payment secret或管理員；管理員身分不等於提領補發能力，新入口仍需DB能力驗證 |
| 排程 | `vercel.json:6`只有每日取消／季度通知；`payment-api/server.js:1540`有授權的付款補送端點，README僅建議每小時cron，未證實實際正式排程安裝 |

LINE登入／profiles.line_user_id能識別已綁帳號，但不能證明Messaging API一定可投遞（封鎖、token或服務錯誤仍可能發生）。本次不讀正式token／聯絡資料。

## 最小修改方案（待確認）

既有付款及季度佇列皆有特定來源、欄位及RLS，直接塞提領事件會混淆去重與保存規則；不重構成全專案通用通知系統。共用既有provider HTTP方式、品牌模板與身份驗證能力，新增僅供返饋提領的受限Outbox及對帳資料。原訂單／季度通知繼續原流程。

候選新增四表：

1. `instructor_reward_notification_outbox`：來源event ID、類型、收件UUID／管理名單識別、不可變安全金額／日期payload、版本、防重鍵、管道／狀態／嘗試數／next_retry_at、lease token／deadline、provider ID與遮蔽錯誤。不含bank_cipher／bank_masked／完整帳號、自由輸入內部原因或學生聯絡資料。
2. `instructor_reward_notification_attempts`：每次claim／管道／補發與結果的append-only稽核；只存必要遮蔽收件資訊／錯誤分類，不存provider完整回應、密鑰或通知原始個資。
3. `instructor_reward_reconciliation_runs`：範圍、開始／完成／失敗、規則版本、資料快照或水位、檢查／異常筆數及批次進度。
4. `instructor_reward_reconciliation_findings`：穩定規則＋來源UUID＋必要cycle的唯一鍵、expected／actual安全投影、首次／最後發現、仍存在／已解除；重掃更新同異常，不刪历史。重現已解除異常仍復用識別並留下執行紀錄。

新表RLS與直接ACL封閉，空search_path SECURITY DEFINER、公開RPC逐項身份／能力驗證。私有helper不授service_role直接執行，worker專用RPC只回安全投影、不呼叫銀行解密RPC；同程序不載入銀行keyring。service_role本身仍是高信任憑證，不能宣稱被RPC設計完全限制所有既有資料權限；正式若要更強隔離需另外審核專用角色／部署，不本次擅自新建平台。

事件接入：在提領事件INSERT後，用私有Trigger建立requested的老師／管理員兩份投遞，以及paid／failed等已批准結果通知。相同來源＋收件識別＋版本unique；重送業務RPC不重建。Trigger僅寫DB，不發HTTP；任一交易回滾事件與Outbox均不存在，commit後才能派送。DB儲存事件失敗會回滾該DB交易以防漏事件，與「第三方通知失敗不能回滾已成立帳務」分開說明。

不修改原財務posting核心、Ledger／銀行快照、支付額、購物金、訂單／庫存；可能影響範圍為新Trigger的交易成本、後台查詢與派送。既有階段5事件是否回補成通知尚未批准；正式若遇非空歷史先回報，不默默寄舊通知。

## 投遞語意與恢復草案

- Worker有界批次claim，SKIP LOCKED＋租約＋fencing token；complete只接受當前領取token，過期worker不能覆寫新worker結果。
- 外部HTTP在DB交易外；每次外部呼叫有時間上限，同一通知版本／收件人／管道使用穩定provider防重鍵，成功回應／provider接受重試的結果需依官方契約核對。
- timeout與程序崩潰可能已送達，不能簡單當確定失敗。恢復時先重用原payload及key；超出provider去重有效範圍不能宣稱安全重送，改人工查核。管道切換或明確再寄仍可能重複，保留可追溯版本。
- 實際是可靠事件保存、可重試派送與可控去重，**不是外部全網路情境exactly-once**。
- 收件方式、重試、unknown／correction與降級通知按使用者待決策處理；實際收件變更、刪戶或無聯絡方式不能用歷史訂單個資回填，需以有限安全資料標記無可用管道。
- 拒絕任意client指定收件人／內容／財務事件；補發須合法現有事件、權限、理由、request-key及稽核，不變Ledger。

## 對帳不變條件（沿用現有帳務）

1. 帳戶四個餘額分別等於Ledger `sum(balance_delta)`、`sum(pending_delta)`、`sum(reserved_delta)`、`sum(withdrawal_reserved_delta)`；FULL JOIN檢查有Ledger無帳戶等缺失，不以NULL當合法零額掩蓋。四個after逐筆按帳戶／id等於running sum。
2. `balance`已反映兩種保留，不能再扣reserved欄位；負balance合法，其他保留／待入帳不得負。
3. snapshot師資／總返饋／逐項總和與order state及收入Ledger一致；pending恰一次，credit／cancel互斥，reverse必有原credit且只一次。完成＋有效receipt才credit；cancelled／reversed不復活。來源order刪除需區分已取消待入帳的合法歷史及違規缺失，不一律視為錯帳。
4. 收入pending總額等於pending_balance；不能只按orders.status或paid_at推斷付款。歷史歸屬取snapshot，不依現在綁定或價格。
5. 逐order／cycle檢查spend_reserve→consume／release互斥，consume後至多一次refund；reservation當前cycle、owner、amount與orders.reward_credit_amount一致；reserved總和等於帳戶購物返饋hold。釋放可能因明確失敗且訂單仍unpaid，不能錯判必須已取消。
6. 使用返饋金的有效銀行付款需符合既有receipt、例外及 `payment_amount + shopping_credit_amount + reward_credit_amount = total`；現有晚收款exception列待人工查核，不重跑會入帳的reconcile_instructor_reward_order。
7. 提領reserve恰一次，complete／release互斥；pending／processing／unknown保留原amount，總和等於withdrawal_reserved_balance。paid必有complete、淨額等於amount−15、fee_charged=15及必要憑證；failed必有release全原額、fee_charged=0；unknown不釋放。
8. 原fee=15是報價快照，failed時實收fee_charged=0，不把兩欄差異當錯帳。銀行匯款憑證是人工記錄，不宣稱已核對銀行真實資金。

對帳只讀財務來源並寫run／finding，不呼叫posting／付款／匯款RPC；不自動修正餘額或異常。每次以一致MVCC快照核對，避免讀到併發交易一半；分批需明確水位／完整掃描範圍，只有成功掃完相同範圍才能把未再見到的finding標解除。執行鎖、批次上限、索引及statement timeout控制成本；正式資料量負載待另驗。

## 使用者已確認的A～E（2026-10-13）

- A：無LINE直接Email；LINE明確失敗立即Email；timeout先同key重試LINE，仍未知人工查核，不立即雙管道。
- B：提領管理員明確指定Email名單；缺LINE／有效Email保留紀錄並列無管道；已成立申請降級仍發通知。正式名單及設定另准。
- C：unknown發「結果待查核／未確認成敗／返饋仍保留」；不傳內部reason。更正預設稽核，管理員明確選擇新的更正通知，不能直接發自由輸入內容或改原結果。
- D：每事件／收件人／管道最多6次，首次＋5次，間隔1／5／15／60／360分鐘；永久錯誤停止，超限／未知人工查核。未成功補發沿用key，已成功再寄新增確認版本與稽核，須受provider去重窗口約束。
- E：通知查看須提領read；補發須提領manage＋notifications.send；對帳查看沿用admin＋orders.read＋members.read，執行另需提領manage。本機worker模擬排程，不修改vercel.json／正式設定；正式頻率、worker密鑰、Email名單環境設定及費用後續另批。
- 上述A～E已透過本次問答確認，不把其他技術建議自動視為業務決策。A中5xx分類發現下列衝突，暫停實作等待補充確認。

## LINE 5xx備援衝突與官方契約

[LINE官方重試文件](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)明確指出5xx或timeout時仍可能已接受／送出；重用UUID防重鍵且原收件人／內容不變。200或帶accepted-request-id的409代表已接受，不代表老師真正讀到。防重鍵有效期24小時。

[Resend官方文件](https://resend.com/docs/dashboard/emails/idempotency-keys)同樣只有24小時防重保存；同key須保持相同請求，不能把不同收件人／內容當同一重試。

官方核對後，使用者明確選擇維持5xx立即Email，接受可能雙管道重複。此決策取代草案建議的5xx先LINE重試；timeout／連線中斷仍同key重試LINE，不宣稱exactly-once。

worker恢復／人工補發還需防止超過24小時的舊key被當成安全去重；缺最後有效時間時不猜測已送或未送，列人工查核。正式收到provider接受回應後的可達性／封鎖狀態仍未驗證。

## 實際補驗與後續工作量

- `node --test tests/integration/professional-quarterly-notices.test.cjs tests/integration/professional-application-admin-notice.test.cjs`：6通過、0跳過；provider／DB API為Mock，未寄通知。
- `EMBEDDED_POSTGRES_MODULE=/private/tmp/eclado-1b-postgres-tools/node_modules/embedded-postgres/dist/index.js node --test tests/integration/instructor-reward-withdrawals-db.test.cjs`：隔離PG17.6，1整合測試通過、0跳過。包含既有1C／代客／4／5與提領多連線財務斷言，deadlocks=0。最初沙箱監聽EPERM失敗，授權本機監聽後重跑通過；不將失敗算通過。
- 本次未發現新的階段5本機財務一致性阻擋，不代表完整安全審計或人工驗收。正式銀行／Auth／PostgREST／Schema及stage5未完人工驗收仍保留。
- 尚未實作階段6，未跑其PG／RLS／worker／Playwright／Build；已有基線通過不能當成階段6通過。無Lint script。

| 階段6內部工作 | 預估工程工時（非實際計時） |
|---|---:|
| Outbox／事件Trigger／受限RPC與投遞恢復 | 12–18 |
| 共用provider能力／模板／本機worker與補發 | 10–16 |
| 對帳不變条件／run／finding與受限RPC | 12–18 |
| 既有樣式後台通知／對帳頁面 | 6–10 |
| PG17.6多連線／權限／Mock／桌面手機回歸／Build／文件 | 12–18 |
| 合計 | 52–80 |

預估不包含正式平台、名單／secret設定、真LINE／Resend投遞、正式資料量驗證或部署。Migration建議順序S1／1B／1C基線→2A→2B→3→4→5→6及各verify；正式操作另准。回復停新派送／補發入口與worker，保留事件、attempt及finding，不刪財務或通知歷史，不回復到會重複寄送的無防重版本。

上述決策已確認並開始本機實作；實際完成狀態以後續驗證文件為準，不跨到階段7。
