# 滿額贈／滿件贈多贈品

後台兩種贈品活動皆可新增、移除多列，每列設定商品規格與每次贈送數量。同一規格只允許一列；不同規格可分列。活動列表、編輯、複製均保留所有贈品及順序，既有單贈品自動轉成一列。買 X 送 Y 的免費件數維持原規則。

每列先依一次／重複達標算出總應贈數量，再與可用贈品庫存取小值。可用庫存扣除未逾期的訂單保留，以及本次報價中其他活動已分配的同規格贈品。零庫存、停用或不可用的品項略過；其他品項照送。全部無庫存仍可購買，不建立零數量的贈品明細或庫存保留。

優惠券專用贈品活動同樣套用部分贈送規則。達標但全數缺貨時優惠券仍可接受，依既有流程保留／消耗使用次數；未達資格門檻仍拒絕。正式啟用前應確認營運接受此行為。

訂單保留與歷史快照依實際贈送數量建立。付款扣庫存、取消／逾期釋放沿用原流程。活動後續調整不會回寫已成立訂單。結帳預覽至訂單成立間若庫存被其他人保留，既有庫存重查／確認流程可能要求顧客重新確認，不會超額保留或產生贈品欠貨。

## 安裝

1. 資料庫需已安裝 gift engine、assisted benefits、audience、BOGO、storefront display、student policy 等既有 migration。
2. 執行 `supabase-promotion-multi-gifts.sql` 整份交易。它新增 `promotion_gift_rewards`，以現有單贈品資料回填，包住目前已安裝的儲存 RPC，並以來源檢查保護的替換延伸商城與代客贈品引擎、代客建立訂單鎖定範圍。未知的函式定義會使整份交易中止。
3. 資料庫成功後再發布前端。後台透過外鍵關聯載入贈品清單，不可在尚未安裝新表時發布。

舊欄位 `gift_variant_id`、`gift_quantity` 保留第一列供既有約束相容使用，多贈品以子表為準。請透過 `save_discount_promotion` 儲存整份活動，勿直接修改贈品欄位或子表。舊客戶端試圖儲存已含多列贈品的活動會收到重新整理提示，避免無聲刪除其餘贈品。

新表只提供具有 `promotions.manage` 權限的登入者讀取；一般會員／訪客無法讀取贈品設定，也不能直接增刪修改。外鍵保護每一項贈品規格。

## 驗證

- `npm run build`
- `npx playwright test tests/admin.spec.ts --project=chromium --project=mobile-chrome --workers=1 --grep '可新增多項贈品|編輯與複製保留多項贈品|活動管理可從一般商品贈品庫存|複製 amount_gift|複製 quantity_gift'`
- 在工作目錄以外安裝 `@electric-sql/pglite`，執行 `PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.cjs node --test tests/integration/promotion-multi-gifts.test.cjs`。

SQL 測試使用隔離的 PostgreSQL WASM，載入實際既有贈品報價／保留函式與新 migration；周邊身分、原報價與舊儲存 RPC 使用最小 fixture。涵蓋單贈品遷移、重跑 migration、多品項、兩種門檻、重複、部分庫存、無庫存、已保留量、共用規格、優惠券、訂單快照、庫存重查失敗交易回滾、輸入與 ACL。此測試不會連線正式資料庫，不是多連線併發測試。
