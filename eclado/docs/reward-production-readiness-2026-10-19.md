# 師資返饋金正式發布前核對（2026-10-19）

結論：第三步唯讀盤點完成，尚未具備直接合併main上線的條件。未執行正式migration、修改環境變數、重啟服務、建立正式訂單或發送通知。

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
