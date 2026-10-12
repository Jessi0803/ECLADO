# 階段 3｜老師／管理員返饋金查詢

2026-10-12：僅本機及隔離驗證，待使用者驗收。分支 `codex/instructor-student-rewards`，起點 `c384faa`。沒有正式 DB、Migration、部署、Vercel 操作、main 合併、commit／push 或階段 4；學生價格維持 OFF。

## 檢查與規劃

已讀統一開發 v1.4（含 2A／2B Git 紀錄）。2A `student_reward_snapshots` 保存凍結歸屬與價格／逐項返饋；2B 帳戶、order states、Ledger 及收款證據封閉直讀，查詢不得新增老師讀整筆學生 orders／profiles 的 RLS policy。`AccountPage` 已有 orders／professional 分頁，後台沿用 `canAccessBackofficePage`／`has_backoffice_permission`。

最小範圍：獨立唯讀 SQL 投影與 RPC、會員返饋頁籤、後台帳務頁、service／mock／測試；不改 2A／2B 表結構、事件／付款函式或既有購物金。檢查後估計含隔離驗證 12–18 工程工時，非實際計時結果。

## 已確認的業務需求／本次決策

- 老師查看歷史學生訂單商品、數量、金額及返饋；待入帳、累計已入帳／扣回、signed balance 與可用餘額。歷史授權按 snapshot.instructor_id，不依目前師生綁定。
- 使用者確認：目前 instructor 才能本人查詢；降級停止查詢，歷史／餘額保留，恢復 instructor 可查。
- 使用者確認：顯示商品金額與返饋可能算回比較價（正返饋時 basis－reward/qty；單商品訂單亦然），接受此推算；禁止直接回傳比較價／折數欄位。不能宣稱比較價完全不可推算。
- 老師不可查他人帳戶、學生聯絡資料或完整訂單。沒有新增折抵／提領／帳務寫入功能。

## 現有程式及隔離驗證的行為

`supabase-instructor-reward-queries.sql` 新增 5 個 STABLE 函式，均空 search_path、明確 schema：

- `instructor_reward_report_internal(uuid,integer,integer,integer)`：私有逐欄投影。snapshot／profile 姓名／order 商品名稱規格／state／ledger 查詢，單次 SQL statement 的 MVCC 快照。
- `assert_instructor_reward_read_admin()`：私有權限 helper；有效管理員及 orders.read＋members.read。沒有新權限或調整既有角色授權。
- `get_my_instructor_reward_report(integer,integer,integer)`：只使用 auth.uid，驗證目前 instructor；不接受任意老師 UUID。
- `get_admin_instructor_reward_report(uuid,integer,integer,integer)`：已授權管理員選老師，與本人共用投影。
- `get_admin_instructor_reward_accounts(integer,integer)`：目前 instructor 與歷史帳戶 UUID directory，姓名／角色／有效綁定數／signed balance／pending／closed，提供 account sum(delta) 與 snapshot/state 身分／金額異常旗標。

只有三個公開 RPC 授 authenticated；PUBLIC／anon／service_role 與客戶端 helper EXECUTE 關閉。原私有表／RLS／ACL 不變，不公開支付 receipt、銀行 reference、actor UUID、會員 Email／電話／地址、師資單價／倍率、學生倍率或完整 items。

報表 summary 的 credit／reverse 是全歷史 Ledger 累計；pending／signed balance 取帳戶，available=max(0,balance)。各頁顯示全帳戶 summary，不把當頁小計誤作餘額。訂單與 Ledger 各有獨立 offset，預設 20、後端上限 50，拒絕 null／負數／超限參數；排序使用 snapshot(created_at,order_id) 與 ledger.id。沒有匯出或一次無限量載入。

姓名取目前 profiles.name，未新增姓名快照；刪除後 null／已刪除會員，不用 orders.member 或 email 回填。商品名稱／規格取原 orders.items 的受限欄位，金額／數量／返饋取 2A；原 order 缺失則明確標記，商品保留 ID／金額／返饋，不能保證缺失 order 的名稱仍存在。沒有讀現商品價格重算。

會員中心／後台共用 `InstructorRewardsPanel`，分頁、負餘額提示、讀取失敗／未安裝區分、focus／手動刷新；重新查詢先清除舊報表，取消過期請求回寫。未安裝 PGRST202 顯示明確錯誤，不降級為零餘額。後台入口及 SQL 均要求 admin/super_admin 與兩 read 權限；只有 orders.read 的管理員不能進入。

## 修改檔案（14 檔）

