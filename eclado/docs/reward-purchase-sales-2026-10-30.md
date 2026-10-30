# 返饋帳務中的師資本人叫貨額

使用者批准先本機實作：師資帳戶列顯示本月網站叫貨及本季合計；詳細面板可切換年度，顯示每季網站／線下／合計與預設收合的每月網站叫貨。統計本人訂單，不含名下學生，沒有更改返饋、錢包、提領或續約判定。

## 統一計算來源

新受限讀取 RPC `get_admin_reward_purchase_sales(uuid[],integer)` 每次最多50位，前端只傳目前頁面最多20位。列表一次批次呼叫，不逐一請求會員；詳細面板只查所選師資。沿用有效 admin／super_admin＋orders.read＋members.read。僅authenticated有EXECUTE；anon／service_role及一般會員不能呼叫，無新表／寫入。

季度直接呼叫既有 `get_professional_renewal_assessment` 並只投影季度／網站／線下／合計，沒有拷貝續約季度公式或回傳學生獎狀、資格判定、銀行／聯絡資訊。每月依同樣的有效資格期間、有效訂單狀態、台北付款日期及 `order_net_merchandise_amount` 商品淨額統計，排除未付款、取消與退貨、不含運費；兩錢包只是支付方式，不再從叫貨額扣減。線下補登只有季度值，不能分攤到月份。

新SQL `supabase-instructor-reward-purchase-sales.sql` 依賴既有專業資格續約與返饋查詢功能。正式使用前須另外批准安裝本增量；舊DB缺RPC時只在叫貨區提示尚未安裝，返饋帳務仍正常顯示，不用0冒充讀取失敗。

## 驗證

- PGlite隔離PostgreSQL引擎：1個整合情境通過、0skip。載入既有實際續約／金額／管理員權限函式，核對季度結果逐欄一致、月額加總等於季度網站叫貨、跨台北季界、資格起訖、學生訂單／未付款／取消／退貨排除、折扣／運費／錢包、線下季度補登、批次去重／上限／年度及空參數驗證、匿名／老師／學生／停用管理員／缺權限拒絕、EXECUTE ACL。這不是完整正式Schema或併發壓測。
- 第一輪SQL別名month遇保留字，改為month_number；fixture金額參數與運算推導integer／numeric不一致，明確轉numeric後測試通過，沒有改營運規則來配合fixture。
- Playwright桌面／手機20/20通過（原16＋新增4），驗證兩位列表一次批次、年度切換、線下分欄與月額分開、缺migration不偽裝0且保留返饋歷史。首次sandbox不允許啟動Chromium，經允許重跑完成。API皆mock。
- Vite Build 496 modules成功，保留既有大chunk警告；差異與腳本語法檢查通過。未執行SEO遠端預渲染或正式金融交易。

指令：

```sh
PGLITE_MODULE=/private/tmp/eclado-reward-sales-tools/node_modules/@electric-sql/pglite/dist/index.js node --test tests/integration/reward-purchase-sales-db.test.cjs
BASE_URL=http://127.0.0.1:5194 npx playwright test tests/instructor-reward-queries.spec.ts --project=chromium --project=mobile-chrome --workers=1
```

## 本機人工驗收

`PGLITE_MODULE=本機PGlite路徑 node scripts/reward-purchase-sales-preview.mjs` 預設5192，假管理員／示範資料及隔離SQL，不讀.env、不轉送外部請求。網站叫貨18000、季度線下補登5000，供列表與明細核對；2025年另有跨季／退貨／資格期間測試資料。前端年份依台北當年；預覽資料關閉程序即丟棄。

本機網址 `http://127.0.0.1:5192/admin`，選師資返饋管理→返饋帳務。自動接管既有瀏覽器錯誤頁被瀏覽器工具安全規則阻擋，未繞過限制；可由使用者自行開啟連結檢查。自動化回歸通過不代表使用者已完成人工驗收。

未套用test／正式DB、未commit／push或部署；原有.claude/launch.json及其他工作截圖保留不動。


### 2026-10-30 正式增量安裝及發布準備結果

使用者已確認本機畫面，要求commit／push main；並針對正式查詢權限新增，明確批准安裝SQL及接續部署。已先唯讀比對正式續約assessment、商品淨額與返饋管理員權限helper，三者函式本體（去空白）皆與本機一致，新RPC原本不存在；正式新增唯讀RPC成功。

正式READ ONLY驗證新RPC本體與待提交來源一致、authenticated限定EXECUTE、anon／service_role拒絕、匿名身分拒絕。以有效管理員claims核對目前9位師資，季度各欄逐筆等於既有續約計算，所有月額加總等於對應季度網站額；只回傳驗證布林與人數，沒有保存會員個資或金額明細。未寫入訂單、返饋、續約、提領或開關。證據：docs/evidence/reward-purchase-sales-production-20261030.json與PNG。

使用者要求的後續版面已整理：取消重複上分隔線、標題／簡短副標同組且年度靠上、縮短季表與月額間距，分隔線改到整個叫貨區塊下方。最新PGlite 1/1、桌面／手機20/20與Vite 496 modules重跑通過；既有chunk警告保留，沒有執行遠端SEO預渲染。上述成功不等於正式瀏覽器登入驗收，Git發布狀態需push後另核對。
