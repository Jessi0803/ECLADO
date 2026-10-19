# 正式增量 SQL 安裝候選｜2026-10-19

狀態：**已獲使用者明確批准，正式11檔已依序安裝並驗證；不重跑。** 本文件下方原執行前規劃保留供稽核；最新執行狀態見 `docs/evidence/reward-production-migration-execution-20261019.json`，發布門檻見 `reward-release-checklist-2026-10-19.md`。

此文件接續 `reward-production-readiness-2026-10-19.md` 的最後紀錄。付款API已按使用者決策透過主機管理更新，不再要求GitHub部署付款API；前端／serverless仍只走Git自動部署。

## 精確候選清單

正式已存在S1／1B／1C與購物金前置，僅核對，不重放。以下共11份：優惠券修補＋10份返饋增量。

| 次序 | 檔案 | SHA256前12碼（完整值見JSON證據） |
|---|---|---|
| 1 | `supabase-coupon-member-create-compat.sql` | `6456ec7359f6` |
| 2 | `supabase-student-reward-snapshots.sql` | `a561ac6d6d99` |
| 3 | `supabase-instructor-reward-ledger.sql` | `ea46aee7ef32` |
| 4 | `supabase-instructor-reward-queries.sql` | `7bef89e919ab` |
| 5 | `supabase-instructor-reward-checkout.sql` | `5eba6f84815c` |
| 6 | `supabase-instructor-reward-withdrawals.sql` | `83ffe95048bb` |
| 7 | `supabase-instructor-reward-notifications.sql` | `5fe6a7f3c1e4` |
| 8 | `supabase-instructor-reward-reconciliation.sql` | `c155a544b66b` |
| 9 | `supabase-instructor-reward-withdrawal-operations.sql` | `6841808d3943` |
| 10 | `supabase-instructor-reward-withdrawal-deductions.sql` | `6d2f5cbd3889` |
| 11 | `supabase-instructor-reward-withdrawal-partial.sql` | `41d9cc6fb251` |

`supabase-instructor-reward-nominal-batch-schedule.sql` 不列入：目前階段5主檔已包含名目10日規則、未建立年曆表。它是舊安裝的清理補丁，不應在扣款／自選提領之後重放。test baseline重建、會員／商品／mock資料SQL及活動對象原始Migration均不在正式清單。

## 本機實際證據

來源為2026-10-19台北15:21:50保存的正式唯讀catalog：53張表、208個函式，並載入constraints、indexes、RLS／policy、trigger與原有ACL。未匯入正式會員／訂單／銀行資料；少量測試設定來自既有測試底稿，不能當作正式設定內容證明。

- 隔離 PostgreSQL17.6：11份實際執行成功，10次verify通過（含扣款verify在自選提領後再驗證）。
- 原有208個函式owner／ACL保持一致；只有預期6個函式的定義變更：一般creator、代客creator、代客quote、payment defaults、retry、claim。
- 活動適用對象helper、活動儲存wrapper及定價相關7個函式保持原定義；另跑四種活動、五種角色、訪客、代客與舊客戶端儲存的真SQL報價測試通過。
- 一般／代客AUTO／MANUAL快照、delivered入帳、錢包支付與整筆退款的交易回滾smoke通過；假資料回滾後訂單0筆。
- 使用實際SQL角色authenticated直接讀Ledger遭42501拒絕。學生價仍OFF／version0。
- 最新扣款與自選提領兩個PostgreSQL整合測試2/2、0跳過；含不同連線申請競爭、重送、失敗退回及剩餘餘額購物，deadlocks=0。
- test mode Vite Build通過；既有chunk大小警告。node語法與git diff檢查通過。

早期重演失敗來自本機catalog還原格式（constraint trigger、單列設定、aclitem[]解析）及模擬註冊trigger缺少，已修正工具後完整重跑；不是正式SQL執行失敗。沒有修改產品Migration以繞過guard。

先前自製檢查將 `target_order.payment_amount` 限定只出現一次，但本次正式來源實際為2次；Migration要求至少存在且保留權威金額，不要求唯一。真正替換／執行及付款smoke已通過，沒有為了減少次數修改claim原定義。

執行方式：

```sh
REWARD_PREFLIGHT_CATALOG=/absolute/private/production-preflight-metadata-20261019.json \
EMBEDDED_POSTGRES_MODULE=/absolute/tools/node_modules/embedded-postgres/dist/index.js \
node scripts/reward-production-preflight.cjs

EMBEDDED_POSTGRES_MODULE=/absolute/tools/node_modules/embedded-postgres/dist/index.js \
node --test tests/integration/reward-withdrawal-deductions-db.test.cjs tests/integration/reward-withdrawal-partial-db.test.cjs
```

工具只建立loopback PostgreSQL，不讀.env或接受雲端連線字串。完整原始catalog仍在Git忽略的private-backups，禁止提交。對外證據只包含hash、函式簽章及通過狀態。

## 正式執行前置與操作順序（尚未執行）

1. 確認本候選hash、當下正式catalog與已保存來源一致；有新差異先停止。另核對當下學生價OFF、無返饋結構／未結返饋義務，保存原定義、ACL／CHECK／trigger。未讀正式未付款訂單內容，本次不宣稱義務盤點完成。
2. 確認備份可用性、保留期限、復原操作權限與維護窗口。平台15:10:47備份及付款API完整備份已有紀錄，但服務／全庫還原未實際演練；schema匯出不是交易資料備份，平台DB備份也不含Storage檔案。
3. 正式銀行專用keyring與備份、隔離worker／指定管理員Email／sender、受控功能入口仍須完成或明確決定暫緩開放。學生價OFF不等於關閉錢包與提領；缺key回503不能當作正式停用設計。
4. 取得使用者對此11檔清單及窗口的正式批准。避免新建單／重試與ALTER CHECK競爭，既有銀行回呼不得任意丟棄；實際短時停用方式尚未定案，不自行實作或停站。
5. 依序逐份完整執行，每份commit後verify，保存結果與新指紋。安裝期間先執行對應階段verify；最後執行最新operations／deductions／partial及S1驗證，不能重放舊SQL覆寫新wrapper。
6. 逾時或連線斷開先唯讀查marker及實際定義，不能盲目重跑。單檔失敗rollback後停止；跨檔不是單一總交易。
7. DB與所有依賴驗收完畢後，才另批merge main＋push發布網站，確認Production commit與環境；最後另批正式交易驗收及學生價啟用。本次不建立正式測試訂單／付款。

## 回復及未覆蓋

- 一旦形成返饋義務，不刪Ledger／snapshot／hold，不以舊付款API備份覆蓋相容服務；先停止新功能入口並保留結算能力，再做相容修正。
- 全庫restore會倒退備份後的既有電商交易，不能當日常功能回滾；實際復原窗口／新交易保全仍需演練。
- Auth users／JWT與註冊trigger是本機模擬，未覆蓋正式Supabase Auth、PostgREST、平台預設權限、正式資料量／鎖等待、真實銀行或LINE／Email投遞。
- 正式稅務身分／申報與合併給付方式仍依提領扣款文件由會計確認；本次只驗證已實作計算契約，不代表法律驗證。
- 舊GitHub付款部署Draft PR與暫存帳號不在此次清理範圍；保留且不dispatch部署workflow。

**結論：正式SQL技術相容檢查已通過；整體上線仍未放行。下一步先完成正式金鑰、worker／通知設定與入口控制，再核准正式安裝。**
