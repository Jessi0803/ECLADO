# 正式通知／對帳 worker 操作清單

狀態：**使用者其後明確批准正式啟用與首輪驗證，worker與兩timer已啟用。** 下列啟用前清單保留供稽核與日後維護，不可因已啟用便重跑首次安裝／任意補寄。最新啟用結果見文末。

時間範圍：本文的OFF、空佇列、未啟用及「03:00尚未到」描述均為2026-10-19當時的驗證紀錄，不代表目前即時狀態。學生價其後已另行批准啟用，見 `student-pricing-production-activation-2026-10-19.md` 與 `師資反饋金系統開發文件.md` v1.26；本次整理沒有重新查詢主機、每日排程結果或正式佇列。

本輪其後已完成正式啟用前聚合：READ ONLY交易＋ROLLBACK，通知總數／到期／pending或retry／sending／unknown皆0，提領總數／未完成0，對帳run0，學生價OFF。沒有讀任何收件者或銀行內容。證據為 `docs/evidence/reward-worker-live-queue-readonly-20261019.json`，SQL來源 `docs/reward-worker-preactivation-readonly-20261019.sql`。這是當下盤點，非未來一直為0保證；啟用若延後須重新核對。

## 已確認排程與責任

- 通知：每批最多5件，該次service完成後約60秒再觸發下一次；非保證每則通知60秒內送達。依既有 next_retry_at、lease與通道規則處理。
- 財務對帳：每日台北03:00執行。既有timer `Persistent=false`，主機錯過該時間不自動補跑；發現缺run須先查日誌，人工補跑另行授權。
- 初期由使用者每日人工查看後台「通知紀錄／財務對帳」，有問題再請Codex協助日誌診斷。目前沒有自動告警，不以「沒收到警報」判斷服務正常。
- 通知服務不匯款、不新增提款決策；對帳只記錄差異，不自動改餘額、Ledger、訂單或銀行結果。學生價格開關獨立；worker啟用當時為OFF，後續啟用紀錄見本文開頭。

## 本輪實際唯讀核對

兩timer皆disabled/inactive、NextElapse空。兩個service皆獨立 `eclado-reward-worker` 帳號／群組、ProtectSystem=strict、NoNewPrivileges=yes、MemoryMax201326592、TimeoutStart110秒；之前disabled模式Result=success／ExecMainStatus0。設定root:worker0640。以worker帳號執行check回應configuration_valid、networkRequests0。已保存日誌只見先前disabled啟動／結束，沒有本輪派送或對帳執行。

秘密留在 `/etc/eclado-reward-worker/worker.env`，不使用 `cat`／`systemctl show Environment`／pm2 env輸出秘密；付款服務.env不交給worker。排程檔已安裝，不需重跑會拒絕既有安裝的install-disabled.sh。

## 第一次啟用前清單（歷史紀錄，已於2026-10-19完成）

1. 唯讀核對正式Outbox各狀態筆數、到期待處理數、提領事件及有效通知來源。不得讀出或貼出收件者／銀行內容；如已有累積通知，先列事件範圍／數量交使用者確認，不任意掃描補寄。
2. 核對來源為正式專案、worker不含銀行解密key、service-only RPC存在且EXECUTE權限已驗證；付款health正常，學生價仍OFF。
3. 使用者明確批准**啟用正式自動通知／對帳**及當下可能投遞的既有範圍，才能將worker flag改true並啟用兩timer；不因本清單或頻率已確認而先啟用。對帳會寫run／finding，也屬本步批准範圍。
4. 啟用後核對timer active／next trigger、第一個run／派送日誌及帳務不變；佇列為空時可確認空tick，但不能冒稱真Outbox投遞／備援已通過。沒有真實業務事件時不造假提領。
5. 記錄啟用時間／版本／佇列前後聚合／檢查結果，再更新 `師資反饋金系統開發文件.md`；不順便啟用學生價。

## 每日人工查看

