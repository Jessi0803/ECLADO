# 正式銀行服務缺少連線設定修正｜2026-10-19

使用者在正式師資頁自行填入銀行資料並嘗試儲存，回報「銀行資料服務尚未設定」。沒有由Codex讀取、複製、重送或記錄其銀行內容。

## 根因與最小修正

`api/reward-bank.js:8` 直接讀取 `SUPABASE_URL`、`SUPABASE_ANON_KEY` 及 service role（接受 `SUPABASE_SERVICE_KEY` 別名）；缺任一項即503，在Auth與銀行加密／儲存之前返回。Vercel唯讀設定列表確認：Production只有既有SUPABASE_SERVICE_KEY；URL及匿名公開key先前只配置Preview。其他既有API使用 `_supabase-env.js` 的正式預設，故一般頁面可正常載入，不能證明銀行API必要設定齊全。

先前未登入POST401是在連線設定檢查前返回，GET405更早返回；這兩個檢查不足以覆蓋已登入儲存，本次正式登入後驗收才發現缺口。正式師資帳務RPC／餘額0／未設定銀行及提領停用提示可載入，也不能替代銀行API加密儲存驗收。

使用者明確批准後，新增Vercel eclado／Production的 `SUPABASE_URL` 與 `SUPABASE_ANON_KEY`，兩者為公開連線設定，值沿用正式專案及程式既有公開預設，不使用Preview值。不調整service key、銀行keyring、角色、RLS、RPC、會員資料、SQL或付款程式。UI確認兩項均Production、儲存成功，未按Redeploy；以本次文件提交／main push走既有Git自動部署。

## 本次範圍與驗證

沒有產品碼變更，沿用先前已通過的銀行API單元、隔離DB與UI證據；提交前做文字差異、紀錄範圍與秘密模式檢查，不把未重跑測試說成新PASS。新deployment Ready後，以假無效Bearer的read請求核對必要設定分支已通過（應到Auth拒絕401，而非缺設定503），不帶銀行資料、不做正式寫入。此probe不代表有效身分、service key權限或銀行加密金鑰roundtrip已驗證。

正式銀行儲存／解密仍由使用者自行重試，Codex不代重送表單、不製造假銀行資料、不申請提領。學生價與worker保持OFF。設定及部署後結果見對應evidence JSON；Production原始發布紀錄一併提交保留。

## 實際 Git 部署及探測結果

`400e70d619a3de45e5a7783132ec8d521255ab20` 已提交9份設定／正式發布紀錄並push main；Git自動Production部署 `EEFs1AkiFJ9i1eu3X2F5hChWi3ev` Ready，24秒，頁面時間台北20:38:17，正式網域已對應。假無效Bearer的read probe回應401 Unauthorized、缺設定錯誤false，證明已通過原本缺設定分支；沒有帶銀行資料、沒有金融寫入。不把這項成功當成銀行key／service授權／真身分儲存的通過。使用者尚須自行重試，結果待確認。

## 使用者銀行儲存及遮蔽查詢已確認

使用者其後明確回報已完成銀行資料儲存。Codex唯讀確認目前收款資料存在、表單收合，無缺設定或服務錯誤；按「重新整理提領」重新取得資料後仍存在，沒有載入中，提領按鈕仍停用。沒有讀取、截圖、複製或保存完整銀行內容，沒有代送表單或申請提領。

`reward-bank.js` save在呼叫儲存RPC前先執行encryptBank，因此本結果支持正式加密寫入路徑可用；本次畫面只取得遮蔽摘要，不等於read/snapshot完整解密路徑或歷史key恢復已實測。此兩項限制仍保留。證據 `docs/evidence/reward-production-bank-save-acceptance-20261019.json` 不含會員或銀行內容。
