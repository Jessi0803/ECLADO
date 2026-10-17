# 師資返饋後台入口整合

2026-10-14，使用者批准本機畫面調整。側邊欄四個返饋入口整合為「師資返饋管理」，內含返饋帳務、提領匯款、通知紀錄及財務對帳頁籤；預設顯示第一個有權限的頁籤。沿用現有黑白色彩、框線、字體及頁面元件，手機頁籤可橫向捲動。

入口權限取四頁原權限的聯集，每個頁籤繼續用原本 `canAccessBackofficePage` 條件；操作按鈕仍依原 manage／notifications.send 條件。只掛載目前頁籤，未授權頁面不發起查詢。不修改 SQL、API、金額、Ledger、付款或通知發送規則。

修改檔案：

- `src/admin/pages/RewardManagementPage.jsx`（新增整合容器）
- `src/admin/AdminApp.jsx`
- `src/admin/components/Sidebar.jsx`
- `src/admin/domain/access.js`
- `src/admin/pages/InstructorRewardsPage.jsx`
- `src/admin/pages/RewardWithdrawalsPage.jsx`
- `src/admin/pages/RewardOperationsPage.jsx`
- `src/components/account/InstructorRewards.css`
- `tests/instructor-reward-queries.spec.ts`
- `tests/instructor-reward-withdrawals.spec.ts`
- `tests/instructor-reward-operations.spec.ts`

驗證：三份 Playwright 專檔以 API mock 測試桌面與手機，56／56 通過；包含頁籤切換、僅提領 read 的權限範圍、既有報表／提領／通知操作回歸。Vite test build 通過（469 modules），保留既有 large chunk 警告；git diff --check 通過。初次對 test 模式執行測試，因既有 fixture 固定使用正式 project ref 的假登入儲存鍵而停在登入頁，已中止並改用原測試設定重跑，不修改真實登入設定。

本機 `http://127.0.0.1:5184/admin` 已用 test 管理員登入並打開整合頁面供使用者確認。沒有 commit／push、部署或資料庫操作。

## 老師端金額摘要簡化（2026-10-14）

使用者批准將老師端七項金額改成預設只顯示「可用返饋金」及「待入帳」，其他五項放入原生 details／summary「查看金額明細」。購物保留或提領保留大於0時，在收合區外提示處理中金額；負餘額提示維持。後台仍完整顯示七項金額，不修改帳務計算或API。

修改 `src/components/account/InstructorRewardsPanel.jsx`、`src/components/account/InstructorRewards.css`、`tests/instructor-reward-queries.spec.ts`。Playwright桌面＋手機14／14通過，涵蓋展開收合、保留提示、負餘額、權限撤銷與後台查詢；test Vite Build469模組及git diff --check通過，既有chunk警告。會員中心已開啟待人工確認。

## 收款銀行編輯收合（2026-10-14）

依使用者要求，預設只顯示目前遮蔽收款資料，右側「編輯」按鈕展開既有輸入表單；取消編輯或儲存成功後清空輸入並收合。無銀行資料時同樣可從編輯按鈕設定。維持既有銀行版本驗證、API、focus清空輸入及不持久保存敏感資料的規則。

修改 `src/components/account/RewardWithdrawalsPanel.jsx`、專用CSS及提領UI測試。Playwright桌面＋手機24／24通過（API mock），包含預設收合、開啟編輯、儲存收合、取消清空及重新開啟空白；test Vite Build469模組與diff check通過，保留既有chunk警告。未commit／push或部署。

本機驗收限制（2026-10-15）：5184 為 Vite 前端服務，沒有提供 `/api/reward-bank`，POST 實查404且內容空白，因此銀行資料實際儲存尚未完成本機整合。UI mock 通過不等於實際銀行 API／加密金鑰已配置；本次不新增後端服務。

## 後台銀行快照版面（2026-10-15）

使用者回報完整銀行快照擠在兩個操作按鈕之間，且缺銀行代碼。已將快照移出reward-actions，於按鈕下方獨立區塊用dl分欄呈現銀行代碼、銀行名稱、分行、戶名與帳號，手機單欄；遮蔽摘要同時補銀行代碼。保留manage權限、明確點擊解密、隱藏按鈕及focus清除，不修改API／SQL或帳務。修改RewardWithdrawalsPage、專用CSS及提領UI測試；桌面＋手機24／24通過，驗證欄位配對、無溢位、手動隱藏與focus清除；test Build469模組及diff check通過，既有chunk警告保留。僅本機修改，未commit／push。

## 通知紀錄精簡列（2026-10-15）

依使用者批准，預設呈現事件／狀態、遮蔽收件對象／管道與最後嘗試時間，桌面橫向排列、手機緊湊堆疊；提領ID、版本、各管道次數、下次重試、錯誤分類及逐次紀錄收於「詳細資料與重試紀錄」。時間以台北時區格式化。符合原狀態與manage＋notifications.send權限的補發按鈕仍可直接操作；pending不增加強制發送入口，不修改worker／RPC／冪等或帳務行為。

