# 自動活動適用對象：正式資料庫部署驗證

日期：2026-10-17（Asia/Taipei）。使用者明確授權正式資料庫執行及測試。

環境：Supabase 專案 `ilvdvlkdpntwmaijncaz`，`main / PRODUCTION`。透過已登入的 SQL Editor 操作。

## 執行結果

`supabase-automatic-promotion-audience.sql` 已執行成功並提交。新欄位 `audience_roles`、`allow_guest`、內部資格函式、活動儲存 wrapper 及六條計價路徑均已安裝。

既有 12 筆活動在排除新增欄位後的資料 MD5 維持 `1c3d9c7ebb37741c9e30b91137a30226`，含五種會員身分及訪客的預設值均符合原有行為。

原始 7 個函式（含 ACL）及原活動設定已備份至本機 `/private/tmp/eclado-automatic-promotion-audience-before-20261017.csv`。另已準備 `/private/tmp/eclado-automatic-promotion-audience-rollback-20261017.sql`；尚未執行回復。

## 正式資料庫功能測試

完整執行 `supabase-automatic-promotion-audience-production-test.sql`，結果 `PASS`。

- 四種活動：百分比折扣、固定金額折抵、滿額贈、滿件贈。
- 五種會員身分的資格判斷。
- 前台正式報價函式：符合資格的會員取得折扣／贈品，未開放訪客時不套用。
- 代客報價：使用顧客身分，管理員登入不能讓訪客取得會員專屬活動。
- 會員身分多選、僅訪客、舊版客戶端省略對象欄位，以及空白對象拒絕。
- 測試使用 PL/pgSQL 子交易，以指定例外回滾所有測試活動、範圍、稽核寫入及暫時設定。
- 回滾後仍為 12 筆活動；原活動資料一致、測試活動零筆、商品／贈品庫存及贈品保留數量均未變。

測試沒有建立訂單或執行付款。前台會員報價以不存在的合成會員 ID 驗證一般會員 fallback，避免觸發真實專業會員的舊訂單合併出貨相容流程；其餘五種身分透過實際內部代客引擎與資格函式驗證，未修改真實會員。

## 原有邏輯與權限保留

執行 `automatic-promotion-audience-production-logic-verify-20261017.sql`，六筆結果的 `original_logic_preserved` 與 `original_permissions_preserved` 全部為 `true`。方法為移除這次新增的資格條件後，將函式定義 MD5 與部署前備份比對。

因此現有會員價格、學生價格及出貨／運費修正均保留原始函式內容。私有資格函式及原始活動儲存函式無匿名／一般登入者執行權限；公開儲存入口允許登入者呼叫，再由 `promotions.manage` 驗證管理權限。

## 尚未執行

前端尚未部署；此紀錄僅確認正式資料庫已完成更新及功能驗證。程式分支為 `codex/automatic-promotion-audience`。
