# 圖片 JPG 備援正式發布｜2026-11-19

已套用正式資料庫遷移，並部署商品圖片、課程封面及課程介紹插圖的 JPG 備援。

- 正式站：https://ecladotaiwan.com
- Commit：`18bb04f268a64bc64f83814db398eee59161f143`
- Vercel：`dpl_9faNFmNLvgxWwr34NSiZ7VTcDgoN`，READY；正式與 www 網域均已指向新版。
- 從當時正式 main `8a8a1c2a9fe77ba75c78c51083c74fbcd314af9a` 建立獨立 clone，僅發布這次 9 個相關檔案，保留原工作區其他未提交開發。既有正式課程 RPC 維持原樣。

## 資料庫

已在 Supabase `ilvdvlkdpntwmaijncaz` 的 main／PRODUCTION SQL Editor 執行 `supabase-course-image-jpeg-fallback.sql` 的遷移。課程 bucket 仍為私有、上限 2 MB，新增接受 image/jpeg；封面路徑、介紹插圖讀取與管理員上傳限制同步接受 jpg。

遷移前後，除目標圖片可見性函式外，其他 public 函式來源與 ACL 指紋相同：`0dce6a7debe32f9c7582ca34467106c4`。

## 驗證

- 隔離發布來源的 32 項桌機／手機模擬瀏覽器測試、1 項資料庫整合測試與完整建置通過。
- 正式頁面載入新版程式後，強制讓 WebP 編碼回傳 null，共觸發三次備援。商品轉檔函式與圖片儲存上傳，以及課程封面／插圖共用的正式上傳函式，均成功產生並上傳 `.jpg`。
- 以現有管理員的正常登入工作階段上傳；未模擬儲存後端。三張回讀圖片的 MIME 都為 image/jpeg，JPEG 檔頭與 96×64 尺寸正確；介紹插圖解析器接受回傳的 JPG 路徑。
- 另以三張合成圖片確認正式儲存空間的 JPG 接受度及公開／私有讀取規則。
- 正式資料庫在回滾交易內驗證商品 JPG metadata、課程儲存 RPC、草稿隱私與上架後封面／插圖的匿名讀取政策。全部通過後回滾，未留下測試商品圖片紀錄或課程。
- 商品完整儲存 UI 由發布版 E2E 驗證；正式瀏覽器的商品檢查範圍為轉檔與真實儲存上傳／下載。
- 六張測試圖片已按精確路徑清除，並以具權限的讀取確認已不存在。未修改既有商品、課程、訂單或付款資料。
- `/`、`/shop`、`/admin`、`/courses`、`/payment-result` 與兩個新版共用程式資產均 HTTP 200。
- 未進行實體 iPhone Safari 或 LINE 原生選檔器測試；本次未改動原生選檔或登入狀態流程。

去敏證據：[verification.json](evidence/image-jpeg-fallback-production-20261119/verification.json)。

## 回復資訊（未執行）

前版正式部署為 `dpl_7jvaveTPU7kLMUYMqTH4uDa6Kkk4`。必要時可回退前端；資料庫新增 JPG 支援可保留，避免已上傳 JPG 失效。
