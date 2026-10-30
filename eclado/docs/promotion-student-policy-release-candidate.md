# 學生價／活動／師資返饋：發布候選

本階段完成獨立候選與驗證，正式資料庫、活動、網站及付款 API 尚未變更。候選基於目前正式來源 `c471584e4dddf318221291947ce9203bbc48f8c9`，分支 `codex/student-promotion-policy`，排除主工作區其他首頁、登入、商城等修改。

## 驗證結果

- 隔離資料庫整合測試：5 項通過，無略過；涵蓋活動分配、學生政策與歷史返饋快照。
- 桌面及手機 Playwright：14 項通過。
- 付款 API：82 項通過；模擬銀行，沒有真實付款。
- 完整 Vite 與 SEO 建置成功，62 商品、8 文章；保留既有大區塊警告。
- 加驗正式優惠券 `allow_auto_gifts`：移除自動價格活動時，恢復學生價及返饋。

真實 TEST 登入／商城／結帳與 RPC 驗收沿用既有證據；本輪重新執行上述隔離候選檢查。建置讀取公開商品資料，沒有修改正式業務資料。

## 可供下一階段執行的檔案

`promotion-student-policy-production-install.sql` 為尚未執行的正式安裝交易，包含來源與設定防護，首次安裝新政策為 false，保持既有活動分配 true。它不修改九筆活動政策。核心 migration、安裝後 verify 及正式目標盤點一併封存。

付款主機目前採既有目錄部署，需要成對更新 `server.js` 與 `assisted-orders.js`；候選封裝只含這兩個程式，不含環境檔與憑證。Git bundle 與 SHA256 manifest 保存在本機 gitignored `.playwright/release-artifacts/student-policy-20261030/`，manifest 記錄候選提交、檔案與封裝雜湊。

## 下一階段

正式操作前保存私有函式／權限／活動備份，再核對即時版本。依序安裝新政策 OFF、部署配套 API 與前端、驗證報價及投影；完成後才設定已盤點的九筆美容師活動 false／false 並啟用新政策。師資／經銷商活動保留。正式功能回復只關新政策，保留原活動分配 true 與已成立訂單快照。

此候選尚未推送、合併或部署，正式活動設定及銀行付款也尚未執行。精確驗證數據見 `evidence/promotion-student-policy/release-candidate-20261030.json`。