| 相對 eclado/ 檔案 | 內容 |
|---|---|
| supabase-instructor-reward-queries.sql | 五個受限唯讀函式及 ACL |
| supabase-instructor-reward-queries-verify.sql | 唯讀 OFF／公開及私有 EXECUTE／表存取驗證 |
| src/services/instructorRewards.js | 三個 RPC 的服務層 |
| src/components/account/InstructorRewardsPanel.jsx | summary／歷史學生訂單／Ledger、錯誤及分頁 |
| src/pages/AccountPage.jsx | instructor 返饋頁籤，既有頁籤保留 |
| src/admin/pages/InstructorRewardsPage.jsx | 管理員 account directory／查核／老師報表 |
| src/admin/AdminApp.jsx | 新頁接點 |
| src/admin/components/Sidebar.jsx | 權限控制的選單 |
| src/admin/domain/access.js | 既有兩項 read 權限及角色的交集 |
| tests/support/eclado-mocks.ts | 三 RPC 預設 mock，避免正式外連 |
| tests/instructor-reward-queries.spec.ts | 桌面／手機本人／後台／撤權／錯誤／刷新／分頁 |
| tests/integration/instructor-reward-queries-db.test.cjs | 實際 SQL、權限、歷史、MVCC及回歸 |
| tests/eclado-frontend.spec.ts | 原季度統計案例先選既有「專業資格」頁籤 |
| docs/instructor-reward-queries.md | 設計、證據及風險 |

外部「統一開發.md」另更新，非 Git 專案檔。沒有修改未追蹤的 1C 正式紀錄與 `.claude/launch.json`。

## 測試證據

- PGlite 八檔批次：9 通過、0 跳過，含 3／2B／2A／1C／1B／member-pricing／assisted／付款 RPC 授權。階段 3 單檔亦通過。
- 隔離 PostgreSQL 17.6：階段 3 整合檔 1 通過、0 跳過。真實 admin／role permission 查詢、authenticated／anon SQL 角色與 private-table/helper 拒絕、角色降級／恢復、換綁後新舊老師分離、學生 Auth 刪除及原代客刪除拒絕、原 order 缺失、summary與 ledger、分頁／錯誤参数、OFF、SQL 重跑／verify 通過。
- PostgreSQL 獨立 writer transaction 建 receipt／完成入帳未 commit 時，reader 仍讀原 pending 與原餘額；commit 後同一 RPC 的 summary／state／ledger 同步可見，deadlocks=0。不是窮盡所有並行排程。
- 所有原有 public 函式 definition＋ACL fingerprint 前後相同；測試將原 fixture 的 permission stub 暫時換成實際引擎，最後原定義完整回復再核對，不修改專案實際權限來源。
- 白名單拒絕直接 comparison／multiplier、聯絡資料／receipt reference 等欄位。只證明直接欄位保護，不否認使用者已接受的推算。
- Playwright 四檔桌面／手機批次 70 通過（含新查詢 12 項）；既有會員訂單、購物金、季度資格、後台訂單及 LINE 出貨回歸 10 通過。
- 最終新查詢專檔桌面／手機 12 通過（15.2秒），最終隔離 Build 再通過（460 模組、1 mock 商品／8 文章）；批次與專檔重疊，不相加作獨立案例數。
- 已完成隔離 Build：460 模組、1 mock 商品／8 文章，既有大型 chunk 警告保留。專案沒有 Lint script；node --check／git diff --check 通過。
- 初期 fixture 重複會員／缺 read/write 權限、原代客 Auth 刪除限制、verify 多 statement 執行方式與 permission stub還原問題已修正；UI 重複文字選取已修正。原季度案例未切「專業資格」導致不可見，只補測試切換，未改預設頁籤／季度計算；最終 10 項通過。失敗與中止批次不列為通過。

## 建議但尚未確認／剩餘風險

- 正式安裝前另核對 2A＋2B schema／ACL／Auth／PostgREST、完整權限矩陣及回復方案；本次不宣稱驗證正式環境。先前 1B／1C 前端部署及人工驗收仍待獨立授權，不阻擋本機查詢開發。
- SQL 不修改 2A／2B、功能開關或帳務；正式未安装會顯示尚未安裝，不能直接開啟學生價或部署。回復可撤三 RPC EXECUTE／撤前端入口，保留所有金融資料；本次未執行回復。
- Offset 分頁的單次報表資料一致，但翻頁之間若有新事件，可能位移／重複顯示；總數及每頁 summary 都是各次最新值，非跨頁凍結快照。後續如需大量固定期間匯出，另規劃 keyset／snapshot，非此階段功能。
- 未做正式資料量負載測試；directory 基本異常旗標不是完整對帳引擎，全面對帳屬階段 6。現有 instructor/time 與 ledger/instructor/id 索引沿用。
- 既有代客訂單 Auth 刪除衝突繼續獨立列管；姓名未保留刪除快照，缺失 order 不回填聯絡或現價。
- 負額 UI 用受控 fixture，尚無返饋折抵／提領事件。階段 4／5 尚未實作，不新增營運規則。

## 驗收狀態

達到階段 3 本機驗收條件，待使用者驗收。沒有 commit／push、正式操作或階段 4。

## 階段 3 驗收與提交授權（2026-10-12）

使用者要求完成階段 3 驗收與獨立 commit／push。核對既有隔離驗證、14 檔 diff、敏感資訊及空白檢查後，本機驗收完成；本次沒有新增邏輯變更，沿用上列通過結果。批准將本階段 14 檔獨立提交至 `codex/instructor-student-rewards`；正式 DB／Migration／學生價格啟用與階段 4 不在此次授權內。先前「未 commit／push」為實作時狀態，實際 hash／push 結果記於外部「統一開發.md」。未納入三份正式部署紀錄及 `.claude/launch.json`。
