# 後台永豐付款診斷

入口：訂單管理 → 訂單詳情 → 付款狀態 → 永豐付款診斷。原有付款狀態與付款嘗試保留；新增銀行觀測摘要、代碼解釋、信用卡回應碼、查核建議與最近 30 筆不同銀行回覆。

## 判讀界線

| 欄位／情境 | 顯示與判斷 |
|---|---|
| 外層 API Status=S | 只代表串接或查詢成功，不能作為付款成功證據 |
| OrderCreate 成功 | 付款單建立成功，尚不代表付款完成 |
| OrderPayQuery.TSResultContent | 分開顯示內層 Status、APType、Description 的標準代碼、AuthResponseCode |
| PayStatus | 顯示待付款、逾期、已授權未請款、授權失效、取消授權、完成或已撥款等標準對照 |
| E2704／E2720 | 3D 驗證失敗；不能僅憑此碼說是簡訊、OTP 輸入錯誤 |
| 永豐 HTTP 401 | API 認證未通過，可能涉及 API KEY／認證憑證，不代表持卡人刷卡被拒 |
| 永豐 HTTP 499 | 依規格對照 IP 白名單問題，請核對付款主機出口 IP |
| E2401／E2501 等 Token 碼 | 永豐查詢／綁卡 Token 問題，與本站登入／訂單存取憑證不同 |
| 網路、逾時、回覆驗證失敗 | 結果待確認，不視為銀行拒絕，也不改動既有 claim／付款狀態 |
| AuthResponseCode | 安全保存選填的 1–3 碼回應碼；目前規格未附逐碼對照，不套用未確認的 ISO／其他收單行對照 |
| 不明代碼／一般交易失敗 | 保留代碼並顯示需洽永豐；不推論額度不足、卡片鎖定或持卡人操作問題 |

代碼依專案內《豐收款 API 開發規格書 V2.4》第 57–58、90–95 頁整理，共用 catalog 為 `payment-api/sinopac-status-codes.json`。僅收錄已核對的常用碼；未收錄項目會明確標示。`1C900` 等狀態的新增說明只用於診斷，不變更既有銀行付款認定邏輯。

「第 N 次付款流程」依 provider reference 的重試序號表示系統付款嘗試，不保證銀行已建單，也不是客人輸入卡號／OTP 的次數。相同 provider、來源與標準化銀行結果會以 SHA-256 去重；時間是首次觀測／保存時間，不是銀行交易或入帳時間。

摘要只在最新付款單內選擇明確交易結果，避免一般的成功查詢蓋掉既有明確失敗。不同付款單的結果留在歷史紀錄。訂單已付款或已有 paid_at 時會顯示提示，防止舊失敗被誤解為現在未付款；診斷不自動改訂單、付款、庫存或錢包狀態。

## 保存、來源與權限

新增獨立表 `order_payment_diagnostics`，只有 service_role 能寫入。匿名與一般會員不能直接讀寫；後台只能透過 `get_admin_order_payment_diagnostics(p_order_id)` 讀取，需同時通過登入、`is_eclado_admin()` 與 `orders.read` 權限。RPC 每次只回單一訂單最近 30 筆白名單欄位，不含銀行 provider reference 或去重 key。

捕捉範圍：一般建單、保留原訂單的重新付款、代客訂單付款、前台付款查詢，以及銀行通知／付款回站後的查證結果。銀行回覆只在解密、簽章驗證成功後解析；通知與回站從銀行查詢結果取值，不採用 callback body 宣稱的失敗原因。OrderPayQuery 需內層 OrderNo 精確符合 provider reference；OrderQuery 明細也需對應。不能綁定訂單的錯誤 Token 回覆不歸到任意訂單，以免惡意通知污染診斷。

傳輸／認證錯誤僅在已獲授權的建單／重新付款／查詢上下文記錄。取不到可歸屬訂單的銀行錯誤，仍只能由既有服務日誌／結帳事件查核。前台自己的付款存取憑證驗證失敗，不假裝是永豐錯誤。

資料只有來源、付款單次序、API 名稱、外／內層標準狀態、白名單格式的錯誤碼、信用卡回應碼、HTTP 狀態及系統產生時間。**不保存原始 Description、完整銀行 payload、API KEY、PayToken、CCToken、卡號、卡片效期、CVV2、付款網址、原始錯誤或 stack。** 後台說明從共用標準代碼表產生；無代碼的自由文字不會進入新診斷表。永豐 HTTP 錯誤也不再把完整上游 body 放進回傳錯誤。

診斷採非同步 best effort，寫入最多等 2 秒，失敗只輸出固定警告，不影響付款回覆與銀行通知確認。程序中斷或診斷寫入失敗仍可能漏記，不保證每次完整還原。資料依訂單生命週期保留；刪除訂單時外鍵 cascade 清除。去重可避免重複通知與同狀態查詢無限制增長，但每次不同銀行結果仍可能新增一筆。

舊銀行紀錄不回填；新 RPC 尚未部署或載入失敗時，訂單明細仍可使用並顯示診斷不可用。RPC 已就緒但無資料時顯示無法回溯未保存原因，不把「沒有紀錄」當成付款失敗。

## 部署順序

1. 隔離 DB 驗證後套用 `supabase-payment-diagnostics.sql`，以 `supabase-payment-diagnostics-verify.sql` 唯讀驗收。依賴既有 orders、auth.uid、is_eclado_admin、has_backoffice_permission。
3. 發布付款服務：新增 `sinopac-diagnostics.cjs` 與 `sinopac-status-codes.json`，更新 server.js、assisted-orders.js。既有 GitHub 發布包／白名單已同步調整；目前正式主機仍依 HOST-DEPLOYMENT.md 直接管理，勿誤以為 push 就更新主機。
2. 發布網站／後台。新的 adminOrders detail loader 以並行 RPC 取得銀行診斷，保留取消與切換訂單的 AbortSignal。
4. 以模擬銀行結果及唯讀 ACL／欄位投影驗收，不建立正式銀行交易。正式舊單仍可能顯示無詳細資料。

回復時可先退回顯示元件與付款程式版本，保留診斷表；不需回復付款／訂單／錢包函式。診斷表不可用不會阻擋原有付款主流程。

## 本地驗證（2026-10-23）

- 付款服務 70 項測試全部通過，包含真實加密／簽章 wrapper 的 401、簽章不符、有效銀行代碼擷取與診斷故障隔離。
- 隔離 PGlite PostgreSQL migration 可重跑；匿名／一般會員／缺少 orders.read 的管理員不能讀取 RPC；僅 service_role 可寫，已授權管理員只取得單一訂單最多 30 筆安全欄位。
- 桌機與手機 8 項檢查涵蓋既有訂單操作、API 成功但內層 3D 失敗、已付款訂單的認證錯誤提示，以及 RPC 不可用／舊資料缺少診斷的退化顯示。
- 完整 `npm run build` 與 SEO 預渲染成功；診斷寫入與測試未使用正式銀行交易。

正式 SQL 已於 2026-10-23 01:49 UTC 套用並驗收：RLS、17 欄、匿名／會員直連禁止、service_role 寫入、管理員 orders.read 守門皆通過。前後訂單數均為 104，診斷紀錄為 0。後續依使用者指定順序 commit／push 網站，再部署付款服務；部署證據另存 evidence。
