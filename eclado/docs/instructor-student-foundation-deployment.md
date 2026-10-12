# 階段 1B：師生設定與綁定部署準備

本階段只新增設定與查詢，不變更會員角色、商品／規格價格、報價、建單、付款、購物金或訂單。學生價仍未啟用。未獲獨立批准前不得在正式環境執行下列安裝。

## 前置核對

正式專案目前沒有完整專案 Migration 歷史，請以實際 Metadata 核對：

- `profiles(id uuid, role text, name text)`，Auth 刪除會級聯刪除 profile。
- `admin_users`、`backoffice_roles`、`backoffice_role_permissions` 與既有權限資料。
- `has_backoffice_permission(text)`、`is_eclado_admin()`、`auth.uid()`。
- 名為 `backoffice_role_permissions_permission_check` 的 CHECK 白名單。
- 四張新的 1B 表若已存在，核對其欄位／約束，不能將 `IF NOT EXISTS` 當作任意版本升級能力。
- 保留現行價格、建單、付款 RPC 的完整定義／ACL、訂單及購物金 Trigger 基線；確認 S1 兩付款 RPC 仍只開放服務端。

## 安裝與驗證

1. 完成隔離資料庫與 UI 驗收，核對下列前置條件；另取得正式套用批准。
2. 在單一交易執行 `supabase-instructor-student-foundation.sql`；只擴充權限白名單，不覆蓋既有項目。
3. 執行 `supabase-instructor-student-foundation-verify.sql`：布林檢查均須為 true。
4. 再次比對既有價格／付款函式指紋與 ACL，確認未變。不得用正式建單或付款 RPC 作測試。
5. 前端部署需另行批准；Migration 與前端未安裝完整前，新面板會顯示載入錯誤，不會改動售價。

同版本重跑會保留全域折數、老師類型、關係及稽核；不能重跑舊版全專案初始化腳本取代本安裝。

## 權限與資料保存

- 新能力 `instructor_students.manage` 初始授予既有 admin、super_admin；RPC 還須驗證實際管理員身份，商品小編不能因單獨擁有此權限越權。
- 管理員讀取另需 `members.read` 或新管理權限；普通會員與老師只用本人限定欄位 RPC。
- 客戶端沒有新表直接讀寫權限，內部 helper 沒有客戶端 EXECUTE。
- 老師初始類型為未設定；有學生時清空類型仍保留關係，但資格暫停；恢復類型或角色後查詢重新判定。
- 初次綁定要求 pro/instructor；換綁會驗證新老師、目前關係及版本。角色變更不修改關係。
- UUID-only 關係及稽核無級聯外鍵。profile 刪除 Trigger 結束有效綁定，保留識別／操作歷史，不複製姓名、電話、Email、地址。
- Auth 刪除使用服務端時可能沒有原管理員 JWT，刪除連動紀錄顯示系統；原刪除 API 自己的管理員稽核維持不變。不得捏造操作者。

## 回復方案

優先回復前端、撤銷新管理權限及公開 1B RPC 的客戶端 EXECUTE，以停止新操作；保留設定、綁定、稽核及刪除清理 Trigger，避免資料流失或留下未結束關係。這不是解除歷史資料的業務回復。

若需完全移除 DB 功能，應另外規劃／批准：先匯出並驗證歷史，再檢查後續階段是否已依賴這些表／函式；不能直接 DROP 或刪除歷史。任何正式回復仍需獨立批准，不自動執行。

## 測試限制

隔離 PGlite 驗證實際 RPC／RLS／ACL、唯一約束、交易回滾及 Auth 刪除；不作多連線證明。2026-10-12 已另在本機隔離 PostgreSQL 17.6 執行多連線測試，詳見下列可重現指令及統一開發文件。所有交易測試禁止使用正式資料庫。

### 多連線測試重現

只在獨立暫存目錄安裝測試工具，不修改應用程式 package.json／lockfile：

```sh
npm install --prefix /private/tmp/eclado-1b-postgres-tools embedded-postgres@17.6.0-beta.15 pg@8 --no-audit --no-fund
EMBEDDED_POSTGRES_MODULE=/private/tmp/eclado-1b-postgres-tools/node_modules/embedded-postgres/dist/index.js node --test tests/integration/instructor-student-postgres-concurrency.test.cjs
```

測試自行建立新的暫存 cluster，只監聽 127.0.0.1；不接受 DATABASE_URL、不載入 .env。每次有獨立資料目錄及連接埠，結束關閉伺服器並移除其資料目錄。需允許本機監聽連接埠。

兩名管理員使用不同 PostgreSQL backend；控制交易持鎖，透過 pg_blocking_pids 確認競爭請求已阻塞後才提交。五輪覆蓋首次綁定、多人換綁、換綁／解除（兩種先後）、刪除學生／原老師／新老師與換綁（兩種先後）、刪除老師與首次綁定（兩種先後），另有 40 組同時起跑綁定／換綁。驗證唯一性、無指向已刪除 profile 的有效關係、完整建立／結束稽核、SQLSTATE、deadlocks 統計及伺服器日誌。

此結果涵蓋已測排程及預設 READ COMMITTED，不能保證任意外部批次／未來函式／不同隔離級別都不會死鎖。正式仍須人工 UI 驗收及 Metadata 核對，不得略過部署批准。

### 正式套用前檢查與回復確認

- 確認安裝前置 SQL 物件及其實際欄位／型別／CHECK 定義，不重跑舊初始化腳本。
- 保存四張新表若已存在的 Schema／ACL／資料基線；若形狀不符則停止，不能依靠 IF NOT EXISTS 修補。
- 新 Migration 建立四表 RLS 並撤銷 PUBLIC／anon／authenticated 直接讀寫；無放寬讀取政策。公開 RPC 雖授權 authenticated，仍做本人或管理員能力驗證；四個內部函式均不授權客戶端。全部 SECURITY DEFINER 使用空 search_path。
- 驗證 SQL 檢查四表、有效唯一索引、Trigger、管理能力及 12 個函式簽章的有效 EXECUTE；所有布林必須 true。另核對 PUBLIC grant、函式安全屬性及原價格／付款指紋，不能以「安裝成功」替代。
- 安裝交易失敗應整筆回滾；成功後撤回方案以停用新 UI／權限／公開 RPC 為主，保留歷史、設定與刪除清理。新權限撤銷不會自動隱藏管理員唯讀查詢；若要完全停止 client 查詢，一併撤銷八個公開 RPC 的 authenticated EXECUTE。
- 新表新增的 BEFORE DELETE Trigger 會在原會員刪除交易內執行；若清理失敗，刪除也會失敗並回滾。這是本階段唯一新增的既有資料表連動，不修改刪除 API 或原訂單 Trigger。
