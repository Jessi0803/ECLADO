# ECLADO 電商網站 — 功能測試清單（精簡版）

> 用途：手動測試、自動化規劃  
> 網站：https://www.ecladotaiwan.com  

一條 = 一個可測場景，每條寫完整、不依其他編號引用（之後增刪項目較好維護）。有寫「資料庫驗證」的項目，測完畫面後請到 Supabase → Table Editor（或後台列表）對照是否寫入成功。

---

## 功能測試清單

### 購物與結帳

| # | 測試場景 | 通過標準（畫面） | 資料庫驗證 |
|---|----------|------------------|------------|
| 1 | 商城瀏覽 | 列表、分類、商品詳情可開；一般會員見一般價 | `products` 有商品資料（讀取即可） |
| 2 | 會員價格與院線商品 | 一般會員：一般價。美容師：專業價（`proPrice`）。師資：專業價 7 折（畫面標「師資價・專業價7折」）。經銷商：專業價 65 折（畫面標「經銷價・專業價65折」）。一般會員看得到院線品介紹但不能加入購物車，畫面引導私訊 LINE 官方詢問 | `profiles.role` 與價格一致：`pro`＝專業價；`instructor`＝`proPrice×0.7`；`distributor`＝`proPrice×0.65`（四捨五入） |
| 3 | 現貨／預購 | 庫存 > 0 顯示現貨；≤ 0 顯示預購且仍可下單 | `products.stock` 與前台標示一致 |
| 4 | 購物車 | 加購、改數量、刪除；金額正確 | 無（購物車僅瀏覽器記憶體，重整會清空） |
| 5 | 活動折扣 | 位於活動上架／下架時間範圍內時，商城與購物車價格、折扣正確；尚未開始或已結束的活動不折扣 | 前台依 `start_at`／`end_at` 判斷生效期間；`active` 欄位目前不影響是否套用，請確認 `product_ids`、排程與折扣一致 |
| 6 | 結帳全流程 | 填收件資料 → 選付款 → 送出；畫面有訂單編號 | `orders` 新增一筆：`id`、`items`、`total`、`address`、`phone`、`email`、`user_id`（登入時）正確 |
| 7 | 付款方式（虛擬帳號／信用卡／行動支付） | 虛擬帳號：顯示完整虛擬帳號（永豐 807）供匯款。信用卡／Apple Pay／Google Pay：能完成或進入付款流程 | `orders` 有新單；訂單狀態為 `paid` 前 `products.stock` 不變 |

### 庫存（與後台連動）

| # | 測試場景 | 通過標準（畫面） | 資料庫驗證 |
|---|----------|------------------|------------|
| 8 | 付款才扣庫存 | 下單後庫存不變；後台改「已付款」後前台變化；後續改「備貨中／已出貨／已到貨」庫存不加回 | 下單後 `products.stock` 不變；改 `orders.status` 為 `paid` 後 `products.stock` 減少。`paid`、`preparing`、`shipped`、`delivered` 都視為占用庫存 |
| 9 | 取消／退貨加回庫存 | 已占用庫存的訂單取消／退貨後庫存回升 | `orders.status` 從 `paid`／`preparing`／`shipped`／`delivered` 改成 `cancelled` 或 `returned` 後，`products.stock` 加回 |
| 10 | 後台改庫存 | 後台改數字後，前台刷新可見現貨／預購變化 | `products.stock` 與後台輸入一致 |
| 11 | 24 小時未付款自動取消 | 逾時訂單作廢；此功能由 Vercel Cron 每日執行，不是滿 24 小時立即取消 | `orders.status` = `cancelled`（原為 `awaiting_confirm` 或 `unpaid`，且 `created_at` 超過 24 小時） |

### 會員

| # | 測試場景 | 通過標準（畫面） | 資料庫驗證 |
|---|----------|------------------|------------|
| 12 | Email 註冊 | 填表送出成功；畫面提示驗證信已發送 | `auth.users`、`profiles` 有新會員：`email`、`name`、`phone`、`role` |
| 13 | Email 認證信 | 收件匣（含垃圾郵件）收到驗證信；點連結後可登入 | `auth.users.email_confirmed_at` 有值 |
| 14 | 忘記密碼 | 畫面提示已寄出；收件匣收到重設信；點連結可設新密碼並登入 | 無（Supabase Auth 處理） |
| 15 | 密碼錯誤、未驗證 Email | 有正確錯誤提示 | 無新增資料 |
| 16 | LINE 登入／註冊 | 授權時出現加官方好友提示；登入成功。首次使用 LINE 自動建立會員（不需另填註冊表） | 新會員：`auth.users`、`profiles.line_user_id`。舊會員：`profiles.line_user_id` 正確 |
| 17 | 會員專區訂單 | 看得到自己的訂單；已出貨有托運單號 | 前台會員專區目前只用 `orders.user_id = 會員 uid` 查詢；`tracking` 與畫面一致 |
| 18 | 美容師申請 | 填表送出；狀態變審核中 | `professional_applications` 新增；`profiles.role` = `pending` |
| 19 | 審核中／已是美容師 | 不能再送申請；提示正確 | `profiles.role` 為 `pending` 或 `pro` |
| 20 | 後台審核美容師 | 核准／拒絕後前台權限正確 | 核准：`status` = `approved`，`role` = `pro`。拒絕：`rejected`，`role` = `consumer` |

