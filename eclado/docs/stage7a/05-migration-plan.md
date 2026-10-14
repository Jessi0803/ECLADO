# 正式Migration執行計畫（7A只規劃，未獲執行批准）

**目前No-Go。** 正式S1／1B／1C與購物金基線已存在，不重跑。先處理指定會員coupon相容性差異、完成測試Supabase／API整合、確認銀行契約／worker／backup，再取得7B具體安裝授權。下表時間為小資料量維護窗口粗估，不是本次正式計時；正式表量／鎖等待未讀取。單檔transaction與marker檢查不能自動修復任意半安裝版本。

## 各Migration：依賴、影響與安裝前檢查

| 次序／SQL | 必要依賴與安裝前檢查 | 新表／欄位／RPC／Trigger及既有函式變更 | 影響 |
|---|---|---|---|
| 已安裝S1 | 正式兩hash與EXECUTE再次確認 | ACL-only既有修補，不能回放舊payment-retry或shopping-credit-checkout覆蓋 | 付款權限基線；不重跑 |
| 已安裝1B／1C | 五表、12＋6函式、partial unique、OFF、角色能力／marker | 已安裝；只核對當下Schema，不重放foundation/full-setup | 會員／學生價基線 |
| 既有購物金 | accounts／ledger／reservations、reserve/consume/release/refund、defaults及13參數creator | 此次不重建；保存constraints／trigger／ACL及付款一致性公式 | 新錢包沿用原流程 |
| 2A `supabase-student-reward-snapshots.sql` | 1B/1C＋ordinary/assisted creator來源markers、專業價／SKU欄位、coupon問題已解；新表不存在或同型 | 一private snapshot、四helper、immutable trigger；patch create_order_with_pricing_discount_v2與create_assisted_order，原建單交易加快照 | 建單／會員價資格；不改既有優惠／庫存／購物金算法。新快照寫入失敗會回滾整個建單 |
| 2B `supabase-instructor-reward-ledger.sql` | 2A；不得已有snapshot卻缺state；orders status／paid_at／AuthFK | accounts/state/ledger/receipt四表、10函式／六trigger；pending、income、終止與profile刪除連動 | 訂單與刪會員新增既定限制；SQL不改銀行金額，API新證據接點需配套 |
| 3 `supabase-instructor-reward-queries.sql` | 2A/2B、admin能力引擎、會員姓名及order items型別 | 五函式，三受限讀RPC；不新增金融寫入 | 查詢，不改付款／會員／購物金事件 |
| 4 `supabase-instructor-reward-checkout.sql` | 2A/2B/3＋購物金checkout＋S1，原defaults/retry/claim來源marker及原CHECK；版本半安裝拒絕 | orders.reward_credit_amount=0、account.reserve=0、Ledgercycle/delta/after預設0，reservation/exception；wallet quote/create／service付款證據／failure；patch defaults/retry/claim／receipt／admin確認／報表／代客拒非零 | **付款／orders CHECK三項公式、兩錢包保留與狀態**；原購物金行為保留但共用上限受新check，需小維護窗口及服務版本協調 |
| 5 `supabase-instructor-reward-withdrawals.sql` | 完整4、permission CHECK、profiles刪除guard、keyring部署預備但新入口關閉 | bankprofile/calendar/withdrawal/event四表、14函式／四trigger；Ledger withdrawal來源／delta，patch收入／spend／刪戶guard／報表 | 錢包同帳戶金融結構／會員刪除／報表；不改學生售價／原付款／購物金 |
| 6通知 `supabase-instructor-reward-notifications.sql` | 5；無已成立提領卻缺Outbox的歷史，若有另准回補 | outbox/attempt兩表、queue event／claim／complete／補發／更正RPC、immutable與個資刪除trigger | 提領事件同transaction建Outbox；SQL不寄HTTP，外部失敗不改已提交帳務，Outbox INSERT故障則提領交易回滾 |
| 6對帳 `supabase-instructor-reward-reconciliation.sql` | 完整2A～6通知、所有金融欄位；新表無異形 | run/finding兩表、private checks、受限run/read RPC；financial sources只讀 | 不修帳；大庫掃描／timeout需實測 |

## 每步操作門檻、驗證與失敗回復

以下適用所有待安裝2A～6步驟：每步開始／繼續都需在使用者批准的7B清單範圍內；沒有批准不能執行。S1/1B/1C只驗證不再安裝。

| 階段 | 建議窗口／粗估SQL時間 | 安裝後驗證 | 失敗處理／安全回復 |
|---|---|---|---|
| 2A | 建議暫停新建單數分鐘；1～30秒SQL，正式未測 | `supabase-student-reward-snapshots-verify.sql`、OFF、四helper／表封閉、creator marker／非目標指紋 | 失敗ROLLBACK；確認狀態後才重試。已提交回復兩creator須保留快照歷史，先阻止新快照 |
| 2B | 與2A同一批准窗口，1～30秒 | `supabase-instructor-reward-ledger-verify.sql`、state/ledger/account、S1、Trigger啟用 | 保留金融表與receipt；停止新業務，不降到無法理解已有pending/credit的程式 |
| 3 | 通常無需全站停機，1～10秒；負載待測 | `supabase-instructor-reward-queries-verify.sql`、read能力／白名單 | 撤新讀RPC／UI，不刪帳務 |
| 4 | **建議暫停新建單／重試，既有銀行回呼不可任意丟棄**；1～120秒，ALTER/CHECK可等待orders鎖 | `supabase-instructor-reward-checkout-verify.sql`、三項CHECK、舊單rc0／S1／新RPC／API兼容 | 保留未結hold與第三錢包欄；停止新wallet入口／EXECUTE，讓相容API完成既有義務；不可直接降舊付款server |
| 5 | 暫停新金融操作及角色刪除，1～120秒 | `supabase-instructor-reward-withdrawals-verify.sql`、四delta與after、sourceCHECK／權限 | 保留withdrawals／cipher／keyring／保留款；既有pending/processing/unknown繼續授權人工結算，不自動退回 |
| 6通知 | 首筆提領前安裝完整；1～30秒 | `supabase-instructor-reward-operations-verify.sql`通知ACL／RLS／trigger／OFF | 停worker與補發；保留Outbox／attempt／源事件；停trigger造成漏事件必須另准處理 |
| 6對帳 | 通常不需全站停機；1～30秒，掃描時間另計 | 同operations verify＋完整financial checks；不能略過history unknown | 停新掃描，不刪run/finding、不清未驗證舊異常 |

每個verify含READ ONLY＋ROLLBACK。2A～6 verify通常引用新表，未安裝時不能直接在正式整份執行；先Metadata確認存在。表量較大、鎖等候或query被逾時，先保存結果查實是否已commit；網路逾時不代表DB回滾，不能盲目重跑。

安裝前保存當下完整原定義／owner／ACL／CHECK／Index／trigger enable狀態與hash；不能拿2026-10-12備份覆蓋10-13新定義。避免`supabase-full-setup.sql`／舊coupon／舊付款整包重放，沒有完整migration_history不能靠檔名推定已裝。

本次真SQL以已知fixture升級2A→2B→3→4→5→6通知→6對帳、重跑與verify通過；正式coupon差異已另重現。沒有完成完整正式Schema／資料clone的升級與rollback演練，仍是7B前置。
