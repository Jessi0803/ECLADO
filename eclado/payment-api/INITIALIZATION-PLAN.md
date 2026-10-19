# 正式 Payment API 首次接入發布流程

2026-10-19：僅為執行前計畫，以下主機／GitHub變更尚未執行。工具Draft PR： https://github.com/Jessi0803/ECLADO/pull/1 。PR的push及pull_request檢查已全部通過，deploy跳過；尚未合併。

## 唯讀核對結果

現行服務由root的PM2執行，pm2-root.service已啟用。`eclado-payment`帳號不存在；.env為root:root／0600，程式目錄0755。主機有useradd／runuser／flock，未找到setfacl；/opt所在磁碟約12.5GiB可用。

| runtime檔案 | 正式主機SHA256 | 與origin/main相符 |
| --- | --- | --- |
| server.js | a62f4d183127f81ec1ec43153bfce25f888f63a0ffa856a832b9b545cea0de53 | 是 |
| assisted-orders.js | efac286574fc00d7ca13ed272049cbcb511388309596ed38104de2899f2f198b | 是 |
| package.json | 2b2e00af9813b8a388ac33e74a46b08b698080d96c4ebc136f01cf2a22f49dd9 | 否 |
| package-lock.json | 860ecf34000d4ba5478fac952069d4396240e4ea2c2ecd1d74fd931bf156844a | 否 |

正式package.json仍為初始化產物，main=index.js，test指令為未設定；四項直接依賴宣告與repo相同。實際安裝express5.2.1、cors2.8.6、dotenv17.4.2、helmet8.1.0；repo鎖定的前三項相同，helmet為8.2.0。不能宣稱完整正式runtime等於某個Git commit。

初始化備援須保存**當下主機原有四檔及完整node_modules**，不以repo的npm ci重新生成舊版依賴。建立主機snapshot manifest，分別記錄程式對應Git SHA與主機依賴指紋；即使目錄以baseline Git SHA命名，也不得省略這個差異說明。新版本仍使用經測試的repo lockfile，會包含helmet8.2.0；此依賴差異須納入隔離驗收。

## 待批准的主機與權限變更

1. 建立專用系統帳號 `eclado-payment`，home `/var/lib/eclado-payment`、禁止密碼登入、無sudo／root權限。此帳號管理單一付款應用的release目錄與自己的PM2，不能操作root PM2的其他服務。
2. 建立 `/opt/eclado-payment-releases`，保存原runtime備援與manifest；原 `/opt/eclado-payment-api` 全部保留。先完成備援核對，再建立baseline release。新帳號接手應用後，使用獨立PM2_HOME及開機服務。
3. root以受限權限將既有付款.env安裝到新帳號的 `shared/.env`（0600）；原root檔不動、不輸出內容、不放入GitHub或發布包。這是從root遷移至專用帳號所需的一次受控複本；取代DEPLOYMENT.md通用方案中沿用root .env symlink的做法，避免放寬原root檔權限。
4. 為GitHub Actions建立專用SSH部署金鑰，只加入新帳號的authorized_keys；使用restrict禁止PTY、agent／port forwarding等。**restrict不會禁止任意shell命令**，這把金鑰仍可在專用應用帳號下執行程式、更新付款API及讀取該帳號可讀的付款設定。不得加入root authorized_keys或複用個人金鑰。私鑰只放本機受限暫存及GitHub payment-production Secret，不輸出到聊天或日誌。
5. GitHub payment-production配置可信主機指紋、指定host/user、專用SSH Secret及必要審核／分支限制。設定前核對目前操作者的repo管理權；若無權限，交由repo管理員設定，不擴權繞過。公開repo的Actions workflow及部署Secrets均須保持受保護。

新增帳號及SSH授權是新的存取權，須先取得明確確認；取得確認後也不以此授權任意修改其他主機服務。GitHub權限只授予付款部署用途。秘密輸入若由瀏覽器進行，交由使用者完成，不顯示／回傳私鑰。

## 首次切換與回復

先在隔離PM2_HOME、不同loopback port、假金鑰／假外部服務下演練啟動與回復；不能把mock單元測試當作真PM2路徑已驗證。發布工具須先獨立併入main；師資功能尚不合併。

維護窗口重新核對現行PID、runtime指紋及既有health。在備援完成、舊root恢復命令就緒後，只停止root PM2中的eclado-payment-api，立即以專用帳號啟動同一份舊runtime。核對loopback／公開health、port3000只由正確PID綁定、cwd與啟動身分；成功後才更新雙方PM2開機狀態，避免主機重啟時新舊程序搶port。其他root PM2應用不動。

若任一步失敗，先停止新帳號的該應用，再以原root、原cwd、原server.js恢復，核對health並恢復原開機狀態。不要把新舊兩個程序同時放到3000，也不要刪除舊runtime／原.env／備份。

PM2 fork切換會短暫中斷付款API，不能承諾零停機。操作前須確認可接受窗口及銀行回呼重試策略；初始化成功後才寫READY。之後候選版由受保護Git workflow發布，仍維持正式學生價OFF，且先不要套返饋SQL。

## 授權邊界

這次確認可分為「允許準備帳號／SSH部署權限」與「允許在指定窗口切換服務」。若只允許前者，禁止停止／重啟現有付款API、禁止改開機配置，READY不建立。無論哪一項，都不包含正式DB migration、新增正式交易、銀行付款或發送外部通知。
