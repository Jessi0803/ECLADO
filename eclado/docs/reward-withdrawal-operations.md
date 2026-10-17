# 提領管理補強：批次 CSV、合計、搜尋與匯款表單

2026-10-15，本機驗證完成；使用者批准後已套用 test Supabase，新版程式將以本次 Git push 自動部署 Preview；正式 Supabase 未變更。

## 已確認規則

使用者確認通用 CSV，包含申請編號、老師、銀行代碼／名稱、分行、戶名、完整帳號、實匯金額與批次日期；不製作特定銀行上傳格式。只匯出選定名目批次的 pending／processing，排除 paid／failed／unknown。管理員需 rewards.withdrawals.manage；保留稽核。匯出不領取、不匯款、不改狀態。批次合計與匯出使用相同範圍，不受名單搜尋／狀態篩選及分頁影響。

## 檢查結果與修改

既有 `get_admin_reward_withdrawals(integer)` 只回20筆，無搜尋／批次合計；`read_reward_bank_cipher(uuid,uuid)` 逐筆讀取申請快照並記錄敏感資料查看；`RewardWithdrawalsPage.action()` 透過三次 prompt 收集 paid 憑證。`manage_reward_withdrawal()` 已驗證處理人、version、實匯額、日期及冪等 event key，沿用不修改。

- `supabase-instructor-reward-withdrawal-operations.sql`：新增獨立加法 Migration，前置為階段5。原查詢RPC、帳戶、Ledger、匯款狀態與通知不改動。
- 新表 `instructor_reward_withdrawal_exports`：記錄actor、時間、批次、筆數、實匯合計及該次ID／version／status／processor／金額manifest；不保存明文銀行帳號或cipher。RLS開啟、無客戶端policy，撤銷四角色直接存取；update／delete拒絕。
- 新RPC `get_admin_reward_withdrawal_queue(integer,date,text,text)`：authenticated入口＋原管理員read檢查，後端literal姓名／申請UUID子字串搜尋、狀態與batch_date篩選、全結果總數及20筆分頁。回傳遮蔽投影、批次選項與完整批次待處理合計，不回傳cipher。
- 新RPC `export_reward_withdrawal_batch(uuid,date)`：僅service_role可執行，並再次核對actor是有效admin／super_admin且有manage。單一SQL statement snapshot取該批次pending／processing，並寫入相同集合的稽核manifest。不以客戶端ID清單、金額或姓名決定匯出內容，不鎖定處理權。
- `supabase-instructor-reward-withdrawal-operations-verify.sql`：唯讀RLS、ACL、SECURITY DEFINER／空search_path與不可修改稽核檢查。
- `api/reward-bank.js`：新增export動作，先驗Auth，actor來自真實user.id；server-only RPC取快照，沿用owner AAD與AES-GCM解密。完整生成成功後才回傳CSV，任何一筆失敗不回部分檔；no-store、附件、nosniff，錯誤不洩漏帳號或crypto內容。稽核表示資料讀取嘗試，不代表瀏覽器成功下載或已匯款。
- `api/_reward-withdrawal-csv.js`：UTF-8 BOM、CRLF、引號逸出、公式字元防護。銀行代碼／帳號加文字前綴保留前導0；這是核對清單，不是銀行上傳格式，不可移除格式後直接當銀行匯款指示。
- `src/services/rewardWithdrawals.js`：新增queue與CSV Blob下載，既有RPC方法保留。
- `src/admin/pages/RewardWithdrawalsPage.jsx`：批次／狀態／老師姓名與申請編號篩選，改篩選回第1頁；共用刷新保留篩選與頁碼。選批次顯示筆數、申請額、手續費、實匯合計與manage-only匯出。下載不批次領取、不改匯款狀態。
- `src/admin/components/WithdrawalPaidDialog.jsx`：以網站表單取代paid的三次prompt。日期選擇、必填與格式檢查、120字交易序號、正整數實匯且須符合快照；返回／Esc保留該筆草稿於記憶體，切換管理員清除。送出仍用原RPC／version／event key；結果不明仍重送相同資料，不再次匯款。失敗／待查帳／更正的既有操作未改。
- `src/components/account/InstructorRewards.css`：局部批次篩選與表單樣式。
- `scripts/reward-acceptance-local.mjs`：隔離站安裝新SQL、允許新RPC／假CSV路徑，可指定REWARD_ACCEPTANCE_PORT，不讀產品Vite設定或.env，只bind loopback、同源mock與CSP。此是假Auth／假外部服務，不能代表正式身份或銀行整合驗收。
- 測試：`tests/instructor-reward-withdrawals.spec.ts`、`tests/instructor-reward-operations.spec.ts`、`tests/integration/reward-bank.test.cjs`、新 `tests/integration/reward-withdrawal-operations-db.test.cjs`。

