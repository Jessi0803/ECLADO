# 待部署項目

## 專業資格年度續約與季度結算通知

目前狀態：正式資料庫 SQL 已由管理者執行；程式、前端與 API 待部署。

部署順序：

1. 確認 private Storage bucket `professional-renewal-evidence` 已建立，且不是 public bucket。
2. 部署前端、後台與 `/api/professional-quarterly-notices` 排程。
3. 以師資／經銷帳號驗證會員專區的續約與獎狀上傳；以管理員驗證結算與審核。

部署後驗證：

1. 只有 10/1–12/31 可送出下一年度續約，且同年度不可重複送出或撤回。
2. A 條件依有效天數比例計算；年度路徑仍要求每個有效季度不得零進貨。
3. 品牌專班獎狀圖片只能透過短效 signed URL 查看，待審核數量僅作暫估。
4. 年度結算後，已申請者進入待審核；未申請者降回 `pro`。
5. 核准／拒絕後 LINE 優先、Email 備援；通知失敗不回滾審核結果。
6. 季度通知於季初建立不可變快照，失敗會重試，重複排程不會重複建立同一版本。
7. Q4 流程先執行年度結算與未申請降級，再建立季度通知。

Migration：`supabase-professional-renewals.sql`

## 師資／經銷季度改為自然季

目前狀態：正式資料庫 SQL 已由管理者執行；程式碼待部署。

部署順序：

1. 已執行 `supabase-professional-sales-calendar-quarters.sql`。
2. 確認既有線下補登已映射到自然季。
3. 再部署前端程式。

Migration 保留舊版補登 RPC，因此先執行 SQL 不會讓當下正式前端失效；新版前端會改用
`save_professional_sales_adjustment_v2`。

部署後驗證：

1. 9 月生效資格顯示為 `2026 Q3（部分季度）`，期間結束於 9/30。
2. 10 月生效資格顯示為 `2026 Q4（部分季度）`，期間從實際資格日起算。
3. 線上訂單依 `paid_at` 自動歸入自然季，且不計資格生效日前訂單。
4. 後台線下補登可新增、編輯與清空，會員前台同步顯示合計。
5. 修改資格起始日不會讓既有補登失去對應季度。

Migration：`supabase-professional-sales-calendar-quarters.sql`

## 專業會員追加訂單／合併出貨

目前狀態：正式資料庫 SQL 已由管理者執行；程式碼待部署。

注意：SQL 已替換正式計價函式並啟用訂單 trigger，正式站目前是新資料庫邏輯搭配舊前端，請盡快部署同一批程式碼。

部署後驗證：

1. 驗證一般會員結帳不受影響。
2. 驗證專業會員首單付款後取得追加資格。
3. 驗證追加單未重複收運費、低於 NT$5,000 仍可成立。
4. 驗證群組累計滿 NT$15,000 時首單運費只退回一次。
5. 驗證進入備貨後群組鎖定，但鎖定前已建立的未付款追加單仍可付款。
6. 驗證後台群組資訊與取消後人工審查警示。

Migration：`supabase-professional-shipping-groups.sql`

上線後補的兩支修正（皆已於正式資料庫執行，重建環境時要接在主 migration 之後）：

1. `supabase-professional-shipping-groups-role-fix.sql`：`get_my_appendable_shipping_group`
   內的變數名稱與保留字 `current_role` 相撞，導致身分檢查永遠不成立、一律回傳 null。
2. `supabase-professional-shipping-groups-legacy-quote-fix.sql`：底層
   `quote_order_pricing_internal_20260916` 仍有舊的專業會員最低金額檢查，會在 v2
   判斷追加單資格前就擋下建單。改為會員有可追加批次時豁免。

## 歷史訂單補登

目前狀態：程式與 migration 已完成；正式資料庫 SQL 已由管理者執行。

部署後驗證：

1. 使用有 `orders.write` 權限的後台帳號，從會員詳情補登一筆歷史訂單。
2. 驗證該筆訂單顯示於會員訂單紀錄與後台訂單列表。
3. 驗證不改變現有庫存、會員累計消費、營業額及熱門商品。

Migration：`supabase-historical-orders.sql`
