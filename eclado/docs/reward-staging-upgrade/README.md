# test Supabase｜Schema 對齊及返饋功能安裝

安裝2026-10-13、完成驗證2026-10-14；分支 codex/instructor-student-rewards。

## 已確認範圍

使用者選擇正式 Schema＋必要設定＋假資料，另明確確認只對 test 執行八步 SQL（含 RLS／RPC EXECUTE），不部署或改正式 DB。

- test：`qqlgqasbmbicnmvnlqbr`，東京；正式 `ilvdvlkdpntwmaijncaz` 只讀。
- 舊 test：5 表、5 函式；0 Auth／profiles／orders／申請／promotions／Storage，只有一筆 Playwright staging 商品。
- 不複製正式會員、訂單、金融帳務、銀行資料、Auth、Storage 物件、vault 秘密、發送設定或金鑰。
- 保留舊商品所有原欄位；新 slug 使用正式 make_product_slug，publication_status 對齊既有 active。
- 更換舊政策／Trigger、三個過時約束；保留未再使用的舊函式但撤客戶與 service EXECUTE。不 DROP 表或清除資料。
- 205 個正式函式原文以編碼分批匯出，全部 md5 與當下正式 Metadata 相同。
- 平台 Auth／Storage／vault Schema 及認證設定不搬；此為 public 業務 Schema 對齊，不能稱整個 Supabase 專案完整複製。

## 安裝順序

`01-production-schema-baseline.sql` → `supabase-student-reward-snapshots.sql` → `supabase-instructor-reward-ledger.sql` → `supabase-instructor-reward-queries.sql` → `supabase-instructor-reward-checkout.sql` → `supabase-instructor-reward-withdrawals.sql` → `supabase-instructor-reward-notifications.sql` → `supabase-instructor-reward-reconciliation.sql`。

清單／sha256 見 manifest.json。基線只容許已盤點的五表、無 Auth／會員／訂單資料的舊 test 狀態，會拒絕正式基線；仍必須以瀏覽器 URL 確認 target，不能只依 SQL guard 判斷環境。

每檔 transaction，逐步確認成功才繼續。已提交步驟失敗不能拿舊定義覆寫新資料；從當下 Metadata 判斷，禁止盲目重跑整包。學生價格初始保持 OFF；安裝不連銀行／LINE／Email，不啟動 worker。

## 本機實際驗證

`node scripts/check-reward-staging-upgrade.cjs`：一次性 PostgreSQL17.6，重建真實舊五表／政策／函式／唯一商品，再匯入完整基線及七檔 SQL。

- 68 表、9 份 verify SQL 完成；1B／S1 回傳的39個boolean全 true，其餘verify是DO內斷言，不虛報為0項測試。
- 原商品所有原欄位不變；authenticated 實際 SET ROLE 直接讀金融 Ledger 42501拒絕。
- 假會員綁定、OFF小計10000／ON小計9000、訂單快照2000、明確人工收款＋delivered入帳2000通過；測試結束恢復 OFF。
- 本機 Auth 使用 SQL uid／role 替身；不當成真 Supabase Auth／PostgREST、真銀行或通知驗收。
- 前期本機重演發現/修正：舊fixture外鍵排序、Constraint Trigger匯入方式、舊政策fixture缺漏、slug回填、預設採購單號函式順序；測試caller修正version、bind動作及假商品上架狀態。未修改產品核心或七份既有Migration。
- Build466模組＋1假商品／8文章通過，保留chunk warning；語法與git diff --check通過。package無Lint script。

## 剩餘限制

正式指定會員優惠券quote/create差異會原樣帶入test，用於重現，尚未獲獨立修補批准。

Preview／本機產品程式仍硬編正式Supabase／付款URL；安裝test DB不會自動把網站切過來。需另行最小參數化與隔離 API／Auth／付款／通知設計；不部署／push。真登入帳號、銀行金鑰、完整銀行休假表、worker／sender與管理員收件名單另行設定，不能複製正式通知設定避免誤寄。

本次的正式7B／7C仍未開始。實際雲端步驟及最終驗證結果另存 evidence/reward-staging-upgrade，不將本機通過當作雲端安裝完成。


