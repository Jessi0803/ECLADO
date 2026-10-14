# Git與自動部署核對

7A開始與結束仍在`codex/instructor-student-rewards`，HEAD `a2b89ed33cdbc26bc0a6fd30b69deb8275f7d9a5`。fetch origin main及同名分支後，head/remote ahead0 behind0；與main分歧main-only1／feature-only10。未commit／push／merge／rebase／reset／cherry-pick。

開始沒有tracked修改，僅四個原未追蹤：`.claude/launch.json`與三份`docs/student-pricing-production-*`。階段6`652e62c`（16檔）及工具`a2b89ed`（7檔）已提交推送；附件「6尚未提交」過時。此次新增7A報告／診斷工具／測試證據、兩測試修正，維持未提交。

main最新`8d65f0eb72bd3d80d8c02f37e31f49ee17c14d05`在本分支缺少，改動professionalApplications、professionalRenewals、imageOptimization及三測試，為JPEGfallback。發布前須使用者批准同步策略並重跑對應案例；不能用本分支直接覆蓋此正式修補。

## 實際平台只讀證據

使用者登入Vercel後，Overview與Preview deployment details顯示：

| 用途 | Git分支／commit | 實際平台狀態 |
|---|---|---|
| Production | main／8d65f0e | Ready；`dpl_7aS2CMSpexzQZ7Aaffv2UcK5hwpK`；ecladotaiwan.com；頁面明示push main更新production |
| Preview | codex/instructor-student-rewards／a2b89ed | Ready；`dpl_D46wYqoRvwjTFtZg9SKEkgtk8e56`，最新開發branchURL |
| develop | develop | Overview另一Preview，未操作 |

[Preview詳情](https://vercel.com/eclado-s-projects/eclado/D46wYqoRvwjTFtZg9SKEkgtk8e56)；GitHub combined-status亦Vercel success。同一Supabase／付款URL寫死，所以Ready不是資料隔離或功能通過。未開Preview建單／付款測試，避免正式資料寫入。

Vercel API函式與前端同專案構建，Root Directory現有紀錄為eclado；[vercel.json](../../vercel.json)指定npm run build及dist，現有cancel-expired／quarterly兩daily crons，沒有reward worker。

## Payment API

唯讀SSH `sha256sum` `/opt/eclado-payment-api/server.js`所得`140d5f368a16ecfe431c2dc080a94bf7babf5985fc2948bd6a184af7a5478868`，與main完整server相同；開發版`5115cd2a502468d0b0301714286c9a9fd245ff9fc2e39802e552d5feac16fab2`不同；reward-payment-evidence.cjs在正式目錄不存在。沒有讀.env／客戶資料／修改檔／重啟或更新銀行。

此確認的是部署目錄檔案，不保證執行中process已載入同一hash；活躍PID與全鏈授權需發布前另核對。repo無可見`.github`自動發布workflow，不能據此斷言外部pipeline不存在；Vultr Git自動部署為NOT VERIFIED。

[結構化證據](../evidence/reward-stage7a/git-deployment-evidence.json)。更新日期2026-10-13；舊1C rollback是歷史，當前正式頁面已是main的8d65f0e，不能沿用舊部署ID當最新狀態。
