# 師資提領扣款明細

2026-10-18 使用者確認採分開門檻：扣手續費前的提領總額超過 20,000 元預扣 10% 所得稅，達 20,000 元扣 2.11% 二代健保補充保費，兩項都按全額計算。原 15 元手續費規則不變；後續已擴充為[自選提領金額與每批次一筆](reward-withdrawal-partial.md)。

本次產品計算約定：所得稅元以下無條件捨去、補充保費四捨五入至元，兩項各自計算，不能合併成 12.11% 後才取整。實匯金額＝提領總額－15－所得稅－補充保費。

| 提領總額 | 手續費 | 所得稅 | 補充保費 | 實匯 |
|---:|---:|---:|---:|---:|
| 19,999 | 15 | 0 | 0 | 19,984 |
| 20,000 | 15 | 0 | 422 | 19,563 |
| 20,001 | 15 | 2,000 | 422 | 17,564 |
| 30,000 | 15 | 3,000 | 633 | 26,352 |

## 資料與流程

- 試算及頁面預覽都使用後端 `calculate_reward_withdrawal_deductions`，瀏覽器不重算稅費。沒有新版試算回應時禁止送出提領，不以舊的「總額減15」代替。
- 新提領保存 `income_tax`、`supplementary_premium`、`deduction_policy_version=tw_withdrawal_v2`，以及包含費率、門檻、比較方式、計算基準、取整方式的 `deduction_snapshot`。
- 欄位受原本不可改寫的歷史 trigger 保護；後台後續匯款以保存的 `net_amount` 為準，不重新套當下費率。
- 既有提領不回算，維持原 amount、fee、net、銀行快照及處理結果，標記 `legacy_fee_only_v1`，兩項扣款為0。舊版通知及既有匯出稽核不重寫。
- 帳戶仍一次保留／扣除提領總額。稅費從總額內分配，不再向帳戶重複扣款；匯款明確失敗時全額釋放，未知結果則維持全額保留。
- 後台批次合計、CSV金額與匯出快照、提領紀錄、通知及財務對帳使用同一筆保存明細。paid 的實際匯款金額必須等於扣款後的 net。
- 此改動記錄預扣金額，不代表已向國稅局／健保署申報繳納，沒有新增自動匯款或稅務繳款功能。

## 安裝

在最新返饋金階段5、階段6通知／對帳及提領操作補強 SQL 之後執行 `supabase-instructor-reward-withdrawal-deductions.sql`，再執行同名 `-verify.sql`，最後部署前端及 serverless。正式環境目前尚未安裝返饋金全套，必須遵循完整依賴順序；此檔不是可單獨跳階安裝的 migration。

已安裝的 test 環境同樣只在明確授權後套用此增量檔。不重放舊的 nominal-batch cleanup、stage5或stage6檔案覆蓋新函式；若重建，需將本檔放在最後重新驗證。原有 pending／processing／unknown 申請保留原金額，管理員須依各筆快照匯款，不用新公式人工改舊單。

此版本按使用者確認的產品門檻實作，不是通用稅務身分判定引擎。正式啟用前仍須由會計確認所得分類、居住者／非居住者、免扣資格、健保計費上限、同一實際給付的合併方式與申報流程；本次沒有收集或推斷個人健保／稅務身分。

參考：[各類所得扣繳率標準](https://law.moj.gov.tw/LawClass/LawAll.aspx?Pcode=G0340028)、[健保署計算規則](https://www.nhi.gov.tw/ch/cp-4516-74b0f-2613-1.html)。以上需配合實際所得分類，不能僅憑這個產品規則宣稱完整法規遵循。

## 驗證方式

- `EMBEDDED_POSTGRES_MODULE=/path/to/embedded-postgres/dist/index.js node --test tests/integration/reward-withdrawal-deductions-db.test.cjs`
- `node --test tests/integration/reward-bank.test.cjs tests/integration/reward-notification-worker.test.cjs`
- `npx playwright test tests/instructor-reward-withdrawals.spec.ts --project=chromium --project=mobile-chrome --workers=1`

隔離真實SQL涵蓋既有高額申請不重算、重跑migration、邊界取整、舊試算拒絕、重複請求、不可變明細、扣款後實匯、錯誤匯款金額拒絕、明確失敗全額返還、通知、批次合計、匯出快照及對帳。銀行API／CSV及通知使用mock，不連真銀行或發信。

2026-10-18 本機驗證通過：隔離 PostgreSQL 整合測試、銀行／CSV與通知測試24項、桌面／手機提領測試46項及新增高額後台案例2項、正式版建置。未對 test 或正式資料庫套用本次 migration，未部署。
