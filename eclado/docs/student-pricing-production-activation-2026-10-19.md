# 正式學生價格啟用紀錄

使用者明確要求「先幫我開啟學生價」，取代先前保持 OFF 的限制。

- 專案：`ilvdvlkdpntwmaijncaz`，正式 Supabase SQL Editor。
- 啟用時間：2026-10-19 21:57:29 Asia/Taipei（13:57:29 UTC）。
- 啟用前唯讀核對：enabled=false、version=0；student_1=0.90、student_2=0.95；快照及 Ledger 表存在。
- 僅更新 `student_pricing_feature_settings` singleton：enabled=true、version=1、updated_at=now()；使用原狀態條件及交易，狀態不符即中止。
- 交易提交後另以 READ ONLY / ROLLBACK 查詢確認 enabled=true、version=1，折數未變。
- 證據：`evidence/student-pricing-production-enabled-20261019.jpg`。

本次未執行 Migration、部署、commit/push、建立訂單、增加返饋餘額或付款。啟用影響所有符合資格的新一般／代客訂單，不限目前測試帳號。舊訂單不重新計價，也不補建返饋快照。

既有正式訂單 `ECL-20261019-135317-81883FD2` 於開關啟用前建立，金額 NT$5,370，未用返饋金；本次不修改或取消該單。開啟開關本身不會使老師立即取得可用返饋金；仍須合法學生訂單、有效收款證據與 delivered／picked_up 才入帳。正式學生交易、返饋入帳後折抵與實際付款回呼仍待驗收。

歷史發布與測試文件中的 OFF 為各自當時狀態，以本紀錄為最新學生價開關狀態。後台師生設定仍有「價格未啟用」等固定歷史文案，不代表實際開關；本次未順便修改程式。

## 後續：師生設定文案修正（本機，尚未發布）

使用者確認畫面仍顯示未啟用後要求調整。`src/admin/components/InstructorStudentSection.jsx` 的老師名下學生及學生本人關係兩處，改為單純「資格符合／資格暫停」；區塊說明改為資格仍需搭配全站開關，不假裝讀取開關。類型與綁定儲存提示不再宣稱「商品售價不變」，改說明下次報價重新確認價格。

只修改前端文案與既有測試斷言，不修改 API、資格、定價或正式資料庫。`tests/instructor-student-admin.spec.ts` 相關既有兩個案例使用隔離本機服務、假 API、阻擋外連，桌面與手機共 4/4 通過；`vite build` 通過（472 modules，既有大型 chunk 警告）。未執行 SEO 預渲染及正式銀行交易；專案未配置 lint 指令。Git diff whitespace 檢查通過。未 commit/push，正式網站仍待 Git 自動發布後才顯示新版文案。

## 後續：移除獨立人工收款按鈕（本機，尚未發布）

已告知使用者移除會失去對已付款／出貨／到貨但缺收款證據訂單的不改狀態補確認入口；使用者接受並要求先移除。`src/admin/pages/OrdersPage.jsx` 僅移除獨立按鈕、專用 `confirmManualPayment` 函式及其 ref。保留 `updateStatus` 切換 paid 時的明確確認與收款 RPC、既有權限檢查、銀行回呼及帳務處理，不新增替代入口或修改正式訂單。

`tests/instructor-reward-payment.spec.ts` 改從狀態選單驗證確認／拒絕，確認按鈕不存在、取消不寫收款、同意保存原 RPC 參數後切換 paid、依賴錯誤不繞過。隔離 API 模擬桌面／手機共 6/6 通過，Vite Build 472 modules 通過（既有 chunk 警告）；未執行正式付款或完整 SEO 預渲染，無 lint 指令。未 commit/push 或部署。

## 後續：後台訂單返饋金支付明細（本機，尚未發布）

使用者要求沿用購物金支付明細呈現師資返饋金折抵。檢查發現 `normalizeOrder` 未帶入 `reward_credit_amount`，訂單詳細又僅在購物金大於零時顯示付款拆分，導致僅返饋金訂單看不到折抵。`src/admin/domain/mappers.js` 新增返饋金支付映射，沿用後端 payment_amount，舊資料缺該欄位時的顯示回退納入兩種錢包；`src/admin/pages/OrdersPage.jsx` 任一錢包有折抵即顯示訂單總額、各有使用的錢包支付及尚需付款，返饋金使用相同紅色負額樣式。返饋金零元不顯示該列。

未修改報價、建單、付款 API、Ledger、資料庫或列印明細。`tests/admin.spec.ts` 以假 API 測試僅返饋金、雙錢包、舊單無錢包及既有僅購物金，桌面／手機共 8/8 通過；Vite Build 通過，既有大型 chunk 警告；git diff --check 通過。未驗收正式銀行交易，未 commit/push 或部署。
