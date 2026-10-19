# 師資返饋金正式發布前核對（2026-10-19）

最新結論（2026-10-19）：正式11檔增量已依批准安裝／驗證，付款API主機更新完成、Production銀行keyring已儲存但未部署載入、獨立worker已配置且停用，指定LINE／Email測試已確認收件。尚未合併main／發布網站／啟用學生價或排程。完整最新檢查與門檻見 `reward-release-checklist-2026-10-19.md`；下列早期盤點保留為歷史，不代表目前仍未安裝。

## 當下證據

- Git fetch origin main：main為 `b267571`，main-only 0／本分支-only 26；最新main已包含於候選分支。這是Git基準，不能單獨證明Vercel正式執行版本。
- 正式Supabase `ilvdvlkdpntwmaijncaz` 的Scheduled backups頁有10/12至10/18每日實體備份；最新顯示2026-10-18 07:04:28 UTC，即台北15:04:28。未按Restore。尚無本次發布前即時備份與完整復原演練證據；頁面明示不含Storage檔案內容。
- 正式SQL以 `BEGIN TRANSACTION READ ONLY`、timeout、SELECT、ROLLBACK執行；回傳read_only=on，public實體表53，返饋表／student_reward_snapshots皆不存在，orders.reward_credit_amount不存在。creator函式MD5 `5bbdc6f76fed6523d71398712a7942f1`。這是針對前置條件的檢查，非完整schema無差異證明，正式安裝前仍須完整catalog與migration guard核對。
- 另以唯讀交易核對 `student_pricing_feature_settings`：enabled=false、version=0。學生價OFF不能當成提領／wallet的完整停用開關。
- Vercel eclado專案Environment Variables頁，All Environments及REWARD搜尋結果只有 `REWARD_BANK_ENCRYPTION_KEYS`、`REWARD_BANK_ACTIVE_KEY_ID`，兩者皆僅Preview；未顯示Production設定，沒有揭露或複製金鑰值。正式銀行金鑰與安全備份流程待建立，不能拿測試金鑰直接沿用。
- 唯讀SSH正式 `/opt/eclado-payment-api/server.js` SHA256 `a62f4d183127f81ec1ec43153bfce25f888f63a0ffa856a832b9b545cea0de53`，等於目前origin/main檔案。候選檔為 `58bb04270757e1b4e95c61174e18df50bfc1c3d8126ca4850d26400013fbb22a`；正式缺少 `reward-payment-evidence.cjs`。PM2 PID為1860848；PID存在不證明程序載入檔案版本。部署目錄的git rev-parse未成功回傳，未證實Git自動發布管道。
- repo無.github workflow，vercel.json只有cancel-expired-orders與professional-quarterly-notices兩個既有cron。未找到已配置reward排程的repo證據，外部排程狀態仍未驗證。

## 接續必要工作與順序

1. 準備相容新舊DB的Payment API之Git發布／回復管道，先在隔離環境驗證，再發布正式；保持既有收款回呼不中斷。不可直接merge main假設Vultr會自動更新。
2. 建立正式銀行專用keyring與受控備份，透過平台秘密設定；不將明文放入Git、文件、日誌或聊天。Production與Preview分離。
3. 配置獨立通知／對帳worker部署與排程，其環境不得有銀行解密金鑰。現有worker要求POST且明確拒絕帶銀行金鑰環境，因此不能把同專案原路徑直接加入Vercel GET Cron。管理員收件名單、寄件者、錯誤追蹤及unknown恢復需一併驗收。
4. 在正式SQL安裝窗口前補齊可復原備份、最新catalog、未結付款義務盤點與新入口受控停用方案。全庫還原會回退備份後的新交易，不能把它當日常功能回滾；應保留ledger／快照／歷史並使用相容程式回復。
5. 依相依順序安裝正式增量SQL及verify，最後才合併main觸發前端／serverless部署並驗證／啟用。test重建與假資料SQL不可用於正式。

年度銀行日曆已依10/14決策移除，不再是上線依賴；固定名目10日，假日人工順延。舊stage7a/06文件的日曆要求已過時，以stage7a/13及現行migration為準。

