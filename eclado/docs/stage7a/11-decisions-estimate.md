# 待使用者決策與後續工程估算

本次停止在7A，不自行進入7B/7C。以下是必要的獨立批准事項，非已確認營運規則。

1. 是否明確接受階段5與6本機成果（包含Mock／真金融SQL界線與已知限制）。
2. 是否先批准**獨立優惠券quote/create相容修補**：只將普通creator的指定會員驗證對齊既有quote helper，保留角色券／訪客／使用上限／活動／金額／回滾流程；先隔離重現修補及回歸，再另准正式套用，不在7A改creator。
3. main JPEGfallback同步策略：建議另准合併main到開發分支並處理必要衝突／回歸；本次未merge或cherry-pick。
4. 是否批准建立測試Supabase與Preview連線參數化／mock付款通知／callback隔離。先完整檢查來源，再最小調整；Git push可能自動部署，需再明確授權。
5. 選Worker方案A／B與費用上限；是否要求DB憑證層最小能力。現service-role有既有購物金寫入／其他RPC權限，環境隔離本身不等於DB能力隔離；若要求嚴格限權需另准角色／gateway設計，不偷改既定service-only RPC。
6. 確認Vultr PaymentAPI／worker的Git自動發布、正式sender／管理Email名單、銀行keyring保管與完整休假表、Backup／restore與告警。
7. 上述完成後，另給7B SQL清單／hash／窗口與操作範圍批准；7C再批准發布／啟用及任何正式交易驗證。

## 剩餘工時（非承諾，非此次實際耗時）

| 後續工作 | 工程小時 |
|---|---:|
| 優惠券最小相容修補＋回歸 | 4～8 |
| main同步與相關回歸 | 2～4 |
| 測試Supabase／Preview／真Auth-PostgREST整合隔離 | 8～16 |
| Worker選定後隔離／限權／Git發布／排程Mock | 6～10 |
| 金鑰／年曆／名單／backup與restore演練 | 4～8 |
| 核准後正式Migration與版本配套驗證 | 4～8 |
| 核准後正式發布／觀測／安全回復準備 | 4～6 |
| 合計 | **32～60** |

不包含等候平台登入／使用者驗收／銀行sandbox或供應商回應。先前「測試Supabase半天至一天」是單純環境初估，不涵蓋此刻已發現的coupon差異、main同步、worker限權與完整正式發布。

建議先完成上述準備與最小修補，再評估進入7B；**目前不建議直接開始正式Migration**。