修改RewardOperationsPage、專用CSS及operations UI測試；Playwright桌面＋手機22／22通過，涵蓋展開收合、台北時間、待發送無補發按鈕、原通知重送鍵與權限回歸。test Build469模組及diff check通過（既有chunk警告）。未commit／push，既有Preview尚未更新。

## 共用重新整理及頁籤寬度（2026-10-15）

使用者批准四頁刷新移至「師資返饋管理」主標題右側，只保留一個按鈕；頁籤列width:max-content、max-width:100%，桌面依實際按鈕寬度、手機不足時橫向捲動。RewardManagementPage傳入refreshVersion觸發目前子頁原查詢effect，不以key重建子頁；維持原頁碼與提領／通知未確認操作ref／防重鍵。銀行完整快照在刷新時隱藏；帳務沿用原刷新清除選取老師的行為，嵌入後台的帳務明細不再另顯示刷新按鈕。老師會員中心的刷新維持原樣。「執行財務對帳」「重送原操作／原處理結果」仍是獨立操作。

修改RewardManagementPage、InstructorRewardsPage、RewardWithdrawalsPage、RewardOperationsPage、InstructorRewardsPanel、專用CSS及operations／withdrawals測試。三專檔桌面＋手機64／64通過（API mock），涵蓋四頁僅查當前資料、不執行對帳、分頁保留、未知結果刷新後同鍵重送、銀行隱藏與原權限；test Build469模組與diff check通過（既有chunk警告）。僅本機修改，未commit／push或改DB／API。

## 師資帳務側邊明細（2026-10-15）

使用者批准將選取師資後的帳務由列表尾端改成右側抽屜，沿用既有detail-panel-wide與usePanelHistory。面板獨立捲動，手機全寬；提供關閉、遮罩、Esc、手機返回及瀏覽器返回，焦點限制於面板，關閉後回原老師按鈕並保留名單頁碼／位置。顯示所選老師名稱，帳務資料仍由原受限RPC查詢，不新增聯絡資料或比較價格。

修改InstructorRewardsPage、專用CSS、queries UI測試。16／16桌面＋手機通過（API mock），含每頁20位、第二頁選取、明細在可視範圍內、獨立捲動、手機全寬、返回關閉與位置保留；原老師／後台權限回歸通過。初次20位測試在新頁API回應完成前操作舊DOM而有2項失敗，補等待新頁指定老師渲染後重跑全檔通過。test Build469模組及diff check通過，既有chunk警告保留。僅本機修改，未commit／push或操作DB。

## 對帳執行按鈕位置（2026-10-15）

依使用者進一步確認，最終版沿用procurement-header：左側為標題及其下方說明，右側為「執行財務對帳」，不把按鈕插在標題與說明之間。手機沿用既有標題列響應式。只修改RewardOperationsPage，移除前一版額外CSS，不改原權限、busy、防重鍵或確認提示。operations UI回歸首批23通過／1項因未等待頁籤新查詢的測試時序失敗，補齊測試等待後通過；最終版再次全檔桌面＋手機24／24通過，test Build469模組及diff check通過。尚未commit／push。

使用者另以庫存盤點按鈕為對齊範例，補上按鈕專用align-self:flex-start，與左側標題區塊上緣對齊，說明維持標題下方；不修改全站header。對帳操作桌面＋手機2／2回歸及test Build469模組、diff check通過。修改RewardOperationsPage與專用CSS，未commit／push。

上方共用「重新整理」也依使用者要求採相同右側頂端對齊。修改RewardManagementPage與專用CSS；四頁刷新桌面／手機2／2回歸、test Build469模組及diff check通過，未commit／push。

## 對帳異常中文說明（2026-10-15）

依使用者要求，將現有SQL輸出的19種異常代碼全部轉成中文標題與核對說明；預期／實際資料以中文欄位分欄呈現，區分金額、事件次數、缺資料及狀態。`account_ledger` 顯示「帳戶與帳務明細不一致」；原代碼與原JSON收在技術明細，未知代碼保留原始資料供查核。只改呈現，不改DB檢查規則／RPC／資料／補正流程。

新增src/admin/domain/rewardReconciliation.js、tests/integration/reward-reconciliation-presentation.test.mjs；修改RewardOperationsPage、專用CSS與operations UI測試。單元測試2／2通過（比對SQL全部19類、金額與次數區別、負值／null／未知欄位保留），桌面＋手機26／26通過，test Build470模組及diff check通過，既有chunk及Node模組類型提示保留。未commit／push。

另依使用者要求在獨立本機PostgreSQL示範一筆account_ledger異常：Ledger1000、帳戶1100，實際執行對帳checked56／findings1；網站http://127.0.0.1:5190/admin已顯示中文結果。使用/tmp/eclado-reconciliation-demo.mjs臨時衍生腳本，假登入／假外部服務、隔離資料庫，不操作正式或test Supabase，也不把故意不一致資料／產生器放入產品程式。

## 師生設定按鈕位置（2026-10-15）

