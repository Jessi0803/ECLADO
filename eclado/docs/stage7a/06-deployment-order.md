# 建議正式發布順序（待使用者批准）

沒有直接Vercel deploy/promote/alias/rollback；前端及serverless發布／回復只走已批准Git整合。Payment API和worker的Git自動發布尚待確認／建立，不能用SCP／SSH手動更新取代已約定流程。

1. 完成5／6使用者接受、指定會員coupon最小相容修補與main JPEG修補同步決策。7A只回報，不自行修改產品或Git歷史。
2. 建立隔離測試Supabase：重建真實兼容Schema、fake Auth會員／商品／訂單、Storage假圖片；preview frontend／serverless／付款proxy／callback／notifications／SEO目錄／OAuth redirect全部分開。禁止正式APIfallback；7A只列計畫，未建專案。
3. 隔離安裝最新候選全部SQL，再做真Auth／PostgREST、card/ATM/apple/google mock、原購物金／代客／追加出貨群組完整整合。這次fixture有shipping stub，不能將其測試當成完整Supabase環境。
4. 選定worker A/B與最小能力方案，配置**測試**env／排程／日誌，演練無key、舊key、失敗與unknown恢復。Vercel既有Cron只GET，現POST worker需獨立timer或另准adapter，不能直接掛原Cron。
5. 正式backup及復原演練完成，核對當下Metadata無新差異。確認維護窗口、既有未付款／金融義務、舊站相容與收款回呼的不中斷策略；取得7B書面範圍及SQLhash批准。
6. 先發布**相容新舊DB**的Payment API候選經批准Git管道（PGRST202相容分支已有Mock，還須真staging核對），保持新入口與學生價OFF；再在批准窗口按05安裝2A～6並逐步verify。若選DB先API後，必須明確停止新學生／wallet義務，且沒有新單落入舊API，不能只靠學生價OFF。
7. 配置正式銀行keyring、完整2026/2027 calendar、LINE／Email／管理員名單與獨立worker；單獨批准，不能在7A執行。新提款入口保持停止到全部依賴可用，需批准受控停用方式（不是現有学生價開關）。
8. 經Git發布相容UI／serverless，驗證Production commit、功能OFF、API版本與SQL契約；回呼、查詢及授權檢查使用批准的方式，不自行建立正式測試訂單／付款。
9. 再取得7C啟用與正式交易驗收授權，驗證後才啟用學生價。既有義務不能因OFF而停止處理；若分批啟用，需要另外設計後端可控開關與限定資格，不假設目前已有灰度開關。
10. 觀察銀行證據／order/ledger/hold／通知unknown／worker tick／對帳；任何價格或財務不一致停止新功能，依09相容回復，不DROP／不刪金融資料。

這是建議方案，不是已確認部署決策，也不是7B／7C已完成證據。