目前阻擋點為正式金鑰、API發布管道、隔離worker及備份復原證據；不是本次部分提領UI驗收失敗。下一階段應先補部署基礎，而非直接套正式SQL。

## Payment API發布工具進度

師資分支 `51a805f` 已提交推送：新增GitHub Actions（push／PR只測試，手動workflow_dispatch才有部署job）、完整五檔runtime發布包、主機指紋驗證、預期版本檢查、flock鎖、獨立版本目錄、健康／程序cwd核對及本次啟用失敗回復。詳細限制見payment-api/DEPLOYMENT.md。已在本機通過61項付款測試（含新增3項部署／回復案例），shell語法與workflow YAML解析通過；macOS測試模擬Linux flock／mv，真Linux CI及真PM2切換仍待核對。

另建從origin/main切出的 `codex/payment-api-release-pipeline`（96eea55），只含上述五個發布工具／文件檔案，供先行獨立審查，避免為安裝workflow提早發布師資功能。

補充唯讀PM2中繼資料：現行root程序為fork，cwd與script在原目錄，無額外node_args、watch=false、PM2未設定PORT／env_file，所核對的三個付款金鑰名稱在PM2環境中皆不存在（未輸出任何值）。新增主機SSH部署權限前，需決定受限存取或專用應用使用者方案，不能直接默認新增root金鑰。此步尚未建立主機使用者／SSH權限、GitHub Secrets／Environment，也未重啟或更新正式服務。

Linux CI補證：GitHub compare頁及Actions job顯示96eea55的 `Payment API release / verify (push)` Successful in12s；`deploy (push)` Skipped；Vercel與Preview comments亦成功。Run https://github.com/Jessi0803/ECLADO/actions/runs/39188863082 ，verify job https://github.com/Jessi0803/ECLADO/actions/runs/39188863082/job/117857008311 。這已驗證Linux測試job執行成功，未登入狀態無法展開完整logs，未宣稱真PM2或正式啟用已驗收。

GitHub connector建立草稿PR被403 Resource not accessible by integration拒絕；Chrome GitHub顯示Sign in，因此尚未建立PR。獨立分支比較頁已確認1 commit／5 files changed／Able to merge：https://github.com/Jessi0803/ECLADO/compare/main...codex/payment-api-release-pipeline?expand=1 。需使用者登入後再建立草稿；main沒有變動。

使用者登入GitHub後，已透過瀏覽器成功建立 Draft PR #1：https://github.com/Jessi0803/ECLADO/pull/1 ，base main、head codex/payment-api-release-pipeline，1 commit／5 files changed，頁面確認Draft、無衝突且Merge按鈕停用。PR已附加至本次任務；未請求reviewer、未標示Ready、未合併或觸發正式部署。建立當下pull_request測試排隊中，push的Linux verify已成功。

## 使用者更新：付款API沿用主機管理

使用者明確指定「付款API不用走github管理的方式」，停止將GitHub Environment／Secrets／部署workflow視為此次付款API上線前置條件；不繼續要求GitHub管理員登入。既有Draft PR不代表已採用或批准正式啟用。

2026-10-19唯讀核對 `/opt/eclado-payment-api`（排除node_modules與.env內容）找到26份server備份／歷史副本，沒有任一份與當下server.js的SHA256相同。最新為 `backups/server-before-dcc6bcf-20261013.js`，65348bytes，SHA256 `140d5f368a16ecfe431c2dc080a94bf7babf5985fc2948bd6a184af7a5478868`；當下server.js為66120bytes、`a62f4d183127f81ec1ec43153bfce25f888f63a0ffa856a832b9b545cea0de53`。因此既有備份確實存在，但最新一份是10/13更新前版本，不能當作目前版本的完整備份。

另有 `backups/assisted-20261009-0155`、`backups/benefits-20261011-e7624a3`，後者incoming/assisted-orders.js與現行模組雜湊一致。所查backups目錄沒有package.json／package-lock.json／node_modules完整備份。root的PM2 dump與bak皆指向 `/opt/eclado-payment-api/server.js`、fork mode，可辨認原啟動路徑；未重載dump或驗證完整復原。最新server備份及incoming代客模組均通過node --check。

