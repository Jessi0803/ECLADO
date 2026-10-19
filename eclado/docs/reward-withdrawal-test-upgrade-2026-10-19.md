# 提領更新：test 安裝與驗收

日期：2026-10-19（Asia/Taipei）。目標僅 test `qqlgqasbmbicnmvnlqbr`，透過已登入 Supabase SQL Editor 核對專案名稱與 URL。正式資料庫未操作。

## 授權及備份重建

使用者批准依發布順序逐步執行，並明確選擇「備份後重建 test 測試訂單、返饋帳務及提領假資料，保留帳號、商品與設定」。原31筆提領中30筆為2026-10-15的列表假資料；三個批次有效申請數8／8／7，會阻擋新版批次唯一索引，未跳過安裝檢查或改寫舊單。

已在私有 schema `reward_test_backup_20261019` 備份27張帳務與訂單相依表。備份表啟用 RLS，schema／表均撤除 PUBLIC、anon、authenticated、service_role 權限。每表將 JSON 還原到具相同欄位、型別、CHECK、索引的暫存表，核對完整 JSON 指紋後才提交備份。暫存還原不包含跨表外鍵及業務 trigger 重播，不能宣稱整個 Supabase 專案的災難復原演練。

另存本機 `/private/tmp/eclado-test-withdrawal-backup-20261019.json`（不納入Git），解析確認27筆表級備份，各自 row_count 與 data 長度相同。SHA256：`172bd77a48bfac81bb6f9d01da97dcfc1ecc94e936ad8b926ca989b775187791`。同份備份另存於本機 Git 忽略目錄 `.playwright/private-backups/eclado-test-withdrawal-backup-20261019.json`，檔案權限600；資料庫備份亦持續保留。

重建前主要筆數：orders30、student_reward_snapshots30、reward accounts1、ledger111、withdrawals31、events80、outbox82、exports1。重建以一個交易鎖定明確27表、先比對備份指紋，再 TRUNCATE，不使用CASCADE、不關閉trigger／RLS、不重設sequence。不是正式金融資料清理方案。

清理後核對 orders／withdrawals／ledger 都為0，Auth3個測試帳號、銀行設定1筆保留；其餘41張public表完整資料指紋一致，包含原商品、會員、權限及設定。

## 更新與測試資料

依序成功執行：

1. `supabase-instructor-reward-withdrawal-deductions.sql`
2. `supabase-instructor-reward-withdrawal-partial.sql`
3. 上述兩份 `-verify.sql`，完整執行，最後結果為 `partial withdrawal verification passed`。
4. [符合新規則的假資料](reward-staging-upgrade/09-test-withdrawal-partial-fixtures.sql)。只接受3個指定test Auth及已重建狀態，不能重跑舊30筆同批次假資料。

新增一個專用假商品／規格，透過原quote/create、明確模擬管理員收款、delivered產生60,000返饋；假商品完成後隱藏。所有原商品規格庫存及原銀行設定指紋不變。建立前一批次30,000已匯款示例（稅3000、健保633、手續費15、模擬實匯26352），以及本批次20,000明確失敗示例（稅0、健保422、全額退回20000）。沒有真銀行交易。

雲端SQL驗證：相同request key回原ID、已有有效申請時55000拒絕新增、明確失敗後可重新試算10000且net9985、本批次blocked=false。最後orders1、withdrawals2、可用餘額30000、提領保留0、financial checks0。新outbox全部blocked、next_retry_at=infinity，不發LINE／Email。

## Git／Preview

功能 commit `8ed87f0` 已推送 `codex/instructor-student-rewards`，未merge或push main。只走Git觸發Preview，未直接deploy/promote。Vercel已確認 `8ed87f0` 對應部署Ready，URL為 https://eclado-qsbrt5h0p-eclado-s-projects.vercel.app/ ，部署詳情 https://vercel.com/eclado-s-projects/eclado/7bopqYjLz6Uu29UV7AKwFPCDYTVr 。實際開啟可見TEST橫幅、銀行付款停用及test商品。後續已完成真實師資登入與CSV下載等UI驗收，詳見下節；未重設或取得密碼。

## 真實 Auth／PostgREST／serverless 驗收

使用者先登入test管理員、再登入test師資，沒有取得或重設密碼。在8ed87f0 Preview完成：

- 後台顯示20000失敗及30000已匯款的凍結稅費。另透過實際request RPC建立20001待匯款，後台批次合計20001−15−2000−422＝17564。
- 實際點擊CSV下載，serverless核權、service-only匯出及假銀行解密成功。下載一列；申請總額20001、fee15、tax2000、premium422、net17564，完整假帳號末四碼1111。檔案留在本機忽略目錄 `.playwright/private-backups/eclado-test-withdrawals-20261019.csv`，權限600，不納入Git。
- 管理員UI領取處理成功，實匯表單預設17564且顯示各項扣款；沒有提交已匯款。以UI確認未付款並退回，該批次待處理合計歸0。
- 師資真實登入讀到30000；輸入15禁止申請，20000試算所得稅0／健保422／net19563，全額帶入30000試算net26352，輸入10000試算net9985。
- 師資透過確認視窗實際申請10000，成功後可用20000、hold10000、歷史net9985，同批次輸入與申請停用。
- 驗收完成後透過原manage RPC將這筆假申請確認未付款並全額退回，保留歷史不刪單。最終balance30000、hold0、withdrawals4、exports1、financial checks0、sendable notices0。沒有真銀行交易或外部訊息。

### 驗收發現與修正

8ed87f0師資送出申請後，下方提領面板已更新、上方總覽仍保留舊餘額。新增成功後通知父層重新讀總覽／帳本；同身分重整時保留面板實例，避免重整清掉未確定結果的重送鍵。切換身分仍清除舊報表。新增測試直接確認部分提領後上方可用20000及hold10000，桌面／手機全54項與正式建置通過。修正後的新Preview已Ready並完成下述同步重驗；正式環境未改。

修正已提交並推送 `eac8b3d`，Vercel部署 `Bo5LX3aGRHYyqUn7h4iqdkRxxzdZ` 已確認Ready，commit相符。修正版單次網址：https://eclado-dhp5l8005-eclado-s-projects.vercel.app/ 。後續固定使用分支網址 https://eclado-git-codex-instructor-student-rewards-eclado-s-projects.vercel.app/ ，以避免每次部署切換origin而需要重新登入。新版真實師資登入後完成同步重驗：實際申請10000（ID `4f05eef9-fe84-438f-993c-3971aeacc639`，net9985），未手動重新整理，上方立即顯示可用20000及提領處理中10000，下方面板一致，同批次再次申請停用。其後以原manage RPC領取並確認未付款、全額退回，保留完整歷史。最終balance30000、hold0、withdrawals5、exports1、financial checks0、sendable notices0。第二步test／Preview驗收完成；尚未合併main或變更正式環境。
