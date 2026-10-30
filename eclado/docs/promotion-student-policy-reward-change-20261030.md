# 雙十一美容師活動：改為計入師資返饋

使用者於2026-10-30要求九個雙十一美容師活動改為計入師資返饋。正式資料庫於台北23:35完成交易，取代先前九筆皆排除返饋的設定。

- 九個已核對的 pro 活動：`allow_student_price_stacking=false`，`instructor_reward_eligible=true`。
- 只變更師資返饋開關與 updated_at；逐筆確認其他活動欄位不變，其餘活動完整保留。
- 日期、優惠公式、商品範圍、學生價不疊加、擇優與同額選活動規則均保留。
- 沒有回算歷史訂單或修改既有返饋快照、Ledger、庫存、付款資料。
- 變更前後九筆完整設定與保留檢查見 `evidence/promotion-student-policy/production-nine-rewards-enabled-20261030.json`。交易來源為 `promotion-student-policy-production-enable-rewards-20261030.sql`；交易已執行，重新執行會被原狀態防護拒絕。

本地表單文案改為兩個明確選項：「活動優惠可再享學生價」、「活動商品照常計算師資返饋」，各自說明勾選／未勾選的效果，另說明買贈整組與未參與商品的處理。桌面／手機12項相關測試通過。文案與前次整合表單的介面調整仍為本地預覽，尚未部署；正式資料的返饋開關已更新。
