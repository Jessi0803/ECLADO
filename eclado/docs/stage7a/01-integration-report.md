# 階段7A｜整合盤點與驗收報告

日期2026-10-13；基線`a2b89ed33cdbc26bc0a6fd30b69deb8275f7d9a5`，分支`codex/instructor-student-rewards`。已完整讀附件、AGENTS／CLAUDE／LEARNING、外部統一開發v1.12及1B～6階段紀錄；附件v1.11與「階段6未提交」為較舊狀態，實際6及驗收工具已提交。沿用本對話Implementation偏好，不更新LEARNING能力紀錄。

**7A盤點、隔離回歸與計畫已完成；正式上線No-Go，尚未達成全部整合放行條件。** 未進入7B／7C，未建立測試Supabase、未安裝正式Migration、未變更env／排程／部署／Git提交推送／學生價。正式DB唯讀查詢另經使用者明確授權；Vercel使用者登入後只讀頁面；Vultr只讀兩個程式hash，不讀.env或重啟。

## 重要結論

1. **既有正式指定會員優惠券quote/create不一致**：正式`quote_order_pricing_discount_v2`使用`coupon_campaign_allows_identity`，`create_order_with_pricing_discount_v2`仍檢查`audience_roles`。隔離載入正式匯出本體，再套2A後，ONLY members優惠券報價成功、建單22023且完全回滾。[重現測試](../../tests/integration/reward-stage7a-production-coupon-compat.test.cjs)／[證據](../evidence/reward-stage7a/production-coupon-repro.log)。不是新返饋造成，不能用重跑舊優惠SQL掩蓋。需另准最小修補與回歸。
2. 正式Payment API server hash完全匹配main、缺`reward-payment-evidence.cjs`；未發布2B／4有效付款證據接點。不能先產生學生返饋／返饋折抵訂單，期待舊付款程式處理。
3. Preview已由Git自動部署最新分支，**仍寫死正式Supabase、付款API與通知URL**；Preview不是隔離測試站。需另准環境參數化及獨立測試Supabase／付款／通知配置後再做真Auth／PostgREST整合。
4. 開發分支比main少`8d65f0e` JPEG上傳fallback修補；不自行merge／cherry-pick。先批准同步策略，保留正式修補，重跑圖片／專業申請相關回歸。
5. 學生價OFF不會阻止既有金融義務結算，也不等於停用老師錢包／提領。新instructor餘額RPC成功時，即使折抵0，Checkout使用新版wallet quote/create（`src/pages/CheckoutPage.jsx:383`、`src/services/orders.js:54`）。SQL／Payment API／UI必須相容發布，回復也不能任意降版。
6. Worker不能套用銀行keyring的Vercel全域env；現端點僅POST，而Vercel原生Cron是GET，不能直接加cron就宣稱可用。正式架構、最小權限、排程與告警待決策。

## 本次驗證

隔離PG17.6 69測試（含父測試）全通過、PGlite12、API／通知Mock70、Payment API Mock55、SQL靜態118；本機清單20組重跑全通過。UI完整選定17檔604案例首次589pass／12fail／3skip，修正過期素材／定位後原12案例全部重測通過，最終覆蓋601pass／3skip（不是另一個604案例全綠批次）。Build466模組＋假目錄1商品／8文章exit0，保留既有chunk及SEO harness關閉時dependency-scan警告。詳見[完整矩陣](03-test-matrix.md)。

正向的測試「成功重現優惠券缺陷」不等於該業務正常；此結帳情境FAIL並列No-Go。沒有把Mock當作真銀行／正式通知或真Supabase Auth驗收。

## 文件索引

[正式Schema差異](02-production-schema-diff.md)／[測試矩陣](03-test-matrix.md)／[安全權限](04-security-review.md)／[Migration計畫](05-migration-plan.md)／[部署順序](06-deployment-order.md)／[Git與部署](07-git-deployment.md)／[Worker方案](08-worker-options.md)／[備份回復](09-backup-recovery.md)／[Go-No-Go](10-go-no-go.md)／[待決策與工時](11-decisions-estimate.md)。

本次只修改兩份回歸測試素材／selector／既定staff預期；新增Metadata與隔離診斷工具、缺陷重現測試、報告與證據。未改產品JS／SQL業務核心。原四個未追蹤檔案保持原內容。