另前一項老師端用語／停用原因／提領確認視窗仍未提交，紀錄於 `docs/reward-admin-management-ui.md`；不是本次新增的業務規則。

## 實際測試證據

1. `node --test tests/integration/reward-bank.test.cjs`：9／9。含CSV公式防護、帳號前導0、真實Auth actor來源（上游模擬）、缺權限拒絕、解密失敗不輸出部分檔。
2. `EMBEDDED_POSTGRES_MODULE=/private/tmp/eclado-1b-postgres-tools/node_modules/embedded-postgres/dist/index.js node --test tests/integration/reward-withdrawal-operations-db.test.cjs tests/integration/instructor-reward-withdrawals-db.test.cjs`：2／2，真 PostgreSQL17.6、無跳過。新測試29筆／2頁、26筆待匯款或處理中、跨頁合計、排除3種狀態、字面搜尋、空批次、非法條件、cipher不出現在一般查詢、不可變稽核、RLS／EXECUTE、同時匯出各自稽核、金額／Ledger不變。原提領兩筆申請、購物競爭、退貨競爭、收款與取消等相依回歸通過，deadlocks=0。
3. 新唯讀verify SQL加入DB測試後單獨再跑：1／1，全部verification=true。第一次撤權測試刪除了admin能力，但fixture實際是super_admin，修正測試撤銷實際角色能力後通過，未放寬程式授權。
4. `BASE_URL=http://127.0.0.1:5185 npx playwright test tests/instructor-reward-withdrawals.spec.ts tests/instructor-reward-operations.spec.ts --project=chromium --project=mobile-chrome --workers=1`：最終62／62，API mock。含下載事件與檔名、後端條件、批次合計不受篩選影響、read-only無匯出、表單驗證／草稿／原key重送。初輪60／62，選單缺明確aria-label導致exact label無法定位，修正後重跑全檔通過。
5. `REWARD_ACCEPTANCE_PORT=5192 EMBEDDED_POSTGRES_MODULE=... node scripts/reward-acceptance-local.mjs`＋暫存 `/tmp/eclado-withdrawal-queue-smoke.cjs`：本機網站＋真正隔離SQL＋加密銀行假資料，實際經老師儲存銀行→申請提領→管理員批次合計→CSV下載與解密→領取→表單記錄模擬匯款→批次剩餘0筆，1／1通過，阻擋所有外部請求。不是正式銀行匯款／正式Auth驗收。
6. `npx vite build --mode test`：471模組通過，既有chunk警告。Node語法與git diff --check通過。專案無獨立Lint script。

## 套用順序、回復與限制

本次不授權雲端套用或push。後續經批准，在已裝階段5的環境先套用新operations SQL→唯讀verify→以Git自動部署相容API／前端；2A→2B→3→4→5的原相依不變，6通知／對帳可先已存在。未安裝新SQL時新版管理頁明確顯示查詢更新尚未安裝，不會用前端20筆資料假裝完整查詢。不要只push新版前端到尚未安裝新RPC的Preview。

回復時透過Git回復前端／API至舊版，舊查詢RPC仍保留；必要時另經批准撤銷新RPC EXECUTE以停用匯出，保留所有匯出稽核，不刪除歷史或動帳，不需要回復餘額。

CSV是匯出當下的清單，不是凍結批次或匯款鎖；下載後可能有其他管理員處理或新狀態，實際匯款前仍需領取與核對最新狀態。下載到電腦後無法靠網頁focus清除，應由授權人員保管；後端不保存明文檔或把帳號寫進日誌。數千／數萬筆容量與真銀行檔案格式未驗證，正式Auth／雲端金鑰／下載、銀行實際交易均未驗收。現有scripts/reward-acceptance-full.mjs是舊UI流程，未於本次重寫或宣稱通過；本次改以新增暫存煙霧腳本驗證新流程。


## test 套用及本次 Git 發布（2026-10-15）

