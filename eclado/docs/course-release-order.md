# 專業課程正式環境 SQL 順序

以下順序已在隔離的 PGlite 資料庫完整執行。正式執行前，確認既有後台權限、會員角色與購物金帳本已安裝。先核對正式環境現有的表和函式再執行，部分檔案包含非冪等的建表、欄位或函式定義。

1. `supabase-courses-foundation.sql`：課程、會議、圖片儲存及公開與後台查詢。
2. `supabase-course-listing-details.sql`：新增授課講師和課程概述，更新公開查詢與儲存函式。
3. `supabase-course-description-images.sql`：擴充公開課程介紹圖片的讀取規則。
4. `supabase-course-registration.sql`：訂單、參加者、付款嘗試及人工案件。
5. `supabase-course-payments.sql`：付款方式、付款連結及銀行入帳確認。
6. `supabase-course-income.sql`：人工退款登記與課程收入摘要。
7. `supabase-course-notifications.sql`：課程通知佇列與後台統計。
8. `supabase-course-shopping-credit.sql`：課後購物金發放與重複發放防護。

Preview 付款測試須使用隔離的付款服務、測試 Supabase 和永豐測試設定。前台使用 `VITE_PAYMENT_MODE=mock` 及明確的 `VITE_PAYMENT_API_URL`，付款服務設定自己的 `PAYMENT_PUBLIC_URL`，並以 `COURSE_STOREFRONT_ORIGIN` 指向 Preview 網址，以便跨來源請求和付款後返回。

正式上線時，課程付款模組須隨付款服務部署，並驗證課程建立、返回及銀行回呼路由。通知與購物金跟隨現有 reward dispatch timer。部署更新後的 worker 並安裝第 7、8 份 SQL，再按需啟用 `COURSE_NOTIFICATIONS_ENABLED` 與 `COURSE_SHOPPING_CREDIT_ENABLED`，並確認送信和 LINE 設定。
