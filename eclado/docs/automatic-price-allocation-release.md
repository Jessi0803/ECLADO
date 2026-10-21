# 自動活動分配：正式發布操作順序

準備日期：2026-10-21。test 驗收見 [第三階段紀錄](automatic-price-allocation-stage3.md)。本文件是待執行流程，並非正式已部署證明。

## 發布前提

- 新版 SQL 預設關閉；先安裝、驗證，再發布程式，最後啟用。
- 推送 main 可能觸發 Vercel 正式部署，必須納入發布時間安排。付款 API push 事件只跑檢查，不會自動部署；依使用者決定，付款主機沿用現有直接管理流程，不執行 GitHub 部署 workflow。
- 不重跑全庫初始化或過期的計價 SQL；增量安裝遇到來源格式／權威版本不符即停止，先比對差異。
- 正式活動配置可能比合成測試複雜；上線前需檢查重疊範圍及代表購物車，確認沒有超過20000搜尋節點或128格界線。test 的22.88ms不是正式效能保證。

## 執行順序與通過條件

1. **唯讀盤點**：記錄正式前端 revision、付款 API 現行檔案雜湊／程序狀態、資料庫計價函式定義與 ACL；盤點生效活動、優惠券與重疊商品。對照本次 migration 前置條件，確認是否有其他開發同步更新。
2. **正式備份**：備份將修改的函式、constraints、設定及付款 API `server.js`、`assisted-orders.js`。備份放私有位置，記錄雜湊與回復位置；不提交環境設定或金鑰。
3. **資料庫安裝**：執行完整 `supabase-automatic-price-allocation.sql`。若正式原本已有該功能，先確認開關原狀態；重跑不會自動把既有 enabled=true 改回 false。首次發布需維持 false。
4. **安裝驗證**：執行 `supabase-automatic-price-allocation-verify.sql`，10項皆 true，另確認開關 false。比對既有函式擁有者／ACL與預期差異。正式驗收腳本需先依正式 schema 與當下資料檢查，使用完整交易回滾；不要直接執行 test UI seed／cleanup。
5. **程式發布**：推送已驗證的 main revision、確認前端部署 Ready；以現有付款主機管理方式更新兩個 API 檔案，先備份、語法檢查，再依現有程序重啟及健康檢查。保留既有環境設定。確認舊訂單／訪客／代客查詢正常，白名單只回傳優惠名稱、類型與金額。
6. **受控啟用**：以上皆通過後，由資料庫部署角色執行以下 SQL。一般會員與管理員前端均無切換權限。

```sql
begin;
set local lock_timeout = '5s';
set local statement_timeout = '10s';
update public.automatic_price_allocation_settings
set enabled = true where singleton;
select public.automatic_price_allocation_enabled();
commit;
```

7. **啟用後確認**：以代表性商品核對無重疊可合併、同件擇優、買贈重複／單次與門檻、優惠券三模式、會員／訪客／代客、運費與錢包金額。查看錯誤與計價耗時；任何真實訂單或銀行付款須另外安排具體測試資料與操作。

## 功能回復

遇到新版報價異常，先停止繼續啟用，切回舊計價供後續報價使用：

```sql
update public.automatic_price_allocation_settings
set enabled = false where singleton;
```

重新取得報價再下單；保留已建立訂單與分配快照，不用新舊引擎重算歷史訂單。付款 API 若需回復，使用本次發布前備份並核對健康狀態。不得把全庫還原或刪除帳務作為一般功能回滾。

各步完成時記錄時間、revision／檔案雜湊、驗收結果與開關狀態；未執行的步驟保持標記為待辦。
