# 自選提領金額與每批次一筆申請

2026-10-18：師資可輸入提領總額或按「全額帶入」。最低16元，只接受整數且不能超過可用餘額。15元手續費及兩項稅費均包含在申請總額內，扣款公式沿用 [提領扣款明細](reward-withdrawal-deductions.md)。

例如可用餘額30,000元，申請10,000元，保留10,000元、實匯9,985元，其餘20,000元仍可購物。剩餘款若要提領，須等下一批次。

## 批次及帳務

- 依原有台北時間每月10日00:00的切批規則，同一師資、同一批次最多一筆有效申請。pending、processing、unknown、paid 均占用名額。
- failed 只會在管理員確認銀行未付款且執行退回帳務的交易成功後釋放名額。不能自行取消／修改已送出的申請。
- 已匯款後即使仍有餘額或新收入，同批次仍不能再提領；下一批次可再申請，不受上一批次名額影響。
- 唯一部分索引保護資料；帳戶列鎖序列化申請與購物，送出時重算試算、核對帳戶與銀行版本。相同 request key 重送已成功的申請仍回傳原紀錄，不會被當成新增第二筆。
- 帳本僅保留申請總額，完成匯款扣除該筆保留額，明確失敗退回該筆總額；不重新計算既有申請或扣款快照。
- 後端在所有紀錄中判斷本批次有無有效申請，不依畫面目前的歷史分頁判斷。頁面顯示原因並禁止新增，直接呼叫RPC仍會拒絕。
- 自選金額輸入後由後端試算，較舊的非同步結果不覆蓋新金額；正式送出前再取得試算並讓師資確認。網路結果不明時保留原申請鍵及金額，只可重查原申請。

## 安裝順序

在返饋金所有既有依賴與 `supabase-instructor-reward-withdrawal-deductions.sql` 之後，執行 `supabase-instructor-reward-withdrawal-partial.sql`，再執行 `supabase-instructor-reward-withdrawal-deductions-verify.sql`、`supabase-instructor-reward-withdrawal-partial-verify.sql`，最後部署前端。

此 migration 可重跑，保留舊全額試算RPC供既有客戶端呼叫，也增加指定金額的RPC。新版前端檢查 `selection_policy`，資料庫未升級時會停止申請，避免錯用全額規則。後續不可重放舊扣款／提領SQL覆寫新函式；重建環境必須把本檔放在最後。

安裝前若既有紀錄出現同一師資、同一批次有多筆非 failed 申請，migration 整筆回滾並提示人工確認，不刪除、合併、取消或修改歷史財務紀錄。單批次限制不是通用稅務合併給付判定，會計確認事項仍依扣款文件。

## 本機驗證

- `EMBEDDED_POSTGRES_MODULE=/path/to/embedded-postgres/dist/index.js node --test tests/integration/reward-withdrawal-partial-db.test.cjs`
- `npx playwright test tests/instructor-reward-withdrawals.spec.ts --project=chromium --project=mobile-chrome --workers=1`

整合測試使用隔離 PostgreSQL，以真實學生訂單產生返饋金，涵蓋舊紀錄保留、金額及稅費邊界、雙連線同時申請、重送相同鍵、各種占用狀態、失敗退回重申、剩餘餘額真實購物、下一批次及財務對帳。沒有連銀行、發信或寫入雲端資料庫。

本機驗證：桌面／手機54項案例、稅費及部分提領兩組隔離 PostgreSQL 整合測試、兩份唯讀驗證腳本與正式版建置通過。財務對帳沒有新增差異；共用測試底稿原有的刻意晚到付款待查項目維持原狀。未 commit、push、部署或更新 test／正式資料庫。
