# 會員中心返饋金版面整理（本機）

## 確認範圍

使用者要求上下兩框整理會員中心師資返饋頁，後續明確暫緩顯示名下學生；本次不新增學生名單、會員查詢、SQL、RPC 或資料庫變更。

- 上框「師資返饋金」：可用返饋金與待入帳保持可見；查看金額明細、歷史學生訂單、返饋帳務紀錄各自預設收合，可獨立展開及操作原有分頁。
- 下框「返饋金提領」：獨立同樣的外框，包含原銀行資料、收款銀行編輯、申請提領、歷史提領與重新整理提領按鈕。
- 後台共用的師資帳務明細維持原本展開顯示，不套用會員中心的歷史摺疊。
- 重新查詢出錯時隱藏舊報表及其提領區塊，顯示錯誤，避免過期資料繼續呈現。此項由既有權限撤銷回歸測試發現。

## 修改檔案

1. `src/components/account/InstructorRewardsPanel.jsx`：上下框拆分、歷史摺疊、錯誤時舊內容隱藏。
2. `src/components/account/RewardWithdrawalsPanel.jsx`：獨立外框與同級標題。
3. `src/components/account/InstructorRewards.css`：摺疊歷史區塊間距與分隔線。
4. `tests/instructor-reward-queries.spec.ts`：確認兩框不互相包含、預設收合、展開／收合、既有分頁及錯誤呈現。

## 驗證

- 隔離本機服務、假 Supabase／付款 API、外連代理阻擋，執行查詢與提領兩個 Playwright 專檔，桌面／手機共 70 項。
- 第一輪 66 通過、4 失敗：歷史區塊收合後空資料測試需先展開；另既有元件在權限查詢錯誤後仍顯示舊報表。調整測試操作及錯誤顯示後，第二輪 `.last-run.json` 為 passed，失敗列表為空；無跳過設定。中途聊天跨日恢復後依該結果確認，未宣稱新跑第三輪。
- 指令：`npx playwright test --config .playwright/reward-layout.config.ts`；設定與結果目錄為 Git 忽略的本機測試產物，不載入有效雲端憑證。
- `./node_modules/.bin/vite build` 通過，472 modules；既有大型 chunk 警告。未執行會抓商品資料的 SEO 預渲染，不宣稱完整 npm build；專案無 lint 指令。`git diff --check` 通過。
- 不將上述模擬 API 的 UI 回歸宣稱真實銀行付款、正式提領或正式人工畫面驗收。

## 發布界線

未 commit/push、未部署、未改正式 DB 或學生價格開關，正式網站仍是上一版。學生名單需求暫緩；後台重整約 1～2 秒的效能診斷為獨立工作，本次沒有調整全站載入機制。

## 人工畫面驗收調整

使用者發現金額明細與歷史學生訂單間有重複橫線。移除本次新增的歷史區塊上框線，保留原金額摘要底部線；原訂單項目分隔線不變。本機瀏覽器實際 computed style 確認歷史訂單／帳務兩區的 border-top 皆為 0px，git diff --check 通過。仍未 commit/push 或部署。

## 人工驗收與 Git 發布批准

使用者在隔離本機會員中心確認版面及分隔線後，明確要求此次畫面調整 commit/push。僅提交上列四個程式／測試檔與本文件共五檔；先前銀行／worker待提交紀錄及 `.claude/launch.json` 不混入。目標為目前 main／origin/main，push 依既有設定觸發 Git 自動正式部署，不使用 Vercel 直接部署操作。分隔線最終修改後 Vite Build 再次通過（472 modules，既有 chunk 警告），未重跑與單一 CSS 刪除無關的完整金融測試。Git push 成功不等於已驗證 Production Ready。
