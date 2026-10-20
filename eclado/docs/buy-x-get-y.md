# 買 X 送 Y（最低價免費）

沿用同一套活動管理，新增 `benefit_type=buy_x_get_y`。顧客自行選滿 X＋Y 件活動商品，最低價 Y 件免費。例：買3送1，4件送1件；重複模式8件送最低價2件。最低價只有一件時，下一件取第二低價。同規格多件依件數計算，同一件不能再次被選為免費商品。

共用活動名稱／說明、期間、啟用狀態、商品範圍、會員身分及訪客設定、自動／優惠券專用、`repeat_mode=once|repeat`。不新增每筆贈送上限。新增 `buy_quantity` 儲存 X，沿用 `gift_quantity` 儲存 Y；後端計算 `threshold_value=X+Y`，固定件數門檻。X、Y必須是正整數，合計符合資料庫整數範圍；既有購物車數量限制維持。

## 計價與庫存

- 自動活動與既有自動價格折扣擇優，只套用一個；滿額／滿件指定贈品仍走既有流程。
- 優惠券專用可與其他優惠依方案順序計算；新類型屬價格折扣，只有 `allow_all` 允許疊自動買X送Y，`allow_auto_gifts` 不允許。
- 最低價依伺服器解析的會員／學生價格計算，優惠券中的後續活動依剩餘單價計算。先前已免費的件數不再計入後續買X送Y的門檻或免費候選。
- 同價以商品、規格及原始列順序穩定排序。依每列件數批次分配，不展開每一件成資料庫列。
- 優惠券按比例折扣可能留下小數單價；免費折抵合計四捨五入至整數元、不超過適用商品剩餘金額的整數部分，差額分配回仍付費的商品列。快照保留 `rounding_adjustment`，後續活動的剩餘總額維持一致。
- 訂單商品仍記錄原本單價／件數，優惠記在訂單層級 `discount` 與 `order_adjustments`；`qualification_snapshot.buy_x_get_y` 保留 X、Y、達標方式、實際免費件數與商品明細。不是額外新增贈品列。
- 所有選購件數（包含免費件）使用一般庫存，不用贈品庫存／贈品保留。原有付款時點、庫存扣回、購物金、返饋金及專業會員最低金額規則維持。
- 雲端 test 驗收發現既有代客訂單以 9 位數限制商品 ID，但合法商品 ID 實際為 10 位數。本增量同步修正三個既有代客函式的驗證，限定正整數且不超過 2147483647；商品／規格對應與權限檢查維持。

## 安裝與回復

1. 在目標環境完成備份與目前函式版本核對。依既有流程先在 test 驗證。
2. 執行 `supabase-buy-x-get-y.sql`；需在目前優惠券／贈品、運費、代客訂單、會員／學生價及 `supabase-automatic-promotion-audience.sql` 之後執行，也支援既有返饋金 checkout 已安裝的狀態。不要重跑歷史完整引擎覆蓋正式邏輯。
3. 執行唯讀 `supabase-buy-x-get-y-verify.sql`，全部為 true，再發布對應後台程式。
4. 驗收後建立需要的活動。安裝 SQL 本身不會建立或啟用買X送Y活動。

SQL 單一交易、具 timeout；以明確來源錨點增補現有 private editor、storefront／assisted 計價與訂單優惠保存。未知函式形狀會整筆失敗，應檢查差異，不能改用舊完整引擎硬覆蓋。保留 audience wrapper、函式 owner／ACL、返饋金與付款 wrappers。可同版本重跑。

若需停用，先停用新活動並回復相容前端；保留新欄位、計價支援及歷史快照。已存在買X送Y訂單後，不直接刪除類型或還原整庫。

## 本機驗證

```
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node --test tests/integration/buy-x-get-y-db.test.cjs tests/integration/automatic-promotion-audience-db.test.cjs
npx playwright test tests/admin.spec.ts --project=chromium --project=mobile-chrome --workers=1 --grep '買 X 送 Y|活動管理可從一般商品贈品庫存'
npm run build
```

資料庫測試執行真實 SQL／訂單與庫存函式於隔離 PostgreSQL；瀏覽器測試使用模擬 API。這些不代表已在雲端 test／正式安裝 SQL，也不代表真銀行交易驗收。

2026-10-20 本機結果：隔離資料庫 3 個整合情境通過，包含既有 audience、學生價格、代客訂單、返饋金／付款生命週期回歸；桌面／手機共 6 個後台案例通過；完整 Vite＋SEO 建置通過。雲端驗收發現的 10 位數商品 ID 已補入本機真實代客下單與非法 ID 拒絕測試，重跑通過。

## 2026-10-20 雲端 test 安裝與驗收

使用者授權後，於 test 專案 `qqlgqasbmbicnmvnlqbr` 執行，未操作正式專案。