1. 通知頁：查看待發／重試、待設定／無管道、結果待確認與失敗；核對最後嘗試、下次重試及詳細紀錄。只有pending／retry正在等排程不代表故障；若跨過預定重試時間仍無嘗試，交由技術端查timer／RPC／服務。
2. 遇blocked先修設定／收件方式，failed查永久錯誤與嘗試上限，unknown先查服務商是否已接受。不得把unknown直接當未寄送另發，或任意重置嘗試次數。手動重試／另寄新版本沿用既有權限、防重及原因稽核。
3. 財務對帳：每日03:00後查看最新run的時間、status、checked、findings；沒有當日run或run failed需要查核。finding不為0需看類型與來源，不能直接改餘額「修平」。負餘額本身是合法狀態。
4. 對帳完成只代表檢查完成，不能證明銀行真的匯款；unknown匯款仍須人工查銀行。若結果未明，不重匯或自動退回。

## 技術端唯讀診斷

以下只是操作說明，寫入／啟停指令須按當次授權執行。

```sh
systemctl status eclado-reward-dispatch.timer eclado-reward-reconcile.timer --no-pager
systemctl list-timers --all eclado-reward-dispatch.timer eclado-reward-reconcile.timer
systemctl show eclado-reward-dispatch.service eclado-reward-reconcile.service -p Id -p Result -p ExecMainStatus
journalctl -u eclado-reward-dispatch.service -u eclado-reward-reconcile.service --since '24 hours ago' --no-pager -o cat
runuser -u eclado-reward-worker -- env -i PATH=/usr/bin:/bin /usr/bin/node --env-file=/etc/eclado-reward-worker/worker.env /opt/eclado-reward-worker/runtime/scripts/reward-worker-host.cjs check
```

日誌目前僅安全結果／數量／分類，不貼provider原始body或秘密；系統journal保存策略沒有另外調整或完成保留期限驗證。人工每天查看是已接受的初期方案，主機失聯或日誌輪替仍可能形成盲區，不宣稱具備即時或異地告警。

## 停用與結果不明

需要停用時，按授權disable/stop兩timer，將worker flag設false阻止下一輪；不刪Outbox、attempt、Ledger、run或finding。**停timer／改flag不會撤回已送出的請求，也不會中止已在執行的oneshot。** 已執行到provider但DB完成狀態不明時，先查lease、服務商與日誌，再依既有防重鍵恢復；不得盲目新增通知版本。服務本身是否需強制停止須另評估，避免造成投遞結果未知。

對帳同日重跑使用原run key；跨日追查可明確帶原UUID，不直接以新日期再製造run。既有failed run不會因同key變成功，調查後新UUID重跑須另外授權。不得把runbook當成自動補寄、金融修復或正式啟用授權。

## 實際啟用及首輪驗證（台北2026-10-19 20:51）

使用者明確確認啟用後，將獨立worker旗標改true，先以實際systemd帳號／沙箱完成通知tick與對帳，兩service皆success／exit0，再enable --now兩timer，皆enabled/active。沒有重啟／修改付款API，付款health仍ok。啟用腳本只替換worker flag、保留秘密與root:worker0640，首輪失敗會撤timer及flag；本次未觸發失敗回復。

首輪通知complete、checked0／accepted0；對帳complete、checked0／findings0，run key `8b57b5ca-30fd-5f1a-bbf2-a983a0d183ac`。後續READ ONLY＋ROLLBACK核對正式run確實1筆、status complete／error null、通知與提領0，學生價false。沒有假業務事件或金融交易；空資料檢查0異常不是有資料全流程無異常證明。啟用timer後另一個空通知tick亦成功。

下次對帳為台北2026-10-20 03:00（UTC2026-10-19 19:00），通知依60秒完成間隔執行。第一次排程03:00尚未到，不能當成已驗證；使用者依本清單每天檢查。系統單元Description仍帶初裝時disabled until approved歷史文字，實際狀態以timer enabled/active、flag及日誌為準，不因Description判斷仍停用。

證據：`docs/evidence/reward-worker-activation-20261019.json`、`reward-worker-postactivation-readonly-20261019.json`及同名畫面；SQL為 `docs/reward-worker-postactivation-readonly-20261019.sql`。以上為當時啟用驗證結果；本批文件現已列入使用者核准的整理提交範圍，提交本身不重新啟用服務或執行SQL。
