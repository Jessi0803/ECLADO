# 提領未試算／試算中顯示（本機）

使用者確認「待更新」容易誤導後，批准僅本機調整顯示。

- 輸入0時，本次申請金額顯示NT$0；尚無有效後端報價的手續費、所得稅、健保及實匯顯示「—」，不誤稱0元。
- 空白或非有效整數輸入的申請金額顯示「—」；未符合申請條件顯示「請輸入至少NT$16，且不超過可用餘額的整數金額」。保留餘額、銀行、批次及未安裝的既有阻擋原因。
- 僅在部分提領試算請求確實送出且等待回應時，尚未取得值的欄位顯示「試算中…」；300ms防抖等待尚未送出不偽裝在計算。請求失敗後恢復「—」並呈現錯誤；合法後端回傳0仍為NT$0。
- 不改最低額、手續費、稅費、批次、報價RPC、提交／重送或帳務行為。

修改`src/components/account/RewardWithdrawalsPanel.jsx`及`tests/instructor-reward-withdrawals.spec.ts`。使用外連阻擋的隔離API模擬，`npx playwright test --config .playwright/withdrawal-preview.config.ts`桌面／手機56/56通過，包含0／不足額、等待回應、真0稅額、錯誤恢復、原提領與過期回應回歸。Vite Build474 modules及git diff --check通過（既有chunk警告；無lint指令，未執行SEO預渲染）。

5193本機假老師頁已實際輸入0，確認摘要為NT$0與四個「—」。此隔離環境既有缺少提領新批次SQL提示仍保留，不把畫面驗證當成正式提領驗收。沒有套用SQL、操作正式DB、提交提領、匯款、commit/push或部署。