依使用者要求，「重新載入師生設定」移至「師生綁定與學生類型」標題同列右側，「儲存老師類型」放在學生價格類型選單右側並底端對齊欄位。只修改InstructorStudentSection及專用CSS，不改資料載入、清空確認、版本衝突、師生綁定或權限。既有instructor-student-admin桌面＋手機8／8通過、test Build470模組及diff check通過（既有chunk警告）。未commit／push。

後續依使用者要求，選單及儲存按鈕統一為40px高；專用CSS限定此表單，不影響其他按鈕。既有老師類型測試新增boundingBox等高斷言，桌面／手機2／2通過，test Build470模組及diff check通過，未commit／push。

## 四分頁說明白話化（2026-10-15）

依使用者要求，返饋帳務、提領匯款、通知紀錄與財務對帳改用簡短用途說明，移除服務商、Ledger與LINE錯誤碼等工程措辭。提領保留每月10日批次、假日人工順延且名單不變，以及結果不明先查帳的提醒；對帳保留不自動修改金額的說明。不改任何帳務、通知或匯款行為。修改InstructorRewardsPage、RewardWithdrawalsPage、RewardOperationsPage及既有withdrawals測試的文字斷言。桌面／手機針對四分頁回歸8／8通過（API mock），test Build470模組通過（既有chunk警告）；首次沙盒內瀏覽器啟動受限，沙盒外重跑通過。使用者已確認畫面符合預期。未commit／push。

## 老師端提領用語與確認畫面（2026-10-15）

依使用者提出的四點調整：老師歷史提領「明確失敗」改為「匯款失敗（已全額退回）」、「待查帳」改為「匯款結果確認中」；會員中心及共用帳務摘要的「購物保留／提領保留」改成「購物付款處理中／提領處理中」。管理員提領狀態分類保持原樣。缺銀行及可用餘額<=15時顯示具體停用原因；銀行說明註明修改只適用新申請，已成立申請快照不受影響。

移除老師端window.confirm，改用網站樣式的HTML dialog：逐欄顯示後端quote的申請額、手續費、實匯額、日期與銀行代碼／名稱／分行／戶名／帳號末四碼。沿用後端遮蔽資料，不新增完整銀行帳號讀取。確認後才產生request key並送出原RPC，返回／Esc不送出；網路不明沿用原key與quote重查，報價過期由原後端拒絕並重新確認。dialog原生焦點限制、背景不可操作、關閉回申請按鈕；畫面重新取得焦點時關閉舊確認並刷新。查報價成功不清除底層表單，避免焦點回復目標被重新建立。

修改：src/components/account/RewardWithdrawalsPanel.jsx、InstructorRewardsPanel.jsx、InstructorRewards.css與tests/instructor-reward-withdrawals.spec.ts及本文件。不修改SQL、API、帳務、付款或提領資格。

驗證：BASE_URL=http://127.0.0.1:5185 npx playwright test tests/instructor-reward-withdrawals.spec.ts tests/instructor-reward-queries.spec.ts --project=chromium --project=mobile-chrome --workers=1，48／48通過（API mock，非實際匯款）。首輪47／48，發現取消確認後焦點未回申請按鈕，修正後全檔重跑通過。最後新增視窗水平置中斷言，確認測試桌面／手機再跑2／2通過。npx vite build --mode test，470模組通過（既有chunk警告）；git diff --check通過。僅本機，未commit／push、部署或操作雲端DB。

## 管理員批次匯出與匯款操作（2026-10-15）

已依使用者確認的通用CSV與pending／processing範圍，新增後端批次搜尋、20筆分頁、跨頁批次合計、manage-only解密匯出及不可變稽核；paid改用日期選擇／金額驗證／保留草稿的單一表單。詳見 `docs/reward-withdrawal-operations.md` 的檔案、SQL、測試與套用／回復說明。PostgreSQL17.6兩個DB測試通過，verify另跑通過；API／CSV 9／9，桌面／手機最終62／62，本地真SQL＋模擬外部服務整條操作1／1通過，test Build471模組與diff check通過。僅本機，未套用雲端DB或commit／push。新版管理頁依賴新增operations SQL，下一次Preview發布前需先取得test Migration授權。

2026-10-15後續放行：使用者已批准test安裝與commit／push。qqlgqasbmbicnmvnlqbr新operations SQL已成功安裝，唯讀verify七項全true，test原學生價ON保持不變；正式DB不動。證據與發布範圍見docs/reward-withdrawal-operations.md最新段落。

## 批次合計與CSV匯出同區（2026-10-16）

依使用者確認，匯出按鈕與說明移入批次合計section，移除原匯出reward-subsection的頂線與空白；批次區只保留整區內容之後的一條底線。修改RewardWithdrawalsPage.jsx及InstructorRewards.css，匯出權限、篩選、合計與下載流程不變。既有下載／唯讀權限桌面與手機4／4通過，test Build471模組及git diff --check通過（既有chunk警告）。未commit／push，現有Preview仍是舊版。

2026-10-17提交前重新驗證：匯出／唯讀管理桌面與手機4／4通過；test mode Build472模組通過（既有chunk警告）。本次僅提交排版調整，未修改資料庫或匯出權限。
