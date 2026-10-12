# 階段 2A｜一般／代客訂單返饋快照

2026-10-12，本機實作及隔離驗證；尚未正式安裝，不啟用學生價格，不包含 2B Ledger／錢包／入帳事件。

## 本次確認的規則

- 只計實際購買商品，排除 `line_type=gift`／`is_gift`、運費與非商品折扣調整。
- 後端學生價格開關 OFF 時，一般及代客 MANUAL／AUTO 均不建立返饋快照。
- 一般／AUTO 基準是活動前學生單價；MANUAL 是管理員指定的商品單價。舊代客請求缺少模式仍依 1C 規則視為 MANUAL。
- 逐項 `max(0, 基準單價 - 師資比較單價) × qty`；贈品／活動／優惠券／購物金不增加或減少返饋基準。
- 師資比較倍率沿用 `resolve_product_price_multiplier`，商品個別 → 有效全域值 → 0.70；固定專業價／規格與 SQL round 保留。比較核心不修正既有師資售價回退差異。

## 修改及儲存方式

`supabase-student-reward-snapshots.sql` 新增：

- `student_reward_snapshots`：一訂單一列，保存不可變的學生／老師／binding UUID、類型／倍率／設定版本／來源、每項規格／數量／AUTO或MANUAL／學生計算單價／實際基準單價／比較單價及倍率／逐項及總返饋。
- `capture_student_reward_context(uuid,jsonb,text)`：在權威報價前捕捉上下文。開關 row share lock 保持 OFF／ON 穩定；先按 UUID 排序鎖 Auth 父列（KEY SHARE），再沿用 1B 排序的 profile 鎖序，鎖定既有關係及設定，避免 Auth DELETE→profile CASCADE 與建單→orders FK 檢查倒置。遇到初讀與鎖定後關係不同即要求重試。
- 商品／規格的價格比較資料由一個 MVCC statement 捕捉；不另外鎖商品價格，以免倒置既有庫存 variant／stock mirror 鎖序。普通／AUTO 的實際權威售價須吻合捕捉的學生單價，否則整筆建單回滾。比較價固定於此報價前的捕捉時点，不在後续狀態更新重算。
- `calculate_student_reward_line(numeric,numeric,integer)`：共用整數計算及非負截斷。
- `persist_student_reward_snapshot(text,jsonb)`：從已建立訂單取 canonical 商品單價，不接受前端返饋值；核對數量、身份及 AUTO 價格，寫入私有快照。
- `reject_student_reward_snapshot_changes()`：拒絕更新／刪除快照。

只 patch 兩個原有函式：`create_order_with_pricing_discount_v2` 與 `create_assisted_order`。所有普通 8／9／12／13／14 參數 overload 都經原有 creator；snapshot 與原有建單／保留共用交易。後續外層贈品／購物金／確認報價失败，也会一起回滾。代客 recovery 直接回原訂單，沒有重算／重寫快照。

不修改 1C migration、報價算式、原活動／券／贈品／購物金／庫存／付款函式及 trigger；不新增前端頁面或公開 RPC，不將返饋資料放入 `orders.items`、`pricing_snapshot` 或 quote/create 回應。

快照表 RLS 無 policy，撤銷 PUBLIC／anon／authenticated／service_role 的直接存取；四 helper 同樣無客戶端／service_role EXECUTE。只有既有 SECURITY DEFINER creator 的 owner 可在交易內呼叫。此階段不開放老師／管理員查詢，後續階段依權限提供限定欄位入口。

UUID 不參照可被刪除的會員／商品；不複製姓名、Email、電話或地址。沒有 orders FK，避免改變既有訂單刪除流程或連鎖刪除快照；既有訂單若刪除，快照仍保留 order_id，後續對帳需識別來源訂單缺失。

## 隔離驗證

使用現有 1C 真實 SQL 測試情境建立 fixture，新增 2A 檢查；1C 測試只抽出可重用情境，原斷言保留。

