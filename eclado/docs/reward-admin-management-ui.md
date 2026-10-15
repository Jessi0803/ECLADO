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
