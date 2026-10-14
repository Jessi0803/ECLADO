# Go／No-Go檢查表

2026-10-13：**NO-GO正式上線／Migration直接放行。7A報告完成不等於已批准7B／7C。** PASS僅適用明列範圍，Mock結果不提升為正式PASS。

| 門檻 | 狀態 | 證據／尚缺 |
|---|---|---|
| 1 階段5使用者驗收 | BLOCKED | Codex20清單通過，沒有使用者明確接受成果；commit授權不替代驗收 |
| 2 階段6使用者驗收 | BLOCKED | 同上，正式服務未驗證 |
| 3 正式Schema差異 | FAIL | Metadata完成；指定會員coupon quote/create已重現不一致，須先獨立修補 |
| 4 Migration順序 | PASS（計畫） | 05給出2A→2B→3→4→5→6notice→6reconciliation；正式執行仍需批准與當下核對 |
| 5 S1付款權限 | PASS | 正式兩RPC客戶拒、service可、hash與修補一致；隔離回歸通過 |
| 6 雙錢包金額 | PASS（隔離）／NOT VERIFIED正式 | 真SQL／API55／UI；正式新欄及新API未安裝 |
| 7 Ledger對帳 | PASS（隔離）／NOT VERIFIED正式 | sum與逐筆after、重複credit/reverse／MVCC已測 |
| 8 提領保留 | PASS（隔離）／NOT VERIFIED正式 | 真withdraw/return/negative20及PG競爭 |
| 9 銀行金鑰 | BLOCKED | 正式keyring配置／備份／rotation演練未做 |
| 10 Worker隔離 | BLOCKED | A/B未選、secret/runtime未配置；service role廣能力限制須決策 |
| 11 正式LINE/Email | NOT VERIFIED | 本階段只Mock，sender／可達性／tokens配置另准 |
| 12 管理員名單 | BLOCKED | 正式明確Email名單未確認／配置 |
| 13 銀行休假表 | BLOCKED | 正式2026/2027銀行公會完整表尚未核對／匯入；測試表不替代 |
| 14 排程／告警 | BLOCKED | 沒有reward正式timer；POST不能直接掛VercelGET cron |
| 15 Git部署映射 | PASS前端／NOT VERIFIED PaymentAPI及worker | Vercel main Production、feature Preview實際確認；Vultr自動發布未確認 |
| 16 Backup／回復 | PASS計畫／NOT VERIFIED執行 | schema證據非資料backup；獨立restore未演練 |
| 17 完整回歸 | PASS已測範圍／FAIL正式相容 | 601UI覆蓋＋3skip、PG69等；真Auth／PostgREST／完整shipping與正式coupon尚缺 |
| 18 正式學生價OFF | PASS | enabled=false/version0唯讀確認，不代表wallet／withdraw入口已停用 |
| 19 既有付款／退款 | BLOCKED | 已測Mock／真SQL；正式PaymentAPI缺新證據模組、銀行金額單位未核；既有非返饋晚付款獨立列管 |
| 20 使用者上線批准 | BLOCKED | 本次只7A，沒有7B／7C授權 |
| 21 main既有修補保留 | BLOCKED | 8d65f0e JPEGfallback在feature缺少，需批准同步及回歸 |
| 22 Preview資料隔離 | BLOCKED | 前端Supabase／付款／notify URLs寫死正式；未建測試Supabase |

沒有把任何BLOCKED列作自動批准；未填真收件人／金鑰，不為測試放寬安全。