正式API仍PID1860848，loopback health回傳ok=true。此次只讀／語法檢查，未重啟、更新或恢復服務，未動正式DB。後續只需在實際發布前補一份現行程式、完整依賴與啟動設定的受限備份，再沿用主機更新／回復方式；不因此重建GitHub部署工程。

## 現行付款API完整備份已完成

使用者明確批准「OK備份」後，於台北時間2026-10-19 15:05建立主機本機備份：`/opt/eclado-payment-api/backups/current-20261019-070550Z`。目錄root／0700，全部備份檔0600，未下載環境設定至本機或上傳GitHub。

- runtime.tar.gz包含當下server.js、assisted-orders.js、package.json、package-lock.json、.env與完整node_modules，共619個一般檔案，壓縮檔751769bytes。當下沒有reward-payment-evidence.cjs，沒有以候選模組混入舊版備份。
- 另保存當下單一付款應用的PM2 live狀態、舊dump中該應用設定、可供審查的ecosystem.restore.cjs、Node/npm/PM2版本、pm2-root.service內容及RESTORE.txt。沒有重載PM2 dump或其他服務。
- runtime-manifest逐檔記錄SHA256／權限／擁有者；完整讀取壓縮檔核對每一檔內容及metadata，與備份前及備份後原始runtime皆相同。backup-checksums再次核對所有備份組件，完成後寫入COMPLETE.json。
- runtime.tar.gz SHA256：`1df08714c33e0d9657aaf6f27444744d1a8e5612fa4a31763e57d1c593d464e3`。對壓縮檔內的程式副本與restore設定完成node --check，通過。
- 原付款PID1860848、PM2啟動時間及重啟計數未變，health ok=true。未更新／重啟／恢復API，未動正式資料庫。這是現行runtime完整性校驗，沒有實際執行服務還原，也不是異地主機或整台VPS災難復原備份。

下一步才是依主機管理方式更新配套付款API；本次備份授權未直接延伸為更新或重啟授權。仍需先確認與當下正式DB相容，返饋SQL上線後不得直接使用舊API備份回復而忽略新金融義務。

## 配套付款API已在主機更新

使用者其後授權「繼續下一步」。發布前發現原候選直接SELECT尚未存在的reward_credit_amount，已補精確缺欄錯誤才降回舊投影的相容處理；本機及主機隔離假設定、現有依賴環境均65項通過。依使用者要求以主機管理方式，只更新server.js及返饋付款模組、重啟原root PM2應用，PID1860848→1983124；原依賴與.env核對不變。內外health及新版程式對正式舊DB的唯讀相容探測通過，非GET請求0；未執行正式SQL或銀行測試交易。詳見payment-api/HOST-DEPLOYMENT.md。下一步為正式資料庫備份與SQL安裝前條件核對，並非此刻已完成整套師資功能上線。

## 正式SQL離線重演完成（接續主機更新後）

2026-10-19以當日已保存正式catalog於隔離PostgreSQL17.6重建並成功執行「優惠券＋10份返饋增量」共11檔，10次verify通過。原208函式owner／ACL不變；只6個預期wrapper定義改動，活動身份／儲存及定價核心保持一致，四種活動／五角色／訪客／代客真SQL測試及一般／代客快照、入帳、錢包付款退款回滾smoke通過。最新扣款／自選提領2個隔離併發整合測試通過，deadlocks=0，test Build通過。

先前「target_order.payment_amount只能出現一次」是自製檢查誤判；Migration實際只要求存在，當日來源2次，實際執行與付款契約驗證通過。安裝清單不含舊年曆清理補丁，partial放最後；完整hash、verify及限制見 `reward-production-migration-plan-2026-10-19.md` 與 `docs/evidence/reward-production-preflight-20261019.json`。

本次只本機工具／假資料重演及文件，正式DB、金鑰／worker設定、網站皆未變更；未commit／push／merge。尚缺正式金鑰及安全備份、隔離worker與指定通知名單、維護窗口／未結付款盤點／受控入口及正式安裝批准，整體發布仍No-Go。Private catalog不提交。

