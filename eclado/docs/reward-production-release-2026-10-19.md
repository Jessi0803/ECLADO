# Git正式發布紀錄｜2026-10-19

使用者在「下一步為合併main並透過Git自動發布」後要求繼續；已按該範圍完成。學生價格與worker／timer沒有啟用，不重跑任何正式SQL。

## 實際發布

- fetch確認本機／遠端main皆為 `b267571`，候選 `010d08c` 包含main，無分歧；35筆候選commit以 `git merge --ff-only codex/instructor-student-rewards` 快轉main，沒有額外merge commit或人工解衝突。
- `git push origin main` 成功，遠端main為 `010d08cffbe0876554650e9e47a9dec6a69b0442`。原 `.claude/launch.json` 未追蹤檔保留。
- Vercel唯讀頁確認Production、main／相同SHA、Ready、建置18秒；頁面時間台北20:28:04，正式網域 `ecladotaiwan.com` 指向部署 `8dYn2kD3i8NWGbxBLxGnJ3CNuWN7`。沒有按Vercel部署／promote／alias／rollback按鈕。
- 付款API沿用已完成的VPS主機版本；沒有重新發布或重啟付款API。GitHub workflow只因push執行verify，部署job僅workflow_dispatch，不是本次付款API發布途徑。

## 前後檢查

發布前GET唯讀確認正式學生價OFF/version0、worker flag=false、既有完整付款API備份COMPLETE.json存在；候選Preview010d08c已Ready。既有101項回歸與其後PG4情境、API35、UI60分層證據依release checklist保留，不把文件提交當作新產品變更重測。

Production Ready後：首頁、商品列表、account、checkout皆HTTP200；銀行與worker新API的GET皆405，銀行API未登入POST read為401；付款公開health200且ok=true。正式商品列表顯示實際商品與價格，無TEST／付款停用橫幅。這是公開／未登入檢查，沒有取得會員個資或建立訂單。建置中先看到舊版API404，未誤認為新版失敗；Ready後重新查核為405。

證據：`docs/evidence/reward-production-release-010d08c-20261019.json`、`reward-production-010d08c-ready-20261019.jpg`、`reward-production-010d08c-shop-20261019.jpg`。

## 尚未完成及啟用界線

- 正式登入後銀行API儲存／解密與Production keyring載入尚未實證；401／405不能證明加密key有效。金鑰已儲存在Production設定，不能因此宣稱真銀行資料roundtrip通過。
- 正式登入後會員／管理員返饋操作、結帳／雙錢包真交易、有效銀行回呼，以及Outbox／重試／對帳執行仍待受控驗收；不得在正式製造假訂單／提領補證。
- 學生價保持OFF，老師入口依已接受決策直接顯示；worker及timer維持停用。監測／排程頻率與啟用、真交易驗收、回復演練須另外放行。
- 本次僅發布網站程式，沒有新Migration、秘密輪替、通知發送或金流／提領交易。回復仍遵守release checklist：Git相容修補／revert，不DROP帳務、不任意全庫還原、不用單錢包舊付款API處理新義務。

發布紀錄與畫面為部署後新增文件，尚未commit／push。當前工作分支為main，下一次提交前須明確辨識會觸發Production，不把文件push當成僅備份。
