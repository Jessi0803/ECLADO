# 優惠活動、優惠券與贈品資料字典

> 狀態：第一至第四批已於 2026-09-09 套用。百分比／固定金額活動、優惠券後台、結帳試算、配額保留、滿額／滿件贈與贈品庫存皆已啟用。
>
> 範圍：本文件只記錄複合優惠券、滿額／滿件贈與贈品庫存所需的新增資料表，以及本功能會調整的既有資料表。其他既有資料表將另行補充。

## 實施批次

- 第一批：建立資料表、欄位、限制、RLS 與稽核基礎；未改變結帳計算。
- 第二批：新增唯讀 `quote_order_pricing`，並讓 `create_order_with_pricing` 共用同一套後端計價核心。此階段只評估既有 `legacy_discount + automatic` 活動，優惠券與贈品仍不會進入結帳。
- 第三批：啟用百分比／固定金額原子活動、優惠券方案、優惠碼試算與用量保留；付款後核銷、取消後釋放。後台可建立活動與打包優惠券，結帳可套用一組優惠碼。贈品仍未啟用。
- 第四批：啟用滿額／滿件贈、贈品庫存保留，以及訂單與揀貨畫面的贈品呈現。
- 第五批：百分比與固定金額折抵的門檻可選擇依金額或依件數計算；既有活動預設維持依金額計算。

## 設計原則

- `promotions` 的一筆資料只代表一項優惠活動，例如百分比折扣、固定金額折抵、滿額贈或滿件贈。
- 活動的啟用方式分為自動套用與優惠券專用。
- `coupon_campaigns` 位於活動上層，一張優惠券可透過 `coupon_promotions` 打包多個優惠券專用活動。
- 第一版一張優惠券只設定一組共用代碼，不拆分多組代碼資料表。
- 滿額／滿件只累計 `promotion_scopes` 中屬於 `qualification` 的商品；「全館一般商品」不包含 `event_only` 與 `gift_only`。
- 活動限定商品可以被明確指定為活動範圍，但不會因為選擇「全館一般商品」而自動加入。
- 贈品直接關聯既有 `products / product_variants`，不建立重複的贈品商品資料。
- 贈品專用商品使用 `publication_status = 'gift_only'`，不可由顧客直接購買。
- 瀏覽器只提交商品、規格、數量與優惠券代碼；所有資格、價格、折扣、贈品及運費由後端權威計價。
- 訂單保存不可變更的價格快照；日後活動或商品異動不能改變舊訂單。

## 關聯總覽

```text
coupon_campaigns
  ├─ coupon_promotions ── promotions
  │                         └─ promotion_scopes
  ├─ coupon_redemptions ── orders
  └─ promotion_gift_reservations ── product_variants

orders
  ├─ order_adjustments ── promotions / coupon_campaigns
  ├─ items JSONB（包含 merchandise 與 gift）
  └─ order_inventory_allocations ── product_variants
```

## 新增資料表

### 1. `promotion_scopes`

記錄活動的成立範圍與優惠套用範圍，取代只用 `promotions.product_ids` 表達指定商品的方式。

| 欄位 | 建議型別 | 必填 | 對應與用途 |
|---|---|---:|---|
| `id` | `bigint generated always as identity` | 是 | 主鍵。 |
| `promotion_id` | `uuid` | 是 | 對應 `promotions.id`。活動草稿允許刪除時一併刪除範圍。 |
| `scope_role` | `text` | 是 | `qualification` 表示計算滿額／滿件的商品；`benefit` 表示接受折扣的商品。 |
| `target_type` | `text` | 是 | `all_regular`、`product`、`variant`、`category`、`series`。 |
| `product_id` | `integer` | 否 | `target_type = product` 時對應 `products.id`。包含 `event_only` 商品時必須明確指定。 |
| `product_variant_id` | `bigint` | 否 | `target_type = variant` 時對應 `product_variants.id`。 |
| `target_value` | `text` | 否 | `category` 或 `series` 的實際值。 |
| `mode` | `text` | 是 | `include` 或 `exclude`。用於全館排除特定商品等情境。 |
| `created_at` | `timestamptz` | 是 | 建立時間。 |

約束與規則：

- `target_type = all_regular` 時，商品、規格與文字目標皆為空。
- `target_type = product` 時只能設定 `product_id`。
- `target_type = variant` 時只能設定 `product_variant_id`。
- `target_type in (category, series)` 時只能設定 `target_value`。
- 同一活動、角色、目標與 include/exclude 組合不得重複。
- `all_regular` 的前台文案固定顯示「全館一般商品」，只包含 `publication_status = active`，不含 `event_only` 或 `gift_only`。

實際運作：

