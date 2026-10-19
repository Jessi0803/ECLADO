# 正式銀行服務缺少連線設定修正｜2026-10-19

使用者在正式師資頁自行填入銀行資料並嘗試儲存，回報「銀行資料服務尚未設定」。沒有由Codex讀取、複製、重送或記錄其銀行內容。

## 根因與最小修正

`api/reward-bank.js:8` 直接讀取 `SUPABASE_URL`、`SUPABASE_ANON_KEY` 及 service role（接受 `SUPABASE_SERVICE_KEY` 別名）；缺任一項即503，在Auth與銀行加密／儲存之前返回。Vercel唯讀設定列表確認：Production只有既有SUPABASE_SERVICE_KEY；URL及匿名公開key先前只配置Preview。其他既有API使用 `_supabase-env.js` 的正式預設，故一般頁面可正常載入，不能證明銀行API必要設定齊全。

先前未登入POST401是在連線設定檢查前返回，GET405更早返回；這兩個檢查不足以覆蓋已登入儲存，本次正式登入後驗收才發現缺口。正式師資帳務RPC／餘額0／未設定銀行及提領停用提示可載入，也不能替代銀行API加密儲存驗收。

使用者明確批准後，新增Vercel eclado／Production的 `SUPABASE_URL` 與 `SUPABASE_ANON_KEY`，兩者為公開連線設定，值沿用正式專案及程式既有公開預設，不使用Preview值。不調整service key、銀行keyring、角色、RLS、RPC、會員資料、SQL或付款程式。UI確認兩項均Production、儲存成功，未按Redeploy；以本次文件提交／main push走既有Git自動部署。

## 本次範圍與驗證

沒有產品碼變更，沿用先前已通過的銀行API單元、隔離DB與UI證據；提交前做文字差異、紀錄範圍與秘密模式檢查，不把未重跑測試說成新PASS。新deployment Ready後，以假無效Bearer的read請求核對必要設定分支已通過（應到Auth拒絕401，而非缺設定503），不帶銀行資料、不做正式寫入。此probe不代表有效身分、service key權限或銀行加密金鑰roundtrip已驗證。

正式銀行儲存／解密仍由使用者自行重試，Codex不代重送表單、不製造假銀行資料、不申請提領。學生價與worker保持OFF。設定及部署後結果見對應evidence JSON；Production原始發布紀錄一併提交保留。