## Worker環境與通知名單已確認

使用者已選定既有VPS上的獨立worker，並再次確認管理員通知Email為ecladotaiwan@gmail.com。唯讀主機盤點完成，未建立帳號、修改secret或啟動timer／寄信。安裝方式及剩餘門檻見 `reward-worker-host-plan-2026-10-19.md`；排程頻率／sender／憑證來源／主機CLI安裝及正式啟用仍待處理，不把環境選擇當作已安裝。

本機worker啟動適配器、停用環境範本及systemd範本已備妥，與既有通知mock測試合計19/19通過；並未上傳／安裝主機或配置正式憑證。排程頻率仍待確認，Linux單元檔／權限／真投遞未驗收。

## 正式金鑰已設定／worker停用安裝完成

使用者批准Production專用金鑰及私有備份後，已產生獨立32-byte key，新增Vercel eclado專案Production範圍的REWARD_BANK_ENCRYPTION_KEYS及REWARD_BANK_ACTIVE_KEY_ID；既有Preview兩筆未改。UI回覆儲存成功、需新deployment才生效；未按Redeploy或部署。私有JSON備份mode0600且Git忽略，已用假銀行資料驗證加密／還原與錯誤owner拒絕，未儲存假銀行cipher或使用正式會員資料。尚未在正式已部署API上驗證key可用，也尚無異地秘密備份還原演練。證據docs/evidence/reward-production-bank-key-scopes-20261019.jpg，不含key值。

VPS worker已以無sudo獨立帳號安裝，worker flag=false、timer disabled／inactive、沒有正式provider或DB憑證，Linux mock19/19與systemd verify通過，付款程序與hash未變；細節見worker主機文件。

正式SQL執行前另外完成READ ONLY＋ROLLBACK核對：台北19:12時208原函式定義相同，owner／ACL另查亦0差異，返饋表／欄位皆尚不存在，學生價OFF/version0；未付款狀態(unpaid／awaiting_confirm)聚合1筆，未讀會員／訂單明細或金額。此計數不是所有銀行義務完整稽核。唯讀證據docs/evidence/reward-production-install-readonly-20261019.json與reward-production-acl-readonly-20261019.json。正式11檔Migration仍尚未執行，已向使用者提出具體清單、鎖等待／備份限制及執行前確認；未把按規劃繼續當作瀏覽器正式權限寫入的逐項確認。

## 最新正式安裝及發布前整理

使用者明確批准11檔清單後已逐步安裝與驗證；執行hash／時間／verify見 `docs/evidence/reward-production-migration-execution-20261019.json`，最終15張返饋表受RLS保護、208個原函式owner／ACL無差異、活動定價核心不變。安裝後學生價OFF/version0、原待付款聚合1筆、舊訂單reward折抵0、銀行／新財務資料／通知佇列皆空。付款API對新欄位只做GET相容探測通過，未建銀行交易。此段取代上段「尚未執行」狀態；原證據保留，不重跑Migration。

worker已安全配置正式Supabase、LINE及Email憑證，不持有銀行key。兩timer disabled／inactive、flag=false。本次指定收件人連線測試經使用者確認LINE與Email皆收到；沒有正式假提領／假訂單，也沒有自動派送。銀行Production key設定仍須新Git部署才載入。完整範圍與未覆蓋情境見 `reward-worker-host-plan-2026-10-19.md`。

發布前重新fetch main，`b267571`已是目前HEAD祖先，main-only0／分支-only33。學生價OFF不阻止老師看返饋／銀行／提領入口，亦不阻止合法錢包操作；發布時公開入口或另做受控停用方案需使用者確認。實際收件不等於Outbox／備援／重試／對帳正式全流程通過。回復演練與告警亦有缺口，因此仍不直接放行main／學生價／worker。最新順序、程式位置與回復界線見 `reward-release-checklist-2026-10-19.md`。本輪只文件與本機／唯讀核對，沒有commit／push／merge／部署或啟用。