- 滿件活動只加總符合 `qualification` 範圍的付費商品數量。
- 滿額活動只加總符合 `qualification` 範圍的付費商品金額。
- 百分比或固定金額折抵只作用於符合 `benefit` 範圍的商品小計。
- 贈品不參與任何 qualification 或 benefit 計算。

### 2. `coupon_campaigns`

優惠券主表。一筆代表一張可輸入的優惠券方案，第一版直接保存一組優惠代碼。

| 欄位 | 建議型別 | 必填 | 對應與用途 |
|---|---|---:|---|
| `id` | `uuid` | 是 | 主鍵。 |
| `name` | `text` | 是 | 後台與訂單顯示名稱。 |
| `description` | `text` | 否 | 前台優惠說明。 |
| `code` | `text` | 是 | 管理員設定的單一優惠代碼；禁止匿名直接讀取。 |
| `code_normalized` | `text` | 是 | 去除前後空白並轉大寫後的比對值，建立唯一索引。可用 generated column 或 trigger 維護。 |
| `start_at` | `timestamptz` | 否 | 可使用起始時間；空值表示立即。 |
| `end_at` | `timestamptz` | 否 | 可使用截止時間；空值表示不自動到期。 |
| `active` | `boolean` | 是 | 手動啟用開關。 |
| `total_usage_limit` | `integer` | 否 | 全部使用上限；空值表示不限。保留中的訂單也占用額度。 |
| `per_member_limit` | `integer` | 否 | 每位會員／訪客身份可使用次數；空值表示不限。 |
| `audience_roles` | `text[]` | 是 | 可使用的會員類型，例如 consumer、pro、instructor、distributor。訪客依 consumer 規則處理。 |
| `allow_guest` | `boolean` | 是 | 是否允許未登入訪客使用。 |
| `stacking_policy` | `text` | 是 | `coupon_only`、`allow_auto_gifts` 或 `allow_all`。預設 `allow_auto_gifts`。 |
| `created_by` | `uuid` | 否 | 建立管理員，對應 Auth user。 |
| `updated_by` | `uuid` | 否 | 最後修改管理員。 |
| `created_at` | `timestamptz` | 是 | 建立時間。 |
| `updated_at` | `timestamptz` | 是 | 最後更新時間。 |
| `archived_at` | `timestamptz` | 否 | 封存時間。被使用過的優惠券不實體刪除。 |

實際運作：

- 前台輸入代碼後呼叫後端 RPC；不允許直接 select 優惠券資料。
- 後端正規化代碼後檢查唯一值、啟用狀態、期間、會員資格與使用上限。
- 驗證成功後讀取 `coupon_promotions`，逐項評估所打包的活動。
- 如果所有子活動都不成立，不占用優惠券使用次數。
- 訂單只保存優惠券名稱與遮罩，不在訂單公開資料完整顯示代碼。

### 3. `coupon_promotions`

優惠券與單一活動之間的關聯表。

| 欄位 | 建議型別 | 必填 | 對應與用途 |
|---|---|---:|---|
| `id` | `bigint generated always as identity` | 是 | 主鍵。 |
| `coupon_campaign_id` | `uuid` | 是 | 對應 `coupon_campaigns.id`。 |
| `promotion_id` | `uuid` | 是 | 對應 `promotions.id`，且活動應為 `activation_type = coupon_only`。 |
| `sort_order` | `integer` | 是 | 優惠券內的顯示與計算順序。 |
| `created_at` | `timestamptz` | 是 | 建立時間。 |

約束與規則：

- 同一張優惠券不可重複加入相同活動。
- 自動活動不可加入優惠券；如需相同規則，應建立或複製一項優惠券專用活動。
- 修改已被多張優惠券引用的活動時，後台必須顯示受影響優惠券數量。
- 優惠券期間與活動期間同時成立時才可套用；後台應警告期間不相交的設定。

### 4. `coupon_redemptions`

優惠券額度與每人使用次數的交易紀錄。

| 欄位 | 建議型別 | 必填 | 對應與用途 |
|---|---|---:|---|
| `id` | `uuid` | 是 | 主鍵。 |
| `coupon_campaign_id` | `uuid` | 是 | 對應 `coupon_campaigns.id`。 |
| `order_id` | `text` | 是 | 對應 `orders.id`；同一訂單同一優惠券只能有一筆。 |
| `user_id` | `uuid` | 否 | 已登入會員對應 Auth user。 |
| `guest_identity_hash` | `text` | 否 | 訪客使用正規化 Email 與手機產生的不可逆雜湊，不保存額外明文身份。 |
| `status` | `text` | 是 | `reserved`、`redeemed` 或 `released`。 |
| `reserved_at` | `timestamptz` | 是 | 建立訂單並占用額度的時間。 |
| `expires_at` | `timestamptz` | 是 | 未付款保留截止時間，通常與訂單付款期限一致。 |
| `redeemed_at` | `timestamptz` | 否 | 付款成功、正式核銷時間。 |
| `released_at` | `timestamptz` | 否 | 取消、付款失敗或逾期釋放時間。 |
| `release_reason` | `text` | 否 | cancelled、expired、payment_failed 或管理員釋放原因。 |
| `created_at` | `timestamptz` | 是 | 建立時間。 |

