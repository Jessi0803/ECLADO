# 會員購物車正式部署｜2026-11-18

已完成正式資料庫遷移、前端部署與真實會員購物車驗證，未實作未結帳提醒。

## 部署來源與正式版本

- 基底為當時正式部署的 `bd59dfb039c0b38384231aca21b0aad09f081419`，在獨立暫存 clone 只帶入購物車程式、遷移與測試，共 14 個檔案；原工作區分支及其他未提交修改全部保留。
- 正式提交：`953b5f875c6524306cc757d6ca77065a054b7373`，已推送遠端 main，經既有 GitHub → Vercel 流程部署。
- Deployment：`dpl_6hJZVWyfkrXuhxneFj23V1YcQLuB`，READY／production。
- 正式網域：[ecladotaiwan.com](https://ecladotaiwan.com)，同時確認 www alias 已切換。
- 部署網址：[eclado-nrdxckz67](https://eclado-nrdxckz67-eclado-s-projects.vercel.app)。

## 正式資料庫

- 專案 `ilvdvlkdpntwmaijncaz`，main／PRODUCTION 的登入 SQL Editor。
- 遷移前購物車兩表及 RPC 均不存在。執行 `supabase-member-carts.sql` 後顯示 `Success. No rows returned`。
- SQL SHA-256：`d3c86f9725b69f4a5993df4c76bf77646274bfda37c4b29bfe8a42502066bffb`。
- `prosrc` MD5 與本機原始函式一致：`4566ae1bcb27349500be7013a9aa23f8`。
- 兩表 RLS、authenticated RPC、anon 禁止執行、客戶端禁止直接讀寫及程式校驗等 9 項全部通過。
- 其他 public 函式（定義及 ACL）遷移前後指紋相同：`395dfdfcf206cec6f45970e272c81763`。未變更付款、庫存或會員角色函式。

## 驗證結果

- 隔離正式來源：11 項單元／資料庫測試與 29 項桌面／手機瀏覽器測試通過；1 項為既有的僅手機測試，在桌面專案按條件略過。暫存 clone 共用 node_modules 時有本機 Vite 字型檔路徑警告，未改動正式設定；正式部署完成，正式頁面使用發布資產。
- 正式 Supabase 使用兩個本次建立的 consumer 測試會員，7 項真實 API 檢查通過：重試去重、合併取大值、數量驗證、購買數量只扣一次、會員隔離、匿名拒絕及資料表直接存取拒絕。
- 正式網站未攔截或模擬購物車後端，兩個獨立瀏覽器工作階段分別以桌面與手機尺寸驗證訪客合併、全新裝置還原、跨裝置改量、重新整理保留、離線後重連重試及移除持久化。
- 另驗證另一會員購物車為空、登出不外露會員商品、同一頁切換帳號不混車；背景更新時結帳未送出姓名及原始輸入節點維持不變。
- 正式頁面瀏覽器錯誤 0；上述正式瀏覽器檢查共 10 項通過。
- `/`、`/shop`、`/cart`、`/checkout`、`/privacy`、`/payment-result`、`/admin`、`/courses` 均 HTTP 200。
- 未建立訂單或付款；兩個測試會員已經刪除，其測試購物車與操作紀錄由外鍵級聯清除。本機暫存測試 session 檔也已刪除。
- 本次為桌面與手機尺寸自動化瀏覽器驗證，未使用實體 iPhone Safari 或 LINE 原生選檔器。

完整去敏證據：[verification.json](evidence/member-cart-production-20261118/verification.json)。另附桌面及手機購物車畫面；不含正式會員資料或憑證。

## 回復準備（未執行）

先前正式版本為 `dpl_EQezQUP39bxUzedaQ1319JgGzSoC`／[eclado-bqpm3gf9u](https://eclado-bqpm3gf9u-eclado-s-projects.vercel.app)。如需回退，可切回該版本；不要刪除購物車表或去重帳本，以保留會員資料與離線重試紀錄。若要重新由 main 發布，需先以獨立提交回退購物車程式。
