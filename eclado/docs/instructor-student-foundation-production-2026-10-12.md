# 1B 正式資料庫套用紀錄｜2026-10-12

## 授權與範圍

使用者先要求「開始正式套用」，在正式前置核對與 SQL 準備完成後，再回覆「可以」確認執行。僅套用 1B 資料與管理功能；未部署前端、未啟用學生價格、未開始 1C。

- 專案：`ilvdvlkdpntwmaijncaz`；Dashboard `main`；PostgreSQL 17.6。
- 使用登入中的 Supabase SQL Editor 執行，不讀取或保存連線密碼／金鑰。
- 安裝：`supabase-instructor-student-foundation.sql`，SHA-256：`1a1617b924ce679ccdc0a44a9832e578a8e87c77ab1fa163af6d64ec3df92eb3`。
- 安裝前正式四表不存在，新 12 個函式也不存在；Schema、角色、權限 CHECK、Auth profile CASCADE 與三個相依函式均已唯讀確認。
- 安裝為單一 BEGIN／COMMIT 交易；SQL Editor 顯示 `Success. No rows returned`。

## 套用後唯讀驗證

使用 `supabase-instructor-student-foundation-verify.sql`（BEGIN READ ONLY／ROLLBACK），再以唯讀查詢核對指紋／函式屬性及初始化資料。

| 項目 | 結果 |
|---|---|
| 四表存在、單一有效學生唯一索引 | 全部 true |
| 四表 RLS／客戶端直接存取封閉 | true；沒有放寬的 policy |
| 刪除清理與稽核不可變 Trigger | 啟用 |
| admin／super_admin 新管理能力 | 已建立 |
| 八公開 RPC／四內部函式有效 EXECUTE | 12 簽章 anon 均拒絕；authenticated 僅八公開允許 |
| 新函式 security definer 與空 search_path | 12 個皆符合預期；稽核拒絕 Trigger 為 invoker，其餘為 definer |
| 全域折數 | student_1=0.90，student_2=0.95，version=0 |
| 老師設定／關係／稽核資料 | 均 0 筆，未建立測試資料 |
| 既有 187 函式定義與 ACL | 指紋前後一致 |
| 既有 Trigger／既有角色權限資料 | 排除新增項目後，指紋前後一致 |
| S1 兩付款 RPC | anon／authenticated 拒絕，service_role 允許；本體未變 |

## 保護基線

| 基線 | 套用前後相同 MD5 |
|---|---|
| 187 個 public 既有函式完整定義＋ACL | `0e13f3e04f43559ef1f956397e229303` |
| 既有非內部 Trigger 定義＋啟用狀態 | `71f82d6e2185d65ead963257d154e94b` |
| 原 backoffice_role_permissions（排除新能力） | `f457e4358a58911f565e32cd63cc7592` |
| begin_order_payment_retry(text) 完整定義 | `fa7d19312d703e75ea947d9b382a7543` |
| claim_order_payment(text,text) 完整定義 | `988815d333e5dd6b5f19283d4b56a8b5` |

未呼叫正式建單、付款、綁定、刪除會員或其他寫入型業務 RPC。驗證為 Metadata／ACL／初始化資料驗證，不代表正式 UI 或全部業務流程已完成驗收，也不是所有既有業務資料逐列比對。

## 後續與回復

前端尚未部署；學生價格與返饋功能尚未啟用。前端部署、commit／push 或 1C 須另依使用者指示。回復仍依部署文件，優先停用新管理能力／公開 RPC 與 UI，保留歷史及刪除清理；沒有執行回復。