實際運作：

- 建立訂單時，在同一個資料庫 transaction 內鎖定優惠券並新增 `reserved`。
- `reserved` 與 `redeemed` 都占用總發行量與個人使用次數，避免併發超用。
- 付款成功改為 `redeemed`；付款重試沿用同一筆，不重複核銷。
- 取消、失敗或逾期改為 `released`，額度重新開放。
- 已付款後取消是否歸還優惠券不自動處理，需由未來退款政策或管理員操作決定。

### 5. `promotion_gift_reservations`

保留未付款訂單已承諾的贈品規格庫存。

| 欄位 | 建議型別 | 必填 | 對應與用途 |
|---|---|---:|---|
| `id` | `bigint generated always as identity` | 是 | 主鍵。 |
| `order_id` | `text` | 是 | 對應 `orders.id`。 |
| `promotion_id` | `uuid` | 是 | 產生贈品的滿額／滿件活動。 |
| `coupon_campaign_id` | `uuid` | 否 | 優惠券活動時對應優惠券；自動活動為空。 |
| `product_variant_id` | `bigint` | 是 | 實際贈送規格，對應 `product_variants.id`。 |
| `quantity` | `integer` | 是 | 保留數量，必須大於 0。 |
| `status` | `text` | 是 | `reserved`、`consumed` 或 `released`。 |
| `reserved_at` | `timestamptz` | 是 | 建立訂單並保留贈品的時間。 |
| `expires_at` | `timestamptz` | 是 | 贈品保留截止時間。 |
| `consumed_at` | `timestamptz` | 否 | 付款成功並轉為正式庫存配置的時間。 |
| `released_at` | `timestamptz` | 否 | 取消、失敗或逾期釋放時間。 |
| `release_reason` | `text` | 否 | 釋放原因。 |
| `created_at` | `timestamptz` | 是 | 建立時間。 |

實際運作：

- 後端建立訂單時鎖定 `product_variants`，以「實際庫存－其他有效贈品保留量」判斷是否可贈送。
- 贈品採有庫存才成立，不建立預購贈品。
- 一般商品付款配置庫存時也必須尊重其他訂單的有效贈品保留量。
- 付款成功後轉為 `consumed`，並透過既有訂單庫存配置正式扣庫存。
- 付款失敗、取消或逾期時轉為 `released`。

### 6. `order_adjustments`

記錄訂單實際成立的每一項優惠，供訂單明細、稽核與統計使用。

| 欄位 | 建議型別 | 必填 | 對應與用途 |
|---|---|---:|---|
| `id` | `bigint generated always as identity` | 是 | 主鍵。 |
| `order_id` | `text` | 是 | 對應 `orders.id`。 |
| `promotion_id` | `uuid` | 否 | 對應實際套用活動。活動封存後仍保留關聯。 |
| `coupon_campaign_id` | `uuid` | 否 | 由優惠券觸發時對應優惠券。 |
| `adjustment_type` | `text` | 是 | percentage_discount、fixed_discount、amount_gift、quantity_gift 或 free_shipping。 |
| `name_snapshot` | `text` | 是 | 建立訂單當下的活動顯示名稱。 |
| `qualification_snapshot` | `jsonb` | 是 | 成立範圍、門檻、計算基準、符合金額／件數等快照。 |
| `amount` | `numeric` | 是 | 此項價格折抵金額；贈品活動為 0。 |
| `gift_product_id` | `integer` | 否 | 贈品商品，對應 `products.id`。 |
| `gift_variant_id` | `bigint` | 否 | 贈品規格，對應 `product_variants.id`。 |
| `gift_quantity` | `integer` | 否 | 贈品數量。 |
| `sort_order` | `integer` | 是 | 訂單畫面顯示順序。 |
| `metadata` | `jsonb` | 是 | 折扣前後金額、公式版本、優惠券遮罩及其他計算資訊。 |
| `created_at` | `timestamptz` | 是 | 建立時間。 |

實際運作：

- 一個複合優惠券可能在同一張訂單產生多筆 adjustment。
- `orders.discount` 保存所有價格折抵的加總，維持現有季度採購額與營業分析相容。
- 贈品同時寫入 `orders.items`，使用 `line_type = gift`、成交價 0，並保存商品與規格名稱快照。
- adjustment 與訂單價格快照在訂單建立後不可由一般更新操作修改。

