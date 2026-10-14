# 7A本次重新執行的完整測試矩陣

日期2026-10-13，所有交易在新隔離cluster／PGlite／Mock；不沿用歷史通過數作本次證據。

| 批次 | 本次結果 | 執行與限制 |
|---|---:|---|
| PostgreSQL17.6七檔 | 69passed／0fail／0skip | 1B63（含父測試）＋2A／2B／3／4／5／6各一整合測試；不同PID／row lock／SKIP LOCKED／deadlocks0。非69個互不重疊業務規則。 |
| PGlite十一檔 | 12passed／0fail／0skip | foundation含2測試；普通定價、代客、S1、1C及2A～6實際SQL與verify。非多連線證明。 |
| API／通知十檔 | 70passed／0fail／0skip | bank7、worker13與原付款通知／催款／取消／季度／申請通知／刪會員；外部全Mock。 |
| Payment API | 55passed／0fail／0skip | 無.env暫存副本、假商店與mock fetch；真實HTTP授權邊界，銀行／Supabase上游Mock。 |
| Playwright17檔桌面／手機 | 首次589pass／12fail／3skip；原12最後重測全pass | 604選定案例；最終獨立case覆蓋601pass＋3skip，不稱單一全綠604批次，不把中間失敗計入pass。 |
| SQL靜態檔 | 118passed／0fail | 只證明來源contract／marker／ACL語句存在，不替代runtime權限。 |
| 既有完整本機清單 | 20passed／0fail | 5191新PGcluster＋實際桌面UI；假Auth／RPCbridge／銀行／通知。原5181資料保留。 |
| Formal creator缺陷重現 | 1test passed；業務情境FAIL | 指定會員coupon quote接受但create22023；新訂單數不變。不能把「抓到缺陷」算結帳正常。 |
| Schema導出／比對 | 完成 | 1C基線＋2A～6真SQL導出、15新表正式皆不存在；不等於正式全schemaclone。 |
| Build | exit0，466modules、1假商品／8文章 | loopback目錄；既有大chunk及關閉SEO harness引起dependency scan警告保留。不是正式商品或preview整合測試。 |
| 語法／diff／敏感資訊 | 通過（最後核對） | 無Lint script，不宣稱Lint通過；假fixture密碼／key不是正式憑證。 |

## 原12個UI失敗與修正

3個商品建立／失敗案例＋多圖上傳都把文字bytes冒充圖片，不能解碼；改真1x1 PNG且驗證實際WebP輸出。必填alert selector與會員價格alert重疊，限定「無法儲存商品」。季度統計需先切「專業資格」。staff舊案例預期無任何最低額提示／會員須知，與既定最低5000固定免運規則相反；改驗證最低額提示、購物規範及無追加內容。僅修改`tests/admin.spec.ts`、`tests/eclado-frontend.spec.ts`，未改產品規則或放寬驗證。

中間重測仍有staff selector／文字預期失敗，保留log；最終12case才全通過。檔案內修正不表示main缺JPEG功能已補進分支。

## 業務覆蓋矩陣

| 區域 | 實際證據 | 尚缺 |
|---|---|---|
| 六會員角色／學生pro／admin與super_admin | PG1C／foundation／queries／withdrawals；UI會員／後台／唯讀 | 真Auth／PostgREST與各role全頁面獨立排列未全部逐一實測；admin不是新增商品價role。 |
| 列表／詳情／SKU／購物車／變價與舊價 | student-pricing及frontend MockUI＋quote/create真SQL、focus刷新 | 真Realtime publication／跨瀏覽器長期快取。 |
| 最低額／運費／活動／券／贈品 | 1C／代客benefits及checkout DB，UI既有回歸 | shipping appendable group仍有fixture stub；正式指定會員coupon存在已重現缺陷。 |
| 兩錢包／付款retry／退款 | PGcheckout、API55、UIcheckout | 真銀行元／分、卡／ATM／Apple／Google回呼與完整真Auth鏈。 |
| 快照／Ledger／歷史／換綁／刪戶 | PGsnapshots／ledger／queries、RLS角色拒絕及immutable／MVCC | 原代客Auth刪戶衝突未修；非返饋舊晚付款復活獨立列管。 |
| 銀行／提領／手續費／calendar | PGwithdrawals、crypto／rotation7、UIdesktop/mobile、清單20 | 真銀行帳號身份驗證、真匯款、正式calendar及secret復原。 |
| Outbox／LINE5xx／timeout6次／補發 | PGnotice、worker13、UIoperations、清單20 | 真LINE／Resend發送／可達性／實際排程。 |
| 財務對帳 | PG異常rollback注入及唯讀查核、20清單 | 真實資料量與大庫掃描成本；不自動修帳。 |

本機完整清單20組是桌面；手機由相應Playwright mock案例覆蓋，不宣稱同一PGbridge清單在手機重跑。真銀行、正式通知、正式測試訂單均未執行且本階段禁止。

## 可重現指令與log

主要指令見[commands.json](../evidence/reward-stage7a/commands.json)。[postgres.log](../evidence/reward-stage7a/postgres.log)／[pglite.log](../evidence/reward-stage7a/pglite.log)／[api-mocks.log](../evidence/reward-stage7a/api-mocks.log)／[payment-api.log](../evidence/reward-stage7a/payment-api.log)／[playwright.log](../evidence/reward-stage7a/playwright.log)／[最後12case](../evidence/reward-stage7a/playwright-recheck-accepted.log)／[靜態SQL](../evidence/reward-stage7a/static-sql.log)／[清單20](../evidence/reward-stage7a/manual-full.log)／[Build](../evidence/reward-stage7a/build.log)。
