# 付款API主機更新與回復

依使用者2026-10-19決策，付款API沿用Vultr主機管理，不使用GitHub部署管道。前端／serverless是否走main仍依原專案流程，不混同付款主機部署。

## 2026-10-19已完成更新

- 原PM2應用 `eclado-payment-api`、root、cwd `/opt/eclado-payment-api`維持不變；未切換至先前準備的專用帳號或release symlink。
- 原版完整備份 `/opt/eclado-payment-api/backups/current-20261019-070550Z`，root0700／檔案0600，包含程式、完整node_modules、.env及啟動設定。runtime.tar.gz SHA256 `1df08714c33e0d9657aaf6f27444744d1a8e5612fa4a31763e57d1c593d464e3`。
- 候選來源本機commit `cf1722cc1c291a969c9cc6b50d31b6371882473c`；其中runtime相容修正為872d87e，cf1722c補足測試假商店代碼，避免依賴開發者.env。
- 只更新server.js及新增reward-payment-evidence.cjs；assisted-orders.js、package.json、package-lock.json、node_modules及.env逐檔／metadata核對維持原狀。沒有執行npm install。正式仍使用helmet8.1.0；本次在該版本依賴上驗證候選。
- server.js SHA256 `485150d4e6bd6a99f4a1514ce71448587f4723a763efdc8e3c3810fa6ea963b3`；返饋模組SHA256 `d1cb9822d11f6ea53aecc3e151093c2c39fa99272c5e2f3baa777a1d36a88d33`。
- 重啟原PM2應用，PID1860848→1983124，cwd／script仍為原路徑。內部health、主機對公開HTTPS health及外部HTTPS health皆ok=true，沒有使用回復。

## 相容性與驗證

正式DB尚無orders.reward_credit_amount。原候選直接SELECT該欄會使一般付款與訪客查詢失敗，發布前已修正兩條讀取路徑：只有精確符合該欄缺少的42703或schema-cache PGRST204錯誤，才保留所有篩選／權限標頭、移除該投影欄並重試一次。其他權限／欄位／儲存錯誤照常失敗；不快取舊schema判定，安裝欄位後下次自動使用新欄位。缺少返饋RPC的PGRST202相容行為另有既有測試。

本機65項測試通過；主機隔離目錄 `/opt/eclado-payment-api-staging/reward-872d87e` 使用假.env、清空繼承環境、相同Node20與原有依賴，65項全部通過。測試使用模擬上游與loopback，未呼叫銀行。候選檔案manifest、測試紀錄與DEPLOYED.json留在root專用暫存目錄。

發布後以新版程式查詢不可能的測試訂單編號，攔截並禁止所有非GET請求：第一次精確收到42703，第二次移除新欄後200／0列，最後正確回Order not found。READONLY-SMOKE.json保存結果，非GET請求0；另以limit=0驗證正式PostgREST錯誤格式，沒有讀取真實訂單資料列。

沒有執行正式SQL migration、建立付款單或銀行測試交易。以上不等同真實刷卡／回呼端到端交易驗收。

## 回復原則

更新腳本先驗證完整備份及當下runtime指紋，候選檢查成功後才原子替換模組／server，再重啟與驗證；失敗時還原備份server，移除本次新增模組，重啟並驗證原服務。本次此回復分支未實際觸發。

人工回復前先核對DB版本及新交易義務，依備份RESTORE.txt與manifest，先解壓至獨立root私有目錄驗證，不直接覆蓋整份PM2 dump或重裝舊依賴。.env不因單純程式回復而覆蓋。若返饋SQL及雙錢包義務已存在，不能直接退回不支援返饋的舊API；須保留相容付款／證據處理能力。
