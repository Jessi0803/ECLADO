# 自動活動分配：正式資料庫安裝完成，維持關閉

2026-10-21。候選程式 `878f364`，正式專案 `ilvdvlkdpntwmaijncaz`。

## 實際操作與結果

1. 以備份中的定義 MD5、owner、ACL 對13個相關函式加入交易內前置斷言；任何不一致都中止。確認通過後，在同一交易執行完整 `supabase-automatic-price-allocation.sql`。首次安裝成功，預設 enabled=false。
2. 安裝10項檢查全部 true。函式由271增加至281，新增10個分配／相容私有函式；12個既有函式更新，與 test 預期範圍一致。所有既有函式的 owner、ACL 未變，新增函式均未授予 anon／authenticated 執行權。原始權威價格、付款與錢包 wrapper 定義未修改。
3. 執行 [正式報價回滾腳本](automatic-price-allocation-production-rollback.sql)，6組通過：不同商品合計折300、同件百分比擇優、8件重複贈最低與第二低價、8件單次只贈最低價、正式現行活動新舊金額一致、交易內版本與權威來源檢查。
4. 真實商城 RPC 使用一位現有 pro 身分及現有活動商品取得報價，沒有修改該會員或商品；原有「三盒折300元」在開關前後的小計、折抵、運費、合計相同。身分只在資料庫交易的 JWT context 中設定，不輸出會員識別或聯絡資料。
5. 測試只在未提交子交易內開啟新版，並用受控例外回滾，再外層 ROLLBACK。其他連線持續看到已提交的關閉狀態，沒有對正式流量啟用新版。未建立任何假商品／活動／訂單，未核銷、保留庫存、扣錢包、呼叫銀行或推進序列。
6. 回滾後另一次唯讀查詢確認：enabled=false、折抵不可變 trigger 啟用、全部活動及活動範圍與安裝前備份完全一致；當下訂單97、活動12、折抵17。付款 health 於台北15:00:58回傳 ok=true。

完整機器可讀結果：[安裝證據 JSON](evidence/automatic-allocation-production-install-20261021.json)。原始 CSV／SQL 稽核檔保存在前一步的 gitignored 私有備份目錄；備份與付款程式位置見 [盤點紀錄](automatic-price-allocation-production-preflight.md)。

## 驗證界線與後續

正式這一步驗證安裝、權限、純計算與現有活動的真實報價，沒有建立正式訂單或測銀行付款。完整建單、核銷、庫存與錢包回滾情境已在 test／隔離資料庫驗證，不將其宣稱為正式真交易驗收。未在正式執行任何 test seed／cleanup 腳本。

前端尚未 push，付款 API 尚未更新或重啟，新版尚未對正式流量啟用。下一步依 [發布流程](automatic-price-allocation-release.md) 發布程式並驗證舊規則與訂單查詢；所有入口就緒後才另行啟用新版。