## 雲端完成狀態（2026-10-14）

使用者批准八步後已逐檔成功安裝；暫停期間未續作，10/14依「繼續」接續驗證，沒有重放基線。test實際68表／257函式，15張返饋表RLS=true且anon／authenticated無直接SELECT/INSERT/UPDATE/DELETE；1B33項及S1六項全部true，九份verify SQL執行完成，DO內斷言未報錯。

雲端回滾smoke使用管理員／老師／學生假Auth資料與SQL JWT claims，未設定密碼、不寄驗證信、不呼叫銀行：一般學生快照2000→明確收款＋delivered入帳2000；代客AUTO故意傳999999但後端以學生價計算，快照2000；MANUAL指定600，快照5000；老師折抵500，收款證據模擬→paid扣用→returned返還，reservation為refunded、餘額回到2000。讀取實際資料作為結果，金額斷言拒絕NULL。全交易ROLLBACK。

最終重新讀取：0 Auth會員／profiles／orders／snapshots／返饋accounts／Ledger／withdrawals／Outbox／Storage物件；唯一原商品保留且所有原欄位逐一相同。開關OFF/version0。Sequence可能因回滾測試產生正常缺號，不視為留下財務交易，也未重設流水號。

本次只讓test DB具備後續驗收基礎，不代表前端可立即登入驗收：尚無可登入帳號，Preview與本機產品程式尚未切連test，金鑰／真Auth/PostgREST／銀行休假表／獨立模擬付款及通知環境另行處理。沒有在本次改URL、Vercel、付款伺服器、commit/push或正式DB。正式基線來源為10/13擷取；使用者暫停期間在正式DB所做的其他修改未自動再同步，避免覆蓋test新增函式。

實際證據：../evidence/reward-staging-upgrade/cloud-steps.json、cloud-final-inventory.json、cloud-foundation-verify.json、cloud-nine-verify-result.txt、cloud-rollback-smoke-result.json與summary.json。

## 登入、環境隔離與持久化驗收資料（2026-10-14）

使用者在 test Auth 建立 `admin.stage@eclado.test`、`instructor.stage@eclado.test`、`student.stage@eclado.test`。`03-test-login-fixtures.sql` 建立 test 專用角色、有效師生綁定及 student_1；`04-test-catalog-fixtures.sql` 建立兩個規格的 test 商品。未記錄或複製任何密碼、正式會員或正式交易資料。

本機 `vite --mode test` 已連至 test Supabase，畫面固定顯示 TEST 環境及銀行付款停用。學生價 OFF 時 100ml／200ml 分別為1000／1600；使用者批准只在 test 執行 `05-enable-test-student-pricing.sql` 後，價格為900／1440。先前以1600加入的4件200ml購物車會重新報價為5760，含運總額5880；建立付款單由 test runtime阻擋，當下資料庫 `orders=0`。

`06-test-reward-order-fixture.sql` 只接受上述三個 test Auth 帳號、有效綁定及 `reward-system-test-product`，透過正式 quote/create RPC 建立4件200ml的一般訂單，再由 test 管理員明確模擬確認收款並更新為delivered。首次以1件執行時被既有pro最低5000拒絕且全交易回滾；4件結果為小計5760、運費120、返饋快照1280、credited、老師餘額1280。`real_bank=false`、`notification_provider_called=false`，沒有連線永豐、LINE或Email。

實際登入畫面驗證：學生會員中心只見自己的訂單，老師會員中心顯示歷史學生訂單、待入帳及正式入帳Ledger，帳戶／可用餘額1280。另以authenticated＋READ ONLY交易驗證學生呼叫老師報表回傳42501；管理員受限RPC可讀到balance1280、1筆訂單及2筆Ledger。

Vercel環境變數已將正式Supabase及付款設定限縮於Production，Preview設定指向test Supabase且付款／LINE停用。commit `3816976` 推送至 `codex/instructor-student-rewards` 後，Git自動部署的Preview顯示Ready；實際開啟可見TEST橫幅、付款停用提示及test商品，網址為 `https://eclado-4446me43h-eclado-s-projects.vercel.app/`。正式網站、正式資料庫及正式學生價均未變更。