### 後台（/admin）

| # | 測試場景 | 通過標準（畫面） | 資料庫驗證 |
|---|----------|------------------|------------|
| 21 | 後台登入權限 | 管理員可進；非管理員擋下 | 無寫入（僅驗證權限） |
| 22 | 訂單管理 | 列表、明細、改狀態 | `orders.status` 與後台一致；改為 `paid` 時 `products.stock` 減少 |
| 23 | 出貨與 LINE 通知 | 填托運單號；會員專區看得到單號；曾 LINE 登入的會員在 LINE 收到出貨推播（訂單編號、托運單號） | `orders.tracking` 有值；`status` 通常為 `shipped` |
| 24 | 商品管理與庫存 | 後台可新增商品、上傳圖片、改庫存、下架與重新上架；前台刷新後僅顯示上架商品，現貨／預購標示連動 | `products.image_url`、`products.stock`、`products.active` 與後台操作一致 |
| 25 | 活動管理 | 新增／編輯／刪除／設定上下架時間；前台價格依排程連動 | `promotions` 與前台一致；前台依 `start_at`／`end_at` 判斷，目前不依 `active` 欄位停用 |

### 全站

| # | 測試場景 | 通過標準（畫面） | 資料庫驗證 |
|---|----------|------------------|------------|
| 26 | 直接開網址 | 主要路徑不 404、不白屏 | 無 |
| 27 | 手機版全流程 | 漢堡選單、購物、結帳可用 | 與電腦版相同：該測的訂單、會員、庫存欄位照常查表 |
| 28 | 靜態頁 | 退換貨、隱私權、聯絡我們能開 | 無 |

---

## 資料庫寫入總覽（速查）

| 使用者操作 | 主要資料表 | 應出現的資料 |
|------------|------------|--------------|
| 下單（結帳送出） | `orders` | 新訂單一筆，含商品 `items`、金額、收件資訊、`user_id` |
| 已付款（任何付款方式） | `orders` + `products` | `status` = `paid`；`products.stock` 減少 |
| 出貨流程狀態更新 | `orders` | `status` 從 `paid` 改成 `preparing`／`shipped`／`delivered` 時，庫存維持已扣狀態 |
| 取消／退貨（已占用庫存） | `orders` + `products` | `status` 從 `paid`／`preparing`／`shipped`／`delivered` 改成 `cancelled` 或 `returned` 時，庫存加回 |
| Email 註冊 | `auth.users` + `profiles` | 會員基本資料；寄認證信 |
| Email 忘記密碼 | Supabase Auth | 寄重設密碼信 |
| LINE 登入／首次註冊 | `auth.users` + `profiles` | `line_user_id`；新用戶自動建帳 |
| 登入後申請美容師 | `professional_applications` + `profiles` | `pending` 申請 + `role` = `pending` |
| 後台核准／拒絕美容師 | `professional_applications` + `profiles` | `approved`／`rejected` + `role` 更新 |
| 後台出貨 | `orders` + LINE 推播 | `tracking`、`status`；`api/line-push` |
| 後台新增／上下架商品 | `products` | 新增包含 `image_url`；下架 `active=false`；重新上架 `active=true` |

查詢方式：Supabase 專案 → Table Editor → 選表 → 依 `created_at` 或訂單 `id` 排序找最新一筆。

---

## 自動化覆蓋對照

### 目前已有

