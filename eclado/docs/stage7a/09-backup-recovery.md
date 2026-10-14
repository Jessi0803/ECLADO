# 備份、失敗處理與安全回復計畫

此為7A規劃，**尚未執行正式備份／復原演練**。本次production-metadata.json只含Schema／權限，不是完整資料備份；2026-10-12三creator備份亦不能替代新金融資料備份。

## 備份範圍與完成驗證

1. 正式Schema／owner／ACL／索引／constraints／Trigger／SECDEF／search_path、public及必要Auth／Storage依賴；保留SQL執行hash／Git候選版本／API與workerrelease。僅讀Metadata沒有涵蓋完整managed Supabase內部schema。
2. 在另准範圍以可復原Supabase backup／pg_dump資料備份涵蓋orders/items、購物金、snapshot、返饋account／Ledger／receipt／reservation／exception、bankprofile／withdraw／calendar／events、noticeOutbox／attempt與run/finding。Auth／Storage物件及登入設定另核對；不能以public SQLdump宣稱Storage圖片已備份。
3. 銀行keyring使用獨立secret保管及加密備份，key ID／歷史鍵保留；DB只cipher，不把解密key混進Git／SQLdump／測試log。rotation保持舊key到所有歷史cipher可解密且完成批准的retention策略，不隨意刪舊key。
4. Backup檔案hash／size、storage可讀、完成時間／覆蓋點；在**獨立環境**restore並比對表數、FK／ACL／index、financial sum(delta)與四種after、hold及快照總額、加密歷史解密、通知版本／lease恢復。沒有成功restore演練不能PASS備份可用。

## Migration與應用程式失敗

- 每個SQL單transaction。確定失敗即ROLLBACK；保存SQLSTATE／metadata，不嘗試重放full setup。
- HTTP／Editor timeout結果不明，先read-only確認存在／hash／ACL／trigger與DB活動，不能直接推定沒commit。部分階段已commit時按實際依賴圖處理，不用另一套SQL任意覆蓋。
- 安裝順序或source marker不符，停止並重新規劃；沒有完整schema_migrations歷史，更需要當下指紋。
- 先停**新**學生價／wallet／withdraw／補發入口與worker，保持已保留購物／提領及已收款訂單的相容結算能力。現只有學生價OFF，尚無獨立wallet／withdraw停止開關；撤新create／request EXECUTE／發相容UI的具體方案須另准、隔離演練，不在本次執行。
- 應用回復走Git已批准流程；不能直接Vercel rollback。未與main同步的feature不能直接作production回復來源。

## 已有金融義務後的回復底線

- 不DROP／清空Ledger、snapshot、receipt、reservation、withdraw、cipher／keyring、Outbox、attempt、finding。
- 新wallet訂單已有payment_amount＋兩折抵，不能把Payment API降回只理解單錢包的版本；原銀行回呼可能晚到，保留provider binding／cycle／有效證據及异常處理。
- 已有提領pending／processing／unknown，不自動取消或退回，已匯款unknown先查銀行。結果不明處理者失去權限沒有自動移交規則，需獨立決策。
- 刪戶後closed負債與UUID歷史保留，不能為恢復畫面建立假帳戶或修改餘額。
- 事件Trigger停止期間的漏通知／後續重寄須批准來源／版本策略；成功防重key過窗口不能冒稱safe原key重送。

建議首次發布維護窗口及監測由03／10門檻決定。回復策略已提出，但正式未結訂單／資料量／secretbackup未檢查，故目前不宣稱可一鍵無損rollback。