使用者已明確批准test Migration及commit／push，並於敏感資料入口權限變更的執行時確認僅限test。已在Supabase SQL Editor核對URL為qqlgqasbmbicnmvnlqbr、專案顯示test，PostgreSQL17.6，階段5表／管理權限／不可變歷史／投影前置皆存在。安裝前新audit表不存在，test學生價原為ON，保留不改；正式開關與正式資料庫不動。

已執行supabase-instructor-reward-withdrawal-operations.sql，結果Success. No rows returned；再執行原唯讀verify，七項全部true：audit_rls、queue_no_anon、immutable_audit、empty_search_path、export_service_only、queue_authenticated、audit_no_direct_access。SQL Editor紀錄a91f5a73-119d-40a1-b1f6-14d9316a4277，證據docs/evidence/reward-withdrawal-operations-test-verification.png。未在雲端建立測試訂單、提領或銀行交易，也未匯出test帳號資料。本段取代前述開發期間「尚未授權／未套用test」的狀態。

本次Git提交包含老師提領呈現及本補強程式／Migration／測試／文件，目標codex/instructor-student-rewards，推送由Git自動部署Preview；不合併main、不直接操作Vercel部署。三個無關檔案tests/admin.spec.ts、tests/eclado-frontend.spec.ts、.claude/launch.json排除。Preview實際登入／CSV下載仍待新版部署後驗收，不把本次Metadata驗證當成雲端完整流程驗收。


## test MOCK 資料（2026-10-15）

使用者批准建立多筆mock提領，已於test qqlgqasbmbicnmvnlqbr新增30筆，保留原1筆，Preview共31筆。全部歸TEST師資，使用既有假銀行快照以維持CSV可解密；不新增Auth帳號。批次2026-09-10／10-10／11-10；pending5、processing6、paid6、failed7、unknown6。requested事件包含MOCK_WITHDRAWALS_20261015_V1及MOCK測試編號，模擬匯款序號MOCK-NO-BANK-*。29筆專用商品來源訂單經原quote/create、管理員模擬收款、delivered正式入帳，再沿用post_reward_withdrawal／manage_reward_withdrawal完成保留與模擬終態；退回的假收入另由對應來源訂單returned抵銷。原有申請未更新；原可用餘額1280及普通購物金保留不變，新待處理申請的提領保留有對應Ledger。新MOCK商品建立後已隱藏，原商品規格庫存仍為6。

首次test批次因會員每15分鐘8筆建單限制而整筆回滾；唯讀核對mock_rows=0、新商品不存在、餘額1280。修正版僅此postgres資料腳本以交易區域的既有service_role受信任路徑建立，未停用、修改或移除限流Trigger，也未改任何一般會員權限。加入真實限流Trigger後於隔離PostgreSQL17.6重跑1／1通過，含30筆三批次、五狀態、原餘額／原庫存、禁止重複執行、完整對帳無新增非預期異常（unknown本來就需人工查核）。

僅本次MOCK提領通知設blocked／next_retry_at=infinity，避免通知老師或管理員，未發出銀行／LINE／Email請求。test查詢13c0989e-d42a-4bc3-8acf-5fcca006670c核對mock_count30、available_balance1280、mock_product_hidden=true、original_test_stock6、notification_delivery_paused=true；證據docs/evidence/reward-withdrawal-mock-fixtures-verification.png。Preview已刷新，11月批次列表11筆（含原1筆），其中pending／processing3筆，申請合計4480、手續費45、實匯4435。未在Preview執行匯款或下載完整銀行檔。

新增test-only腳本docs/reward-staging-upgrade/08-test-withdrawal-mock-fixtures.sql及tests/integration/reward-withdrawal-mock-fixtures-db.test.cjs。不是正式Migration；未修改前端、正式DB、部署或commit／push。後續處理這批資料應保留帳務歷史，不自行刪除不可變Ledger或既有帳號。本次只新增資料與SQL驗證，無產品程式變更，沿用上一版已通過的Build結果，未另跑前端測試。

2026-10-17提交前重新驗證：固定版本embedded-postgres@17.6.0-beta.15於隔離本機執行mock-fixtures測試1／1通過、0跳過；含30筆、三批次、五狀態、原可用金額／庫存保留、通知阻擋及重複執行拒絕，相依雙錢包併發deadlocks=0。本次未重跑任何雲端資料腳本；此檔仍為test-only資料準備工具，不列入正式Migration。