| 測試檔 | 對應範圍 | 目前涵蓋的功能 |
|--------|----------|----------------|
| `tests/eclado-frontend.spec.ts` | Mock E2E | 1、2（pro／instructor／distributor 價格）、3（含預購可下單及 realtime 庫存更新）、4（商品下架、價格與院線限制 realtime 同步）、5（折扣順序與排程邊界/生效/不生效）、6（訂單 payload / user_id、訂單寫入失敗提醒）、7（虛擬帳號、信用卡、Apple Pay、Google Pay payType 與失敗提示）、17、26、27、28 |
| `tests/inventory-sql.spec.ts` | 本地 SQL / 文件檢查 | 8、9 的文字與 trigger 規則一致性 |
| `tests/auth-email.spec.ts` | Mock E2E | 12（Email 驗證成功通知）、13（驗證後登入頁提示）、14（忘記密碼表單、送出成功/失敗）、15（密碼錯誤、未驗證 Email）、重設密碼頁密碼驗證與成功更新 |
| `tests/professional-registration.spec.ts` | Mock E2E | 18（一般會員登入後填 `professional-apply.html` 並寫入 `professional_applications`）、19（pending／pro 不能重複申請）、一般會員註冊不觸發申請 |
| `tests/admin.spec.ts` | Mock Admin E2E | 10、20（核准申請同步 `profiles.role`）、21、22、23（托運單號 + LINE push payload）、24（新增商品、本機圖片上傳驗證與寫入失敗、下架／重新上架與失敗狀態、庫存）、25（含排程時間倒置驗證） |
| `tests/integration/payment.spec.ts` | 永豐 QPay integration | 7 |
| `tests/integration/staging-inventory.spec.ts` | staging Supabase integration | 8、9 的真實資料庫 trigger 驗證；執行前拒絕正式 Supabase project |
| `tests/integration/staging-products.spec.ts` | staging Supabase integration | 24（新增商品的 `image_url` 寫入、下架與重新上架的 `active` 讀寫；拒絕正式 Supabase project） |
| `tests/integration/professional-applications.spec.ts` | staging Supabase integration | 18、20（申請寫入、核准／拒絕流程、status constraint、standalone source）；執行前拒絕正式 Supabase project |
| `tests/integration/email.spec.ts` | Resend + staging Supabase integration | 12（驗證信確實寄出）、14（忘記密碼信確實寄出）— 透過 Resend API 驗證；執行前拒絕正式 Supabase project |
| `tests/integration/line-handler.test.cjs` | 完全隔離 LINE handler 測試 | 16、23 的後端核心邏輯 |
| `tests/integration/line-webhook.test.cjs` | 完全隔離 LINE webhook 測試 | Webhook health check、method guard、簽章驗證、follow event |
| `tests/integration/cancel-expired-orders.test.cjs` | 完全隔離 Cron handler 測試 | 11（24 小時未付款自動取消：授權、查詢條件、無逾期訂單、批次取消、缺 service key、Supabase 失敗） |
| `tests/integration/email-click.spec.ts` | Playwright + Resend + staging Supabase | 13（驗證信連結點擊 → `email_confirmed_at` 寫入）、14（重設密碼連結點擊 → 填新密碼 → 成功）；執行前拒絕正式 Supabase project |

### 預計補齊

| 測試檔 | 建議範圍 | 對應功能 |
|--------|----------|----------|
| `tests/integration/line.spec.ts` | 真實 LINE test channel 登入與推播 | 16、23 |

### 分層原則

- `npm run test:e2e`：跑最快、最安全的本地測試，主要驗前台流程與 SQL / 文件一致性。
- `npm run test:integration`：跑 staging Supabase 連線測試，專門驗資料庫 trigger 與外部整合。會包含永豐 QPay 測試，前提是 `RUN_PAYMENT_INTEGRATION=1`。
- `npm run test:line`：完全隔離的 LINE 後端測試，驗 `api/line-callback.js`、`api/line-push.js`、`api/line-webhook.js`，不打正式 LINE 服務。
- 外部服務測試不要混在同一支檔案，避免失敗原因難查，也方便分開開關與排錯。

---

## 參考

### 業務規則（庫存）

| 規則 | 系統行為 |
|------|----------|
| 預購可下單 | 庫存 ≤ 0 不擋結帳 |
| 付款扣庫存 | 虛擬帳號、信用卡、行動支付皆相同：進入 `paid` 才扣庫存 |
| 出貨流程不加回 | `paid`、`preparing`、`shipped`、`delivered` 都視為占用庫存 |
| 取消／退貨加回 | 已占用庫存的訂單改成 `cancelled` 或 `returned` 後，庫存加回 |

### 訂單狀態對照

| 狀態 | 意思 |
|------|------|
| 轉帳待確認 | 剛下單，等匯款 |
| 未付款 | 尚未完成付款 |
| 已付款 | 已收款（此時扣庫存） |
| 備貨中／已出貨／已到貨 | 出貨流程 |
| 退貨／已取消 | 退貨或取消（已付款取消會加回庫存） |

### 金流說明

- 實際串接：永豐 QPay（`pay.ecladotaiwan.com`），非綠界。
- 購物車重新整理會清空（已知限制）。

### 網址對照（自動化用）

| 網址 | 頁面 |
|------|------|
| `/` | 首頁 |
| `/shop` | 商城 |
| `/cart` | 購物車 |
| `/checkout` | 結帳 |
| `/login` | 登入／註冊 |
| `/account` | 會員專區 |
| `/professional-apply` | 美容師申請 |
| `/about` | 品牌故事 |
| `/info` | 購物說明 |
| `/privacy` | 隱私權 |
| `/contact` | 聯絡我們 |
| `/admin` | 後台 |

---

## 測試帳號準備

| 帳號 | 用途 |
|------|------|
| 一般會員 | 購物、申請美容師 |
| 美容師 | 專業價、院線商品 |
| 師資 | 測專業價 7 折 |
| 經銷商 | 測專業價 65 折 |
| 審核中 | 美容師申請審核中畫面 |
| 全新 LINE 帳號 | LINE 首次登入自動註冊 |
| LINE 登入過 | LINE 登入、出貨 LINE 推播 |
| 可收信的 Email | 註冊認證信、忘記密碼重設信 |
| 管理員 | 後台 |

---

*QA 功能清單 v3.5 · 各條自包含，不依編號交叉引用*