- 安裝前備份 public 全部 260 個函式定義／owner／ACL、相關 constraints 與基本筆數，逐一核對函式 MD5。備份保存在 Git 忽略的 `.playwright/private-backups/bogo-test-20261020/`，目錄 0700、檔案 0600。完整備份 JSON SHA256：`6bc89e4f97287eaae7d6ff5eeeb9a1807d68a42533e97fa441c12a9e52e79a1e`。這是函式與相關結構備份，不是全庫資料備份。
- test 尚未安裝活動適用對象層，先執行既有 `supabase-automatic-promotion-audience.sql`，再執行本次 `supabase-buy-x-get-y.sql`；不重建資料庫或假資料。代客舊驗證擋住 test 的合法商品 ID `1239098752`，已補正整數範圍驗證後同版本重跑增量 SQL 成功。
- 執行 [test 回滾驗收 SQL](buy-x-get-y-test-rollback.sql)：14 組情境、11 項結構／權限檢查全部通過。涵蓋混搭最低／第二低價、件數邊界、一次／重複、買2送2、範圍、會員／訪客、期間、折扣擇優、真實一般與代客訂單 RPC、快照、一般庫存、優惠券順序／疊加／整數金額，以及原本四種活動與無權限拒絕。
- 測試資料在 PL/pgSQL 子交易中回滾；回滾後對所有 public 資料表逐表計算資料雜湊，比對一致，原本 1 筆訂單保留，未保留測試訂單／活動，無銀行 API 呼叫。序號計數器可能因回滾測試產生正常跳號，不屬於逐表資料雜湊範圍。
- [雲端驗收證據](evidence/buy-x-get-y-test-20261020.json) 僅含通過結果與筆數；不含私有函式全文或付款憑證。SQL Editor：`https://supabase.com/dashboard/project/qqlgqasbmbicnmvnlqbr/sql/9e7beab8-a148-47a3-9976-c1dab1bccc86`。

截至此次驗收：正式資料庫未安裝本功能、正式前端未部署；本機 main 修改尚未 commit／push。雲端測試未進行銀行付款或真實登入前端端到端驗收。

## 2026-10-20 正式安裝與回滾驗收

使用者明確授權先安裝正式 SQL、測試通過後再 commit／push，並指定維持原有整筆訂單自動價格折扣擇優規則。

- 正式專案 `ilvdvlkdpntwmaijncaz` 的活動適用對象前置已存在，因此只執行本次 `supabase-buy-x-get-y.sql`，未重跑舊引擎或 test 的前置安裝。正式付款 API 與銀行設定未調整。
- 安裝前保存 public 264 個函式定義、owner／ACL、相關資料表 constraints 與筆數，逐一核對函式 MD5。私有備份位置：`.playwright/private-backups/bogo-production-20261020/`，目錄 0700、檔案 0600；完整 JSON SHA256：`90b6ca3234d74bf6d39a327afa129ad262db22f4e4011d4a6c98a47de480615a`。平台 Scheduled backups 最新顯示 2026-10-19 07:10:47 UTC（台北 15:10:47）；未按 Restore。本機備份僅涵蓋函式與相關結構，不是全庫資料備份。
- 安裝成功後執行 [正式回滾驗收 SQL](buy-x-get-y-production-rollback.sql)。使用暫存商品、活動與訪客訂單，未改動既有客戶／會員資料，不呼叫銀行或通知 worker；所有測試資料在子交易中回滾，外層交易亦回滾。
- 15 組功能情境、11 項結構／權限檢查全數通過，包含真實一般與代客訂單 RPC、庫存及優惠快照、優惠券、原本四種活動回歸。另驗證互不重疊商品的活動仍只取一個最優惠自動價格折扣，沒有實作商品層級多活動並用。
- 回滾前後所有 public 資料表資料雜湊一致；結束後另以唯讀交易核對：原有 97 筆訂單、12 個活動保留，買X送Y活動 0、測試商品 0、測試訂單 0。序號計數器可能跳號，未納入逐表資料雜湊。
- 安裝後逐一比對函式：只變更預期的 7 個函式，新增私有 `calculate_buy_x_get_y(uuid,jsonb)`；未刪除函式，所有既有 owner／ACL 與其餘函式全文雜湊均保持一致。
- [正式驗收證據](evidence/buy-x-get-y-production-20261020.json) 含通過結果、函式變更清單與 migration SHA256，不含私有函式全文或付款憑證。SQL Editor：`https://supabase.com/dashboard/project/ilvdvlkdpntwmaijncaz/sql/95479306-811a-4308-bf9d-d05ff4f6eb2a`。

此階段已完成正式 SQL 安裝與資料庫回滾驗收；前端隨本次 main 提交推送發布。沒有建立或啟用實際買X送Y活動，沒有進行真銀行交易。
