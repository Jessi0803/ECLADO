# 師生綁定通知：本機實作與驗收

2026-11-02 本機實作與驗收紀錄；使用者驗收後已另行批准正式安裝與啟用，最新狀態見文末。

## 確認文案與收件人

- 建立綁定：學生、老師，共2封。
- 更換老師：學生、新老師、原老師，共3封。原老師的訊息與快照均不含新老師姓名。
- 解除綁定：學生、原老師，共2封。
- 首次綁定及更換後給新老師的內容一致：「學生『會員名稱』已綁定至您的名下。後續符合返饋條件的學生訂單，將依規則計算返饋金。」
- 其餘內容依本次對話確認版本；七種完整模板以 `api/_instructor-student-notice.js` 為準，LINE／Email 共用。
- 文案不承諾一定有學生價或返饋；既有訂單仍依原快照處理。

## 實作範圍

新增 `supabase-instructor-student-notifications.sql`：從既有不可修改的師生異動稽核事件 enqueue，同一交易失敗即整筆回滾。不修改原綁定 RPC、訂單、價格、返饋或提領表，不回補歷史異動。老師類型變更、會員刪除等事件不會額外寄信。

綁定通知使用獨立 outbox／attempt 表，RLS 開啟，不給一般會員或 service_role 直接讀寫表。只有受限 worker RPC 可以領取／完成；通知紀錄 RPC 沿用有效 admin／super_admin 的師生管理讀取權限。紀錄只回傳通道、遮蔽收件人、事件及狀態，不回傳聯絡資料或完整訊息內容。後台會員詳細的師生設定新增預設收起的通知紀錄，展開才查詢，每頁20筆。

沿用既有寄送 helper 與 VPS worker，預設 `INSTRUCTOR_STUDENT_NOTIFICATIONS_ENABLED=false`。開啟後每次 dispatch 總共最多5封，先分配最多3封提領通知，其餘名額給師生通知；無提領通知時師生通知最多5封。原先通知排程不變，不增加另一個常駐程序。

每個通知使用固定 LINE／Email 去重 key，領取時使用2分鐘租約及 fencing token。無 LINE 直接 Email；LINE 明確拒絕、無憑證、429、5xx 轉 Email，下一批寄送。逾時／網路中斷維持原通道與 key 重試，避免把不確定結果當作明確失敗。各通道最多6次與23小時重試窗，超限呈現失敗／待確認；無聯絡通道暫停，之後定期重查。使用者刪除時清除暫存聯絡資料並撤銷租約。此版未新增人工補發按鈕。

快照只存通知所需的會員名稱，不存銀行、手機、住址或原老師不應知道的新老師資訊；收件聯絡資料在領取時從會員資料取得，寄送成功後清除，逾期依既有通知政策清除。無法保證服務商接受就等於本人已讀。

## 本機預覽

執行時提供現有本機 PGlite 模組的絕對路徑：

```sh
PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/instructor-student-notifications-preview.mjs
```

預設 `http://127.0.0.1:5196/__binding-notices`。只監聽127.0.0.1，不讀 .env。使用假會員、記憶體 SQL 資料庫、真實綁定與佇列 RPC、真實 worker／模板；provider 回應全部模擬，不會對 LINE／Resend／正式 Supabase 發請求。七封樣本由 bind → rebind → unbind 真實 RPC 產生，可再自行操作並切換 LINE 模擬結果。關閉程序即丟棄示範資料。

## 驗證

- 23項 Node 測試通過：新增模板／worker整合／SQL情境，及原有提領寄送與主機 adapter 回歸。
- SQL 情境驗證：2／3／2收件人、失敗回滾綁定、過期寫入拒絕、原老師快照隱私、LINE→Email、租約回收及舊token拒絕、權限、會員刪除、重複安裝不回補。
- Playwright 桌面與手機各1項通過：實際操作建立／換綁／解除、通知數量、模擬備援、通知紀錄、頁面無水平溢出、無對外請求。
- `npm run build` 完成前端498模組編譯與SEO預產頁（62商品、8文章）。預產頁程序沿用既有的 dep-scan server-closed 訊息，但最終 exit code 0。
- 最初沙箱阻擋本機監聽／Chromium與預產頁網路，經允許後於沙箱外重跑通過；沒有把未執行的瀏覽器案例算成通過。

## 後續發布順序（尚未執行）

1. 審核本機文案與實作。
2. 依專案既有程序先隔離／test安裝增量與驗證，之後另取得正式安裝授權。
3. 更新 VPS 的 `_instructor-student-notice.js`、`_reward-notification-delivery.js`、`reward-notification-worker.js`、`reward-worker-host.cjs`；沿用原必要依賴，須重新核對實際部署檔案及備份。
4. SQL與worker版本均到位後，明確啟用 `INSTRUCTOR_STUDENT_NOTIFICATIONS_ENABLED=true`，驗證空tick與指定測試收件人；未授權前不發送真實通知。
5. 前端依既有 Git 自動部署流程發布。停用新通知可將新flag改false，原提領worker保持運作；排隊通知會保留，不可未審核直接刪除稽核。

此次工作區原有許多付款、促銷、購物車及文案修改；本次未提交或推送它們，亦未操作 `.claude/launch.json`。

## 正式安裝與啟用（2026-11-02，最新狀態）

使用者已確認 commit／push main，並另外明確確認正式 Supabase 增量與 VPS worker 啟用。本機 main 先快轉到遠端 `391a515`，原85個工作檔案均另存備份、暫存後完整還原並核對SHA256；本次提交僅包含師生通知功能與此驗收／發布紀錄，不包含其他文案或 `.claude/launch.json`。安全暫存保留作為可回復副本。

正式 `ilvdvlkdpntwmaijncaz` 已安裝通知增量，8項RLS／受限RPC／觸發器驗證全true。安裝前後有效綁定8筆、異動稽核15筆，新增通知0筆；綁定RPC與原提領通知claim／complete函式MD5完全一致，未回補舊事件，未建立假事件。增量與驗證來源都在專案內。

正式 worker 先核對既有檔案與無網路check，備份runtime及受限環境設定後，於主機以獨立worker帳號執行22項mock測試全部通過。更新四份程式、開啟 `INSTRUCTOR_STUDENT_NOTIFICATIONS_ENABLED=true`；空通知tick complete／checked0／accepted0，dispatch及reconcile timer均維持active，設定仍root:worker0640。付款API的server.js雜湊與PM2 PID未改變。本輪沒有真實訊息寄送，後續真實師生異動才會自動排隊通知。

有效備份：`/opt/eclado-reward-worker/backups/binding-20261102T025935Z`。第一次主機預檢因發布暫存父目錄權限不足停止在切換前，原服務未受影響；修正release目錄為root:worker0750後重跑上述測試與切換成功，備份目錄保持root0700。

乾淨發布版本（遠端main＋本次功能，排除其他工作區修改）再次建置通過498模組、62商品與8文章。程式透過main推送觸發既有Vercel正式部署，沒有手動重新部署、升級或改網域。正式主機與資料庫驗證見 `docs/evidence/instructor-student-notifications-production-20261102.json`。