## 調整既有資料表

### `promotions`

定位調整為「一筆一項優惠活動」。目前新增：

| 欄位 | 用途 |
|---|---|
| `benefit_type` | percentage_discount、fixed_discount、amount_gift、quantity_gift。 |
| `activation_type` | automatic 或 coupon_only。 |
| `threshold_value` | 滿額金額或滿件數量。折扣活動無門檻時可為空。 |
| `threshold_type` | `amount` 或 `quantity`。既有折扣活動預設 `amount`，不改變原本計價。 |
| `threshold_basis` | before_bundle_discount 或 after_bundle_discount。滿件活動不使用。 |
| `gift_variant_id` | 贈品活動指定的唯一實體規格。 |
| `gift_quantity` | 每次成立贈送數量。 |
| `repeat_mode` | once 或 repeat；第一版後台可先固定 once。 |
| `exclusive_group` | 需要只取最優惠或最高門檻時的互斥群組。 |
| `priority` | 同群組判斷與顯示順序。 |
| `archived_at` | 已被使用的活動改為封存，不實體刪除。 |

既有同時包含折扣率與固定折抵的活動，在遷移時拆成兩項原子活動，並用相同群組或優惠券維持既有計算順序。

### `products`

- `publication_status` 增加 `gift_only`。
- `gift_only` 仍出現在商品、庫存、叫貨與活動管理。
- `gift_only` 不出現在一般商城、活動限定頁、SEO 或 sitemap。
- 顧客提交的購物車項目不得包含 `gift_only`；只能由後端優惠引擎加入零元贈品。
- 贈品仍使用既有 `product_variants` 的 SKU、規格與庫存。

### `orders`

目前新增：

| 欄位 | 用途 |
|---|---|
| `coupon_campaign_id` | 套用的優惠券方案。 |
| `coupon_name` | 優惠券名稱快照。 |
| `coupon_code_mask` | 遮罩後代碼，例如 VIP***。 |

既有 `subtotal`、`discount`、`promotion_id`、`promotion_name` 保留相容；`pricing_snapshot` 升級為 version 4，保存完整活動、優惠券、贈品、運費與計算基準。

### `order_inventory_allocations`

目前新增或擴充：

| 欄位 | 用途 |
|---|---|
| `line_type` | merchandise 或 gift。 |
| `promotion_id` | 贈品來源活動。 |
| `coupon_campaign_id` | 贈品由優惠券觸發時的來源。 |
| `source` | 增加 promotion_gift。 |

贈品與一般商品使用同一套付款後庫存配置與釋放機制，但訂單、揀貨及待補畫面必須標示贈品來源。

## 權威計價流程

1. 驗證顧客提交的商品與規格；拒絕顧客直接提交 `gift_only`。
2. 依會員類型取得後端價格，處理固定專業價商品。
3. 評估自動百分比與固定金額活動。
4. 驗證一組優惠券代碼、使用期間、會員資格與剩餘額度。
5. 取得優惠券打包的活動，使用同一份資格基準逐項判斷。
6. 滿額只累計活動 qualification 範圍內的商品金額；滿件只累計其付費商品數量。
7. 確認贈品規格與可用庫存，建立 gift reservation。
8. 計算專業會員最低訂購額、免運與最終金額。
9. 建立訂單、order adjustments、coupon redemption 與完整 pricing snapshot；任一步失敗即全部 rollback。
10. 付款成功後核銷優惠券、消耗贈品保留並配置商品與贈品庫存。
11. 取消、付款失敗或逾期時釋放優惠券及贈品保留。

## RLS、稽核與刪除規則

- 只有具 `promotions.manage` 權限的管理員可建立或修改活動及優惠券；商品小編不可操作。
- 匿名與一般會員不可 select `coupon_campaigns`、`coupon_redemptions`、贈品保留或訂單優惠明細。
- 前台優惠券驗證只能透過限定參數的 security-definer RPC。
- 活動與優惠券新增、修改、封存、釋放額度都要寫入後台操作紀錄。
- 已被優惠券或訂單引用的活動只能封存。
- 已有 redemption 或訂單紀錄的優惠券只能封存。
- 訂單 adjustment、優惠券核銷及價格快照不得由一般管理員直接修改。

## 第一版不建立的資料表

- 不建立 `coupon_codes`：第一版一張優惠券只保存一組代碼。
- 不建立 `gift_products`：贈品直接使用現有商品與規格。
- 不建立 `promotion_tiers`：不同門檻各自建立為單一活動，再由優惠券打包或使用互斥群組。
- 不新增一般化 `order_items` 關聯表：商品與贈品繼續保存於現有 `orders.items` JSONB，庫存配置與 adjustment 提供可查詢紀錄。
