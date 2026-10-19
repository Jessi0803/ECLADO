# Payment API Git 發布流程

狀態：發布工具已準備，尚未在正式主機初始化／啟用。工作流程不在push時自動執行；只有手動指定完整commit SHA、經 `payment-production` 環境門檻後才可部署。

## 已核對的正式基準（2026-10-19）

Vultr主機Node20.20.2、npm10.8.2、PM2 7.0.1；現行程序為fork mode、watch=false、無額外node_args，cwd `/opt/eclado-payment-api`、script同目錄server.js。PM2環境未包含所核對的銀行／Supabase／通知金鑰，服務使用原目錄.env。PID1860848。檔案SHA256 `a62f4d183127f81ec1ec43153bfce25f888f63a0ffa856a832b9b545cea0de53`等於2026-10-19 origin/main；新模組尚未上線。

這些是初始化的前置假設，執行時必須重新核對；若主機或main改變，停止而非覆蓋。

## 首次初始化（需受控維護窗口，尚未執行）

1. 核對Git main的完整SHA及主機全部runtime檔案，保留原目錄、.env、node_modules與PM2復原設定。僅server hash相同不能證明所有檔案相同；baseline版本尚未核對完整前，不可寫READY。
2. 建立 `/opt/eclado-payment-releases/releases/<baseline-sha>`，保存已核對的runtime檔案及**現行依賴**。此舊版備援不重裝依賴。`shared/.env`用symlink指向原 `/opt/eclado-payment-api/.env`；不複製或輸出內容。
3. `current` symlink指向該baseline，根目錄放ecosystem.config.cjs（以下模板）。應用必須在重新啟動時解析實際release目錄，才能從/proc驗證cwd。所有release、設定及shared目錄僅授權部署／執行身分可讀寫，.env維持原有受限權限。

```js
const fs = require('node:fs');
const cwd = fs.realpathSync('/opt/eclado-payment-releases/current');
module.exports = { apps: [{
  name: 'eclado-payment-api', cwd, script: `${cwd}/server.js`,
  interpreter: '/usr/bin/node', exec_mode: 'fork', instances: 1,
  watch: false, autorestart: true,
}] };
```

4. 在原版本上切換PM2管理路徑，核對PID/cwd/health與公開health，再pm2 save；原目錄保留。**fork restart會有短暫中斷**，不能宣稱零停機，需安排低流量窗口及檢查銀行回呼重試。若切換失敗，回到原script/cwd啟動並確認health，不繼續部署候選。
5. 確認以上驗證完成才建立根目錄READY，並記錄baseline SHA。READY只是人員核對標記，不會自行提供完整性保證。

## GitHub平台設定（尚未配置）

GitHub workflow_dispatch要求workflow先存在預設分支；因此先以**只有發布工具／文件的獨立PR**併入main，不能為了安裝workflow提早合併整個師資功能。發布工具不會在merge時自行改動Vultr。

建立 `payment-production` Environment，設定必須由授權人審核、禁止自審，限制可發布分支。部署job不可在未受保護環境中啟用。

| 類型 | 名稱 | 內容 |
| --- | --- | --- |
| Secret | PAYMENT_DEPLOY_SSH_KEY | 專用部署SSH私鑰，不使用個人私鑰或銀行金鑰 |
| Secret | PAYMENT_DEPLOY_KNOWN_HOSTS | 由可信管道核對的主機公鑰記錄；不可在每次CI臨時ssh-keyscan後自動信任 |
| Variable | PAYMENT_DEPLOY_HOST | 202.182.120.159 |
| Variable | PAYMENT_DEPLOY_USER | 經批准、可管理該PM2應用及release目錄的身分 |

新增SSH身分會讓GitHub部署工作能以該身分執行主機命令，是新的主機存取權；建立前需明確確認授權範圍。現有PM2由root執行，不能假設新建普通使用者即可管理同一程序。應先決定受限部署方式或獨立應用使用者遷移，**不可直接新增無限制root部署金鑰作為默認處理**。目前workflow只是SSH管道骨架，該存取設計未完成前不可啟用。

## 每次發布

手動執行Payment API release，revision填完整40位候選SHA，expected_current填當下current release的SHA。候選必須含最新main。CI在Node20執行npm ci與全部付款測試，打包固定五個runtime檔案，再通過Environment審核才進部署。

主機全程加flock防併發，current不符合預期即拒絕；驗SHA256、嚴格archive檔案清單／型別，獨立release內npm ci --omit=dev --ignore-scripts、語法檢查；沿用shared/.env。確認原服務健康後才原子切換current、PM2重啟，核對health及實際程序cwd，再保存PM2狀態。發布包不包含.env或node_modules。

CI與主機自動檢查不呼叫銀行建單／query，也不寫正式資料庫。health只能證明程序可服務，不能取代真實DB契約、付款回呼、外部health及交易驗收；部署後需另外核對。

## 回復範圍

切換候選失敗時，自動切回本次切換前版本、重啟並檢查health。若回復也失敗，輸出CRITICAL，由操作人介入。舊release與原目錄不自動刪除；失敗版本不覆蓋或重用。

自動回復僅限**發布當下且尚未安裝新DB schema／產生新義務**的階段。本流程不能作為之後任意退回舊版的保證。返饋SQL上線後，舊main Payment API可能無法正確處理雙錢包／返饋證據；應保留相容API，以修復後新commit前進，或回到已驗證與當下DB相容的release。不要刪除Ledger、快照、提領保留或回退正式交易。

## 驗證範圍

新增部署測試使用真實暫存目錄、tar、SHA256及shell，模擬PM2、npm安裝與HTTP：未初始化／版本不符拒絕、完整發布、候選健康失敗自動回復。Linux CI會使用真flock及mv -T；macOS本機只模擬這兩項Linux工具。尚未完成真Linux主機初始化、真PM2切換與GitHub Secret連線演練，不可宣稱正式發布已驗收。
