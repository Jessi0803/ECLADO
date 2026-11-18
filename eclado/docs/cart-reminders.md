# 購物車未結帳提醒

## 目前狀態

已於 2026-11-18 完成正式資料庫遷移、部署及公版提醒啟用（台灣時間 13:30:19）。每 10 分鐘檢查，既有購物車最早於 11/19 13:30:19 滿 24 小時後符合時間門檻。設定入口為「系統設定 → 購物車未結帳提醒」，需要 `notifications.send` 權限。正式驗證與回退資訊見 [發布紀錄](cart-reminder-production-2026-11-18.md)。

## 返回購物車流程

- `/cart` 保留獨立購物車頁，提供關閉入口；依使用者確認移除非空車新增的「繼續購物」，空車沿用原按鈕。
- 導覽列在購物車頁點擊會收合回商城；其他頁面點擊則切換側欄。側欄恢復從畫面頂端全高展開並覆蓋導覽列，透過右上角 ×、遮罩或 Esc 收合。
- 切換導覽或瀏覽器返回時收合側欄、解除捲動鎖定；直接網址不再陷入無出口的畫面。
- 未登入開啟提醒連結時，可點「登入並還原購物車」。密碼或 LINE 登入完成後回到 `/cart`，並等待會員身分及購物車還原。原本的結帳登入返回流程保留。

## 提醒與公版

- 公版逐字保留於 `src/config/cartReminder.json`，後台初始內容與資料庫預設一致。
- 支援自訂文字、還原公版、啟用開關及預覽。`[購物車連結]` 必須保留，發送時替換為 `https://ecladotaiwan.com/cart`；網址不含會員識別或登入 token。
- Email 除相同純文字內容外，另附真正可點擊的「返回購物車」按鈕，HTML 會跳脫自訂文字。
- 設定採版本檢查避免管理員互相覆蓋；載入失敗不以預設值覆寫資料庫，儲存失敗保留輸入。
- 修改公版內容只套用尚未開始發送的提醒；已開始的重試固定內容、收件者、寄件者及發送識別碼。

## 時間與資格

1. 最後一次實際變更購物車內容滿 24 小時，且購物車仍有商品，才會列入提醒；單純讀取、背景刷新和重複同步操作不重新起算。
2. 目前已同步但久未變更的購物車，在啟用或重新啟用後至少再等 24 小時，避免啟用當下追發舊購物車。
3. 同一輪購物車至多一則已受理提醒。改量不會每日重發；清空再加購，或成立線上訂單後變更剩餘購物車，會開始新一輪。
4. 購物車最後變更後已成立線上訂單，即不再發購物車提醒，未付款交由既有付款提醒。歷史補登、代客訂單或其他會員訂單不會誤攔。
5. 訪客只有本機購物車，沒有收件身分，因此不發提醒。
6. LINE 優先。未具備可用 LINE 路由或收到明確拒絕時，改寄與 auth 帳號一致且已驗證的 Email；不寄到 LINE 代用信箱。
7. 送出前會重新檢查開關、24 小時門檻、購物車、會員資料及訂單。最終檢查與外部 API 受理間仍可能有極短競態，公版的「若已完成訂購，請忽略」保留。

## 派送及重試

- `api/remind-abandoned-carts.js` 接受 GET／POST，必須帶正確 `CRON_SECRET` Bearer；缺少設定／未授權不接觸資料庫。
- `vercel.json` 每 10 分鐘檢查，最多處理 5 次派送／tick，函式最長 120 秒；高峰佇列將續由下一輪處理，因此不是精確到秒的 24 小時排程。
- service_role 專用 claim／prepare／complete RPC，以資料列鎖、2 分鐘租約與唯一會員／輪次限制避免重疊工作重複發送。客戶端不可直接讀寫佇列或呼叫 worker RPC。
- LINE 使用固定 `X-Line-Retry-Key`，Email 使用固定 `Idempotency-Key`；timeout／5xx 先用原管道及相同識別碼重試，不立即改寄而冒跨管道重複風險。只有明確 LINE 拒絕才切 Email。
- 重試間隔 10／30／60／360 分鐘，最多 6 次；第一次嘗試後超過 23 小時停止自動重試，標記 `unknown`。不重新產生發送識別碼來追發。
- 若已嘗試的訊息在重試前遇到購物車內容改變，保守取消後續派送；本輪不另補一則新訊息，以免其實已送達卻重複提醒。
- `sent` 代表通知供應商已受理，不代表會員已讀。LINE 封鎖等未明確回報的狀態，不能據此判定是否應改寄 Email。
- 終態會清除佇列中暫存的收件地址；會員帳號刪除會級聯清除其購物車與提醒。Worker 日誌只記錄數量及結果，不記錄地址、內容或憑證。

## 部署順序

1. 先確認已安裝 `supabase-member-carts.sql`、profiles、orders（含 `order_source`）與後台權限基礎。
2. 執行 `supabase-cart-reminders.sql`。可重跑；公版與開關不會因重跑而被覆蓋，不修改報價、建單、付款、庫存或會員角色函式。
3. 部署前端、新 API 和 Vercel cron。使用既有正式 Supabase／LINE／Email 設定：`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`（或 `SUPABASE_SERVICE_KEY`）、`LINE_CHANNEL_ACCESS_TOKEN`、`RESEND_API_KEY`、`ORDER_EMAIL_FROM`、`CRON_SECRET`。不新增秘密到版本庫。
4. 先確認 `/cart` 返回、收合、密碼與 LINE 登入返回，並用合成會員／隔離通知管道驗證派送，不替真實會員改時間或建立正式測試訂單。
5. 再到系統設定儲存公版或自訂文案並啟用。尚未啟用時 cron 只檢查開關，不會送出新提醒。
6. 若需暫停，關閉提醒開關；不刪除去重帳本。回退前端時保留購物車與提醒資料表。

## 供應商契約參照

- [LINE 重試請求與 retry key](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/)
- [Resend Idempotency Keys](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Vercel Cron 管理與授權](https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs)

## 本機驗證紀錄｜2026-11-18

- 36 項單元與 PostgreSQL（PGlite）資料庫測試通過，涵蓋預設文案、角色權限、設定衝突、24 小時門檻、讀取不重置時間、訂單與輪次、租約、同鍵重試、Email 備援與資料清除。
- 43 項桌面／手機尺寸 Playwright 回歸通過，另 1 項依既有手機專用條件在桌面專案略過。包含購物車返回、導覽收合、瀏覽器返回解除捲動鎖、密碼／LINE 登入返回、後台預覽與保存、會員隔離、結帳輸入保留及美容師申請原始選檔欄位保留。
- `npm run build` 成功，SEO 預渲染 65 商品／8 文章；有既有大型 chunk 警告。
- `git diff --check` 通過。沒有以真實會員或真實 LINE／Email 收件者進行發送；供應商 HTTP 以隔離 stub 驗證。
- 本機測試未包含實體 iPhone Safari／LINE 原生選檔器；正式發布後另完成跨裝置、離線重連、帳號隔離及結帳輸入保留實測，詳見發布紀錄。

重跑方式：

```sh
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node --test tests/unit/member-cart.test.mjs tests/integration/member-cart-db.test.cjs tests/integration/cart-reminders-db.test.cjs tests/integration/cart-reminder-worker.test.cjs
npx playwright test tests/cart-reminder-settings.spec.ts tests/member-cart.spec.ts --project=chromium --project=mobile-chrome --workers=1
```
