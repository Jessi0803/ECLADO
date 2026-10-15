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
