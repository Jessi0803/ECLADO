# 返饋金購物折抵 CSV（本機驗收）

## 業務與實作範圍

使用者批准一張訂單一列，放後台「師資返饋管理 → 返饋帳務」，先本機實作。不是師資收入明細或提領銀行檔，不改訂單、付款、兩種錢包與既有提領匯出。

日期以訂單建立時間的 Asia/Taipei 日期篩選（迄日包含全天）；可另依師資目前會員名稱／訂單編號文字及折抵狀態篩選。只納入 reward_credit_amount>0 的訂單，包含已取消與退貨；不受帳戶列表20筆分頁影響。

每列白名單包含訂單編號、建立時間、師資名稱、訂單總額、購物金支付、原返饋金折抵、銀行應付、訂單狀態、當前返饋保留狀態、Ledger實際扣用與返還金額／時間、最近釋放時間及是否有付款帳務異常。以orders為主體、單筆reservation及Ledger聚合，重試多輪也不增加訂單列數。沒有保留紀錄者標需查核，不靜默當成扣用成功。師資名稱為匯出當下profiles名稱，不宣稱建單時名稱快照。

CSV使用UTF-8 BOM、CRLF、所有欄位加引號、雙引號逸出與公式起始字元中和，狀態以中文顯示。不輸出銀行、聯絡、學生身分、provider識別碼或師資比較價格。新匯出不依賴銀行解密金鑰或service key。

## Schema與權限

新SQL：`supabase-instructor-reward-redemption-export.sql`，依賴既有2B Ledger／不可變歷史trigger、階段3管理員查詢權限helper、階段4折抵欄位與保留表。

- `instructor_reward_redemption_exports`：actor UUID、時間、篩選、筆數的匯出稽核；RLS開啟、所有client及service_role直接表權限撤除，UPDATE／DELETE拒絕。不保存完整CSV。
- `export_admin_reward_redemptions(date,date,text,text)`：SECURITY DEFINER、空search_path，身分只來自auth.uid；沿用有效admin／super_admin且orders.read＋members.read。僅authenticated有EXECUTE，內部再次驗證資格，anon／service_role無EXECUTE。不接受前端操作者ID或師資ID以繞過權限。
- 單次最多10,000筆，超過則要求縮小範圍，不靜默截斷；後端單一查詢取得一致的資料內容，再記錄同一批筆數。沒有業務帳務異動，只有匯出稽核寫入。未做10,001筆上限壓力實測。
- 舊DB尚無新RPC時，畫面顯示尚未安裝，不偽裝成功或讀取不受限表。

## 修改檔案

- `src/admin/components/RewardRedemptionExport.jsx`：篩選及下載區塊、日期驗證、防連點及錯誤訊息。
- `src/admin/pages/InstructorRewardsPage.jsx`：既有返饋帳務頁嵌入匯出區塊。
- `src/services/instructorRewards.js`：authenticated RPC呼叫。
- `src/domain/rewardRedemptionCsv.js`：白名單欄位與CSV轉換。
- `src/components/account/InstructorRewards.css`：既有欄位／按鈕風格，手機單欄。
- 上述SQL、`tests/reward-redemption-export.spec.ts`、`tests/integration/reward-redemption-export-db.test.cjs`。
- `scripts/reward-acceptance-local.mjs`：僅隔離啟動時安裝新SQL及加入受限RPC白名單。
- 本文件、`docs/evidence/reward-redemption-export-local-20261020.csv`／`.png`（全為假帳號與隔離資料）。

## 測試與證據

1. PostgreSQL17.6真實隔離：`EMBEDDED_POSTGRES_MODULE=/private/tmp/eclado-commit-verify-tools/node_modules/embedded-postgres/dist/index.js node --test tests/integration/reward-redemption-export-db.test.cjs`，1/1 scenario通過、0skip。載入既有真實定價、Ledger及付款mock證據流程；涵蓋一單一列、保留／扣用／釋放／返還金額與Ledger核對、銀行公式、台北日期跨日、文字搜尋%、非法條件、稽核不可修改、老師／學生／匿名／停用管理員／缺members.read拒絕、表直接讀取拒絕、EXECUTE ACL及原帳務一致性。既有多連線回歸deadlocks=0。
2. 第一輪被sandbox localhost EPERM阻止，獲准後執行；測試fixture曾因基線餘額耗盡、實際管理員權限缺orders.write、補收入使用的商品倍率導致新師資單不足5000失敗，已只修正fixture：以合法隔離學生訂單入帳、明確補測試權限、恢復師資商品倍率。不修改生產規則或直接改餘額。
3. Playwright假API：`npx playwright test --config .playwright/redemption-regression.config.ts`，桌面／手機22/22通過（其中新增匯出6項），0skip。涵蓋25筆跨分頁下載、BOM／中文狀態／台北時間／引號及公式中和、RPC參數、缺Migration與權限錯誤、日期拒絕、原帳戶抽屜／歷史／權限回歸。
4. 本機網站＋真隔離PostgreSQL實際下載：5193管理員入口成功匯出14筆，CSV有BOM及已釋放／已返還狀態，無銀行帳號欄。證據為同前綴CSV／畫面；非真Auth／銀行交易驗收。
5. Vite Build 474 modules通過、既有chunk警告；`git diff --check`、本機腳本語法檢查通過。未執行會抓遠端商品的SEO預渲染，專案無lint指令，不宣稱完整npm build通過。

## 發布與回復

尚未commit/push、不操作test或正式Supabase、不部署、不改開關或worker。正式使用前需另行批准在已具階段4的DB套用新SQL並核對RLS／ACL，再由Git發布前端。回復可先撤除新RPC的authenticated EXECUTE或回復前端；應保留匯出稽核表及歷史，不刪帳務資料。此新功能不會在開頁時發新查詢，只有按匯出才RPC。

原有`CheckoutPage.jsx`及銀行／worker未提交變更保留，未混入本次功能。預估單次10,000筆的實際檔案大小、效能／API回應上限尚未壓測；大量資料先縮小日期範圍。既有訂單若錯誤缺reservation，匯出只標示需查核，不自動修帳。
