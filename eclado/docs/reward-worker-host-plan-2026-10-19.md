# 返饋通知／對帳 Worker：既有VPS準備方案

## 已確認與唯讀證據

2026-10-19使用者已選定沿用202.182.120.159，但worker使用獨立帳號／程序，不載入銀行解密金鑰，不改現行付款服務。指定管理員通知收件信箱已再次確認為 `ecladotaiwan@gmail.com`（初填的ecaldo拼字不採用）。此決策不授權發送測試或正式郵件。

唯讀主機盤點：Linux、Node20.20.2、根磁碟可用13GB，記憶體available約694MB；僅是當下容量，不是負載測試。已有未啟用的eclado-payment帳號，本次不挪用；未查到eclado-reward-worker帳號。systemd列出的20個timer及核對的/etc/systemd/system/*reward*、/etc/cron.d/*reward*無返饋排程；未檢查所有外部排程，不宣稱全系統沒有其他排程。沒有變更主機。

## 建議安裝內容（尚未執行／啟用）

- 帳號：獨立無sudo、無互動登入的eclado-reward-worker；不可沿用付款root程序或共用付款.env。
- 目錄：root持有唯讀runtime，worker只可讀自身設定與必要狀態目錄；原付款目錄、PM2及備份不改。
- 程式：以現有api/reward-notification-worker.js、_reward-notification-delivery.js、_email-template.js為來源，新增本機CLI／systemd適配器。沿用既有lease、防重key與通知分類，不複製改寫財務SQL。本機適配器scripts/reward-worker-host.cjs及ops/reward-worker的兩組service／timer、停用env範本已準備；未發布至主機。
- allowlist設定只包括SUPABASE_URL、service key、LINE_CHANNEL_ACCESS_TOKEN、RESEND_API_KEY、ORDER_EMAIL_FROM、REWARD_NOTIFICATION_ADMIN_EMAILS與worker本身控制值；缺正式provider／sender需保持不發送。
- 禁止載入REWARD_BANK_ENCRYPTION_KEYS、REWARD_BANK_ACTIVE_KEY_ID、永豐商店金鑰或付款.env；先檢查bank key缺席，再允許claim。OS帳號隔離及秘密檔案權限也須實際驗證，不以不同檔名當隔離證明。
- 目前SQL採service_role，該憑證本身仍有其他金融能力；此方案隔離銀行金鑰，不宣稱已達全DB最小權限。若另要求憑證完全無其他財務修改能力，需專用角色／gateway設計與授權。
- 建議通知每分鐘一次（每tick至多5件），對帳每日台北03:00；這是待確認排程，尚未啟用。服務與timer安裝時先disabled，不立即補寄累積通知。
- 先以假收件人／mock fetch驗證適配器及timer，不以正式service role或真收件人做本機測試。正式發信前另批准指定事件／收件人，禁止任意掃描既有佇列發送。
- 日誌僅安全執行結果、筆數與分類，不記recipient、bank資料、provider完整body或金鑰。須設定queue age／unknown／失敗run告警與日誌保存；目前未配置。

## 接續門檻

1. 本機CLI與systemd範本已準備、mock測試通過；排程仍屬建議，主機安裝與Linux systemd實際驗證尚待批准。
2. 明確批准主機建立帳號、runtime與受限secret設定；先disabled安裝，不修改付款服務。
3. 正式DB通知／對帳SQL與ACL驗證完成；只有核對通過才配置真資料庫憑證，不先對不存在的RPC重試。
4. 提供正式LINE／Email憑證來源與sender，不在聊天／Git揭露或複製全部付款.env。配置前只核對名稱與來源。
5. 另批准受控真投遞驗收及timer啟用。未知投遞依原防重鍵及人工查核規則恢復，不擅自清空Outbox。

正式銀行keyring仍屬Vercel Production銀行API的獨立前置；worker的上述選擇不代表金鑰已生成／保存／生效。main合併與正式SQL執行仍未放行。

## 本機啟動包驗證

`node --test tests/integration/reward-worker-host.test.cjs tests/integration/reward-notification-worker.test.cjs`：19/19、0跳過。新host適配器5項覆蓋預設disabled、check零網路、銀行key拒絕、專案／Email設定拒絕、既有派送核心每批最多5件、對帳台北同日防重鍵及跨日／指定舊key重試；既有通知14項一併通過。使用假憑證及mock fetch，沒有真投遞。

對帳同一專案同一台北日期使用穩定run key；逾時跨日需明確帶原key查核，不盲目另建事件。failed run不會因同key重送而變成功，依既有SQL保留失敗紀錄，調查後才以新UUID重跑。範本提出每服務192MB上限、CPU25%、oneshot最長110秒，尚未實際負載測試。systemd設定僅本機範本，不宣稱Linux安裝／timer／權限隔離已驗收。

用途：這是現有通知核心的執行／排程適配層，不新增金融計算，不處理匯款，也不持有銀行解密key。現有VPS可放獨立帳號／程序，無需另外購買VPS；如改採獨立雲端worker也可，但不是本次已選方案。

## 主機已安裝但停用（2026-10-19，台北19:07）

使用者要求按原worker規劃繼續後，已建立eclado-reward-worker系統帳號（無sudo／nologin），runtime位於/opt/eclado-reward-worker/runtime，設定/etc/eclado-reward-worker/worker.env為root持有、worker唯讀，REWARD_WORKER_ENABLED=false，沒有service key／LINE／Resend真憑證。兩組systemd service／timer已安裝並daemon-reload，timer皆disabled／inactive，未正式派送。

主機Linux Node20下19項mock測試全部通過；systemd-analyze verify成功，只有既有xfs系統單元CPUAccounting警告（非本次worker設定）。runuser實測runtime／env不可由worker寫入，付款.env與付款staging不可讀。付款server.js hash與PM2 PID1983124核對未變。主機安裝證據/opt/eclado-reward-worker/INSTALLED.json。

唯讀核對付款.env與專案.env，未找到LINE_CHANNEL_ACCESS_TOKEN、RESEND_API_KEY或ORDER_EMAIL_FROM；尚須使用者指定正式通知秘密來源及sender。不從付款.env整份複製，不把憑證貼聊天。不因timer已安裝便宣稱通知已上線。

已另外在實際systemd service中各執行一次disabled模式，兩個service皆Result=success／ExecMainStatus=0，之後回到inactive；timer仍disabled／inactive，任何RPC與provider前即退出，沒有開始派送。這驗證Linux單元的沙箱啟動可行，不是正式資料庫／provider連線驗收。安裝腳本保存ops/reward-worker/install-disabled.sh，遇既有帳號／安裝目錄會停止，不可當成任意更新或覆蓋工具。

## 最新狀態：憑證已設定，仍停用（2026-10-19）

使用者批准讀取既有憑證並安全設定獨立 worker。Resend 憑證取自 Vercel 既有 Production 設定；LINE 憑證依使用者指定取自 Git 忽略且未追蹤的 `.env.notification-test`，只複製 `LINE_CHANNEL_ACCESS_TOKEN`，未重新核發或輪替。Supabase URL／service role 只讀取主機既有設定中的指定欄位，未複製完整付款環境檔。

寄件者為 `ECLADO <service@ecladotaiwan.com>`，管理員收件者為 `ecladotaiwan@gmail.com`。秘密值不寫入文件、Git 或聊天；本機及主機的憑證傳輸暫存檔已移除。worker 設定為 root:eclado-reward-worker、0640，沒有銀行解密金鑰。

實際以 worker 帳號執行 `check`：`configuration_valid`、`networkRequests:0`。兩個 timer 仍 disabled／inactive，`REWARD_WORKER_ENABLED=false`。最後狀態查詢以 inactive 回傳非零碼屬 systemctl 正常語意，非設定失敗。尚未驗證 Token 有效性、官方帳號歸屬、Resend 寄件網域或真實投遞；沒有發送 LINE／Email，也未啟用排程。正式 11 份 SQL 已安裝並逐步驗證，詳見 migration 執行證據；網站尚未發布，學生價保持 OFF。

### 通知服務唯讀驗證通過（台北 2026-10-19 19:46）

使用者要求先驗證後，於 VPS 只執行 GET：LINE `/v2/bot/info` 回應 200，確認現有 Token 有效且對應 `ECLADO TAIWAN`／`@379sdyrk`；Resend `/domains` 回應 200，憑證接受且 `ecladotaiwan.com` 狀態為 `verified`。worker 仍停用，沒有通知發送請求。這是憑證及網域驗證，不等於真實送達／收件匣驗收；寄送權限、LINE 收件資格及實際送達仍須另做受控投遞。安全證據：`docs/evidence/reward-provider-readonly-verification-20261019.json`。

### 單次受控投遞（台北 2026-10-19 19:51）

使用者指定 Email 收件者並確認 `.env.notification-test` 內的測試 LINE ID 後，已由 VPS 向兩個指定管道各發送一則「通知連線測試」，明示無提領／匯款／帳務異動。LINE 與 Resend 均回應 HTTP 200、服務商接受。腳本保存私有執行紀錄及防重鍵，存在執行紀錄時拒絕重跑；未建立正式測試訂單或提領，未處理 Outbox、未啟用 worker／timer。收件人實際收到與否待使用者確認；本次不等於通知佇列、備援、重試及帳務全流程正式驗收。公開證據不保存收件 ID 或 Email：`docs/evidence/reward-controlled-notice-test-20261019.json`。

使用者後續回報 Email 已收到、LINE 未收到。對相同測試 LINE ID 執行一次 profile GET 回應 200，確認此 Token 可讀取該 ID 的 profile；未重送訊息，亦未保存 profile 個資。這不能證明該 ID 就是使用者目前查看的 LINE 帳號或訊息已送達。LINE 實際收件驗收尚未通過，原因待確認；不能僅憑 push/profile 200 宣告全管道通知驗收完成。

### 最終收件確認與後續測試來源（2026-10-19）

經使用者更正收件 ID 後，19:57 的 LINE 單次測試回應 200，使用者明確確認已收到；先前 Email 亦已確認收件。LINE／Email 兩管道的受控連線與實際收件驗證均通過。使用者自行更新 `.env.notification-test`，唯讀比對 `NOTIFY_TEST_LINE_USER_ID` 與本次成功 ID 一致，檔案仍 Git 忽略；後續通知測試使用此檔現值，不沿用過去測試腳本寫死的舊收件人。不在公開文件保存完整收件 ID 或憑證。

本確認僅適用後續已獲授權的通知測試，不代表自動發送授權、會員綁定異動、Outbox／備援全流程驗收或正式排程啟用。worker／timer 仍停用，學生價格 OFF，未發布網站。最新 LINE 收件證據：`docs/evidence/reward-line-confirmed-id-test-20261019.json`。
