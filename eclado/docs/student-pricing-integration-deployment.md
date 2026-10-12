# 階段 1C｜學生價格及代客 AUTO／MANUAL 整合

本階段在本機／隔離資料庫驗證；尚未正式套用、部署或開放學生價格。正式學生價必須保持 OFF，直到 2A 訂單返饋快照與 2B Ledger 驗收及使用者批准。

## 已核對的前置條件

2026-10-12 曾透過正式 SQL Editor 執行 BEGIN READ ONLY／ROLLBACK：1B 三張業務表的欄位、instructor_student_context(uuid)、既有一般／代客報價與建單接點相容，1C feature 表尚不存在。沒有呼叫正式建單或寫入業務 RPC。

| 函式 | 當時完整定義 MD5 |
|---|---|
| quote_order_pricing_internal_20260916(jsonb,text) | 3c290cac55a4a5fecc06c4e8fdb408ab |
| quote_assisted_order(jsonb) | bacb6afeeb0e979ceb604687cd3ea725 |
| create_assisted_order(uuid,jsonb) | c8d2f2e431ad2ed7ede19117c066bac6 |
| instructor_student_context(uuid) | 40f604f00467fdf56b69d7f1a60f5dec |

正式部署時仍須重新核對當下定義、完整相依 Schema／ACL／Trigger，不把此一次核對當成永久基線；正式沒有完整專案 Migration 歷史。

## 設計與修改範圍

- 新表 student_pricing_feature_settings：singleton、enabled 預設 false、version、updated_at；RLS 開啟，客戶端無直接讀写。沒有客戶端開關設定 RPC／UI。
- student_pricing_multiplier(uuid) 私有核心：由 1B 關係、角色、老師類型、全域折數、有效 pro tier 與後端開關決定倍率。不信任前端角色／折數。
- apply_student_price(numeric,numeric)：沿用既有美容師單價，先使用既有 rounding，再乘學生倍率並 round；優惠引擎後續處理不改。
- assisted_auto_unit_price(uuid,text,products,product_variants,numeric)：保留既有代客系統建議價的商品個別／全域回退，學生 pro 再套同一倍率／round 核心。沒有修正既有師資回退差異。
- get_my_student_product_prices()：本人專屬商品／規格最終學生單價；匿名與不適用會員回 enabled=false，不提供任意會員 ID、師資比較價、老師識別或返饋資料。
- 修改三個既有函式：內部一般基礎報價、quote_assisted_order、create_assisted_order；以來源標記插入，不重寫活動、優惠券、贈品、運費、最低額、庫存、購物金或付款函式。新增 helper 皆使用空 search_path／明確 schema，內部 EXECUTE 封閉。
- 新 14 參數 create_order_with_pricing overload：沿用原 13 參數交易建單／發票／購物金；比對已確認的商品價格／數量／優惠／運費。若不符，整筆交易回滾，不進入付款 API。student_price_confirmation(jsonb) 只是在記憶體比對公開成交報價，不建立返饋快照。
- 舊一般 RPC overload 仍保留；新前端只有確認 DB 缺少 1C RPC 時才回退舊入口。已存在 1C 本人價格 RPC 但新建單入口缺失時拒絕，不把部分安裝當成舊環境。

## 代客模式與相容

- AUTO：後端計算；unit_price 只可作 UI 暫時參考，不作 AUTO 售價來源。新 AUTO 建單須有 expected_quote，沿用既有防重 request_key／完整 raw payload 保存與恢复；不先轉換 raw payload 破壞防重比較。
- MANUAL：管理員明確選擇或實際編輯單價，後端維持既有權限及指定整數價驗證；即使與建議價相同也不推測為 AUTO。
- 沒有 price_mode 的舊請求維持原指定價，不自動套學生折扣；既有代客優惠選擇、購物金同意、庫存保留及付款分享行為保留。
- 有效模式保存於新的代客商品成交行與既有 request pricing_context；不新增師資／學生折數／返饋快照。
- quote 回 price_modes_supported=true。舊後端沒有此訊號時，前端阻擋 AUTO，不默默當成 MANUAL；管理員可明確選擇 MANUAL。錯誤提示引導先完成 1C DB 安裝。
- 代客建單所有商品與總額採同一份權威 benefit_quote，避免使用迴圈先算的舊 subtotal 搭配重新報價後的新單價；原建單／庫存／購物金交易維持。

## 前端與刷新

- 商品列表／詳情／規格及購物車共用 getMemberPrice；學生價格來自本人 RPC 的 unit_price，且綁定目前 uid，切換帳號不沿用他人價格。
- 登入／登出、角色異動會重新載入；focus／visibilitychange 重讀資格及價格，不依賴正式未加入 Realtime publication 的規格／圖片表。
- 過期會員資料請求有 sequence 保護，避免登出或切換身份後晚回應覆蓋目前身份。
- 結帳送出前 quote；價格或優惠／運費變動需明確確認，商品 expected_unit_price 由最新後端 quote 取得。建單後再次比對確認報價可回滾變動。
- 學生價 RPC 網路／授權錯誤顯示失敗，不當成 OFF。只有缺少 1C 的 PGRST202／42883 做明確舊環境相容。
- 代客模式／金額變更與 focus 重新預覽；submit 再次 quote 及确认。

## 安裝、驗證及回復

1. 先完成 1B 後台人工驗收、1C 隔離驗收，再取得本階段正式安裝批准。
2. 核對 1B、原 13 參數購物金建單 overload、會員定價、代客優惠、權限、四個來源標記與原函式／ACL 指紋；保存被改動的三個函式完整原定義／ACL。
3. 執行 supabase-student-pricing-integration.sql；安裝預設 OFF，無前端或管理員 UI 能啟用。
4. 唯讀執行 supabase-student-pricing-integration-verify.sql，所有布林 true；確認 S1、付款／庫存／優惠／購物金函式及 Trigger 未變。
5. 前端部署另行批准。順序建議先 DB（OFF）、後 UI；未安裝時新 AUTO 會顯示明確錯誤。
6. 同版本 SQL 可重跑並保留已存設定，不是任意舊 1C 版本的自動升級工具。若同名物件存在，先核對形狀與定義。
7. 需要回復時，先令後端 OFF、回復前端；經獨立批准後可恢復已保存三個原函式定義／ACL並撤銷新入口。保留 1B 關係／歷史及既有訂單，不刪除歷史、不重跑舊全專案初始化。

## 驗證範圍與剩餘限制

測試同時使用 PGlite 與獨立 PostgreSQL 17.6，採實際既有函式來源；fixture 模擬 Auth／角色與部分 Schema，沒有正式憑證。PostgreSQL 獨立管理員／買家連線覆蓋未提交類型隔離、變更後報價及 stale 建單回滾；不宣稱窮盡所有排程。

Playwright 使用 mock API，覆蓋學生價格／規格／購物車、focus 刷新、缺少 SQL、讀取失敗、AUTO／MANUAL 與舊後端保護。正式 Auth／PostgREST／LINE／管理員人工操作仍待驗收。一般訂單保留既有同步提交 ref 與付款恢復，未新增後端 request-key 冪等；代客 request-key 防重沿用原實作。

沒有設計或啟用 2A／2B 返饋帳務。不得僅因 1C 測試通過就啟用正式學生價。
