# 學生價／雙十一／師資返饋：正式發布前核對

核對日期：2026-10-30。正式資料庫快照時間為台北 22:15:24。本次為第一步唯讀核對，未安裝 SQL、部署、修改活動、開啟新功能或呼叫銀行。

## 核對結論

- 相關 9 個函式來源與權限符合 TEST 已驗證版本，沒有發現阻止準備發布的計價版本差異。正式尚無新政策資料表及兩個活動欄位。
- 正式既有自動活動分配引擎為 true、學生價功能為 true，學生價設定為 0.9／0.95。新政策首次安裝須 false。正式已安裝 storefront display 前置包裝，**不重跑 TEST 曾補裝的前置 migration**。
- 擬修改 9 筆美容師活動的兩個政策值為 false；1 筆師資／經銷商活動保持原設定。活動時間、對象、門檻、公式、商品範圍、優先順序及優惠券關聯保持不變。
- 尚未形成獨立發布提交。工作區有其他未提交變更，下一階段須隔離本功能，再驗證精確候選版本，不能直接 `git add -A`。

## 正式執行版本

| 項目 | 唯讀核對結果 |
|---|---|
| Git main／本機基準 | `c471584e4dddf318221291947ce9203bbc48f8c9` |
| Git develop | `888dd5b90db2572027fb0da52be5fd9d3292db13`，不是本次正式發布基準 |
| Vercel 目前 Production | `dpl_4EDNjBX5B2Ym56o28Aquv1tPM43h`，Ready，正式網域 ecladotaiwan.com，來源同 main |
| 正式 Supabase | `ilvdvlkdpntwmaijncaz`，PostgreSQL 17.6；相關 9 個函式 MD5 及 ACL 皆符合已測來源 |
| 付款 API | 內／外 health 正常，PM2 PID 2327559；server.js 與 assisted-orders.js 雜湊皆同目前 HEAD |

付款主機只讀取兩個程式雜湊、PID 及 health，未讀取 .env、重啟或部署。Vercel 從 Project Overview 的目前 Production 核對，沒有沿用原先開啟的舊部署詳情頁。

## 擬套用政策的活動（尚未修改）

兩個政策均擬設為 `allow_student_price_stacking=false`、`instructor_reward_eligible=false`。以下 ID 為精準目標，不使用名稱批次更新。

| 商品／商品組 | 活動 ID | 買贈 | 開始（台北） |
|---|---|---|---|
| C.P 50 安瓶組 | `06906fd2-a796-4db2-9bd8-8397e9360f2e` | 買3送1 | 11/01 00:00 |
| 保濕補水霜 | `130e6ba0-4111-4e17-9564-f2ac14d24d8a` | 買3送1 | 11/01 00:01 |
| 乳酸菌益膚面膜 | `1876ed80-ca9c-44ee-bb05-4c47ddae6799` | 買3送1 | 11/01 00:01 |
| 溫和增效潔面乳 | `49572111-a383-4cd4-a116-ad9ff30d3f47` | 買3送1 | 11/01 00:01 |
| 記憶修護霜 | `daf857ba-df5f-48ee-9875-ade66941edda` | 買3送1 | 11/01 00:01 |
| 極致珍珠緞面膜 | `e1ac15b9-8050-47ce-9046-5f0b83e7e38a` | 買3送1 | 11/01 00:01 |
| VONO 喚膚調理組 | `bc5aea6c-088b-46ab-addb-fb4071412f90` | 買4送1 | 11/01 00:00 |
| 呼吸雪霜、爽膚水、安瓶、精華液 | `ced451c6-c8e7-4bdd-8835-35398e5e04a1` | 任5件送1件 | 11/01 00:00 |
| 棉花水光管理 | `9be5e4f9-f0d4-460e-a054-7a1aba1ca4ca` | 買4送1 | 11/01 00:00 |

9 筆目前皆啟用、repeat、僅 pro 適用，結束時間皆為台北 11/11 23:59。每筆資格與受益範圍一致，只有指定 product include，沒有 variant、exclude、category 或 series 混合範圍，coupon links 均為 0。前 6 筆同名「TOP熱銷商品-買3送1」分屬不同商品，不合併為任選成組。

保留不變：`2a559e1a-ccbe-4c8b-a86e-b9808549369c`「11.11 限定｜TOP熱銷商品-任選6件送1件」，師資／經銷商適用、11/11 00:00 至 23:59，六個指定商品共組買6送1。

VONO、棉花水光及呼吸活動名稱提及矽膠刷／化妝棉；此正式快照的 10 筆都是買贈折價，沒有獨立 gift_variant 配置。本次保留既有資料，不依文案自行建立贈品規則。若營運另存新贈品活動，上線前須重查清單。

## 其他有效優惠

- 「急救安瓶三盒折300元」：完整 8 個資格／受益 scope 僅含商品 107、108、109、110，與上述 9 筆雙十一受益商品不重疊。原設定保留，新欄位沿用 true 預設。
- 「叫貨9折優惠」為 coupon_only、全館 all_sellable，連結有效「9折優惠卷」，stacking_policy 為 allow_auto_gifts。維持既有移除自動價格活動、保留自動贈品的規則；移除活動時恢復學生價與返饋，不將優惠券或運費納入新擇優。隔離候選回歸須明確覆蓋此正式優惠券模式。

## 發布條件與回復基準

1. 下一階段先形成獨立功能提交／不可變候選。17 個執行及測試檔的 SHA256 已記於證據檔。Home、Contact、Login、ResetPassword、Shop、Cart 及既有 auth／frontend 測試中的其他工作區改動，不整批帶入；依實際 diff 隔離。文件與驗收 SQL 可隨功能提交，環境檔、私有備份與無關截圖不納入。
2. 正式變更前重查函式 MD5、活動 updated_at、scope_digest 及 coupon links；任一改變即重新核對。111 筆訂單、1 筆快照、7 筆 Ledger、18 筆 adjustments 僅為盤點值，**不把業務筆數作為正式安裝鎖定條件**，避免阻擋正常客戶交易。
3. 增量 SQL 安裝新開關 false 後，部署配套 API 與前端，檢查 verify、價格加回投影及過期報價；成功後再套用上列 9 筆政策並啟用新開關。不得重跑舊 setup 或以 TEST 全庫覆蓋正式。
4. 正式功能回復時只關 `promotion_student_policy_settings.enabled`；保留原本 true 的 `automatic_price_allocation_settings.enabled`。不仿照 TEST 的雙開關 false，避免關掉原有多活動計價。保留已建單快照、調整列與帳務，不刪欄位、不回算歷史。
5. 本次沒有實交易銀行驗收，也沒有承諾付款主機零停機。後續若安排實交易，須用受控訂單並由付款人完成付款。

函式來源、完整目標的 updated_at／scope_digest、候選檔案及部署雜湊見[機器可讀證據](evidence/promotion-student-policy/production-preflight-20261030.json)。原始查詢 CSV 保存在 gitignored 私有目錄，SHA256 為 `310487fd28639dc82d564a3da106c7e862de1e0944cd7f08c24947b0a66fa2d2`。
