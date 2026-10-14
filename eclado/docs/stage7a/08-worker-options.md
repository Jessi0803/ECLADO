# Worker方案比較（尚未批准、沒有新建平台）

`api/reward-notification-worker.js`只POST＋CRON_SECRET，拒絕銀行keyring；service-only claim/complete與受限對帳，最多5job／tick、每外部HTTP5秒、DB lease2分鐘。重試间隔1/5/15/60/360分鐘是既定規則，正式tick頻率另准；一次／天會使短間隔重試延遲，不改已確認retry規則。

| 比較 | A 沿用既有Vultr，獨立worker程序與OS帳號 | B 專用VM／獨立worker執行環境 |
|---|---|---|
| 安全 | 獨立非root user、目錄ACL、明確allowlist env、不共享PaymentAPI／銀行env；仍同host故障與root信任邊界 | 不共host與bankkeyfile；更強故障／秘密隔離，但service_role本身仍廣權限 |
| 維護 | 同現有平台，增加systemd/PM2、timer及patch管理；要避免root process共讀所有.env | 新實例／專案／網路／secret／patch／備份，維護較多 |
| Git部署 | 需另准建立artifact／release pipeline與健康驗證；不可用手動SSH deploy | 同樣須Git自動pipeline與明確分支映射；不可直接Vercel部署 |
| 月費 | 若既有容量足夠，新增VM費可為USD0；流量／訊息／監控與資源升級未估，不保證全部零成本 | 新VM／runtime月費依區域／規格／目前平台方案另報價，未選購。不能把未核對的舊最低價當承諾 |
| 恢復 | process restart／lease到期再領、同key／fencing、未知需人工；金融DB不回復餘額 | 同一Outbox協定，可換workerhost恢復；不自動返還unknown匯款 |
| 日誌／告警 | 結構化安全tick、provider分類、queue-age、unknown／failedrun、quota及磁碟告警；不記完整recipient／cipher/key | 集中日誌＋獨立健康／資源告警；保留與費用另准 |
| 相容性 | 可沿用HTTP或直接dispatch core與現SQL；完整bank處理仍原API | 可沿用dispatch core，若新平台Cron發GET需另准adapter／timer，不直接改既定POST安全入口 |

建議優先評估A以減少平台變更，但這是建議而非已確認部署方式。若既有主機容量或可保證隔離不足，選B。正式worker不能與銀行keyringVercel project全域env共用；在同repo放兩支function不構成秘密隔離。

**權限決策**：現service_role能執行其他金融RPC，亦可直接寫既有購物金表；雖新reward表直接ACL封閉，不能宣稱worker憑證具全系統最小能力。若7A要求的是憑證層禁止修改任何餘額，需另准專用DB角色／受限JWT與RPC身份校驗，或最小RPC gateway隔離信任。A/B只隔離執行環境，不能自行解決DB能力問題。未改service-role／現RPC營運規則。

## 官方契約核對（2026-10-13）

[Vercel Cron](https://vercel.com/docs/cron-jobs)以GET呼叫Production路徑；[Cron usage](https://vercel.com/docs/cron-jobs/usage-and-pricing)與方案限制需對照實際帳戶。現POST worker直接掛Vercelcron會405；且本次未改vercel.json。若用其他timer以POST則另准secret／運行方式。

[Vultr Cloud Compute](https://docs.vultr.com/product-overviews/cloud-compute)與[計費](https://docs.vultr.com/support/platform/billing/how-am-i-billed-for-my-servers)採規格／使用時數，地域／附加費與帳戶現方案未讀取，因此不給虛構固定月費。需要用戶批准具體方案及費用上限才建立資源。