- PGlite 六檔批次：7 通過／0 跳過；後續新增舊 overload／Auth FK 案例後，2A 單檔再通過。包含角色／資格回歸、學生類型／規格／round、活動／券／贈品／購物金、AUTO／MANUAL／舊請求、OFF、不可變、RLS／ACL、換綁與設定異動歷史不變、快照失敗完整回滾。
- PostgreSQL 17.6：最新 2A 整合檔 1 通過／0 跳過，多項斷言。獨立買家／管理員 backend：類型／解除關係／OFF／老師及學生 Auth DELETE 確實 lock wait，原上下文訂單及快照提交後異動才能繼續；Auth DELETE 再依原代客保護拒絕且回滾。建單中調價拒絕且回滾；代客同 request-key 同時請求只有一訂單／一快照；deadlocks=0。所有 2A 情境已加入 Auth→profile CASCADE／orders SET NULL FK。
- 實際重現 Auth CASCADE／orders SET NULL 及下述原代客保護衝突；沒有在正式環境重現。
- Playwright `student-pricing.spec.ts`＋`assisted-orders.spec.ts`，chromium＋mobile-chrome：52 通過，mock 回歸，不宣稱真實 Supabase／金流整合。
- Build 使用 loopback mock 商品目錄：456 模組、1 mock 商品／8 文章，通過；既有大 chunk 警告保留，未讀正式 DB、未部署。
- JS `node --check`／diff 空白檢查通過；專案無 Lint script。
- 初期測試誤用代客訪客歸戶，被原保護拒絕；已改成真正允許的普通訪客訂單歸戶，並斷言代客保護仍存在。後續 Auth FK 重現確認這是既有衝突，沒有修改該保護。

## 已知衝突及使用者決策

`supabase-full-setup.sql:204`：orders.user_id → auth.users ON DELETE SET NULL。`supabase-assisted-orders.sql:69` 的 `protect_assisted_order()` 拒絕任何 user_id 變更。`api/admin-delete-member.js:136` 刪除 Auth 帳號，因此擁有代客訂單的會員刪除會被拒絕並回滾。

使用者確認：**獨立列管此既有刪除衝突，2A 保留原流程驗收**。本階段不放寬代客訂單保護，不修改會員刪除 API。快照沒有新增阻擋會員刪除的 FK；成功刪除與既有拒絕回滾兩路均測試歷史保存。

## 剩餘限制／正式安裝前置

1. 此階段達到本機 2A 驗收條件，使用者已接受本機驗收；沒有建立待入帳 Ledger、帳戶餘額或發放返饋。
2. PostgreSQL fixture 覆蓋所列排程，不宣稱窮盡所有死鎖／交易隔離組合；1C fixture 的追加出貨群組仍是 stub。真正 Auth／PostgREST、完整正式 Schema／權限整合須在正式安裝前另核對。
3. 未新增普通訂單 request-key：同一訂單不能重寫快照，但兩個成功普通建單請求仍可產生兩筆原有訂單。未改原同步提交防重或付款恢復；2B 仍須設計入帳事件冪等。
4. 若比較價 NULL／無效，拒絕整筆建單，不默默發 0 或漏快照；正式需核對商品及全域設定，尤其既有售價回退差異。
5. 安裝前保存兩個待 patch creator 的完整原定義／ACL、表／Trigger／其他函式指紋，核對 1B／1C Schema及來源 marker；獨立批准後再執行 SQL、唯讀 verify、確認學生價 OFF及非目標基線未變。此檔不授權正式操作。
6. 回復需另行批准，優先維持 OFF；恢復兩個 creator 原定義／ACL，保留快照與 UUID 歷史，不刪除快照或重跑舊全專案 setup。
7. 後續網站部署僅使用使用者指定的 Git 自動部署；本階段未 commit／push／部署／合併 main，未連正式 DB。

## Git 提交授權（2026-10-12）

使用者批准先將已驗收的 2A 五檔獨立提交，再提交 2B 十三檔，一起 push 至 `codex/instructor-student-rewards`。正式 DB 安裝及學生價格啟用仍未授權；部署紀錄及 `.claude/launch.json` 不納入。實際 commit hash／push 結果記於外部「統一開發.md」。
