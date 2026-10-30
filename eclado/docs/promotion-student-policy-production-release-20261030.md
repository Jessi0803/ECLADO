# 學生價／活動／師資返饋正式發布紀錄

發布日期：2026-10-30（台北）。執行提交 `16bf4355f69b358543c80f4c1d0ab880f631b390` 已自正式基準快轉 main；原工作區其他變更未納入，也未切換或還原原工作區。

## 已發布

- 正式 Supabase `ilvdvlkdpntwmaijncaz` 已安裝增量政策，初始保持 OFF，原自動活動分配 ON。安裝前290個 public 函式、owner／ACL、活動、scope、優惠券關聯、設定與約束已保存私有備份。安裝後9項檢查通過；原290個函式的 owner／ACL 全部保留，僅8個預期函式變更，總函式298個；安裝階段既有活動完整保留。
- 付款 API 成對發布 `server.js`／`assisted-orders.js`，正式 Node20.20.2、既有依賴在無環境檔的隔離目錄通過82項測試。備份 `/opt/eclado-payment-api/backups/student-policy-16bf435-yEocxR`；隔離候選與測試 log 在 `/opt/eclado-payment-api-staging/student-policy-16bf435-20261030`。PM2 PID2327559→2489208。重啟曾短暫連線拒絕，重試後內外健康檢查正常；未宣稱零停機。
- Vercel Production `dpl_8Mi8pfvJQWhPWZsGSn2syqBQQAAA`，Ready；`ecladotaiwan.com` 綁定候選 `16bf435`，部署網址 `eclado-czjvkznce-eclado-s-projects.vercel.app`。從重新載入的 Project Overview 確認目前正式部署。
- 新政策已啟用，version2。精準更新正式盤點的9筆 pro 雙十一活動為不疊學生價／不計返饋；逐筆比對原設定、scope digest、無優惠券關聯，再更新兩個政策與 updated_at。其餘13筆活動（包含師資／經銷商買6送1）保留；活動日期、角色、商品範圍、門檻與公式未變。

活動依原時程開始：部分11/01 00:00、部分00:01。師資／經銷商活動仍為11/11 00:00開始。

## 部署後驗證

- 已部署前端執行14項桌面／手機回歸，全數通過；登入與業務 API 使用攔截測試回應，未寫正式資料。
- 正式資料庫以合成價格進行唯讀純計算檢查，4組通過：買3送1混合購物車淨折600、活動排除4件／其他0件；學生較便宜保留學生方案；同額活動優先；允許疊加折100。這不代表正式學生登入後完整結帳或銀行驗收。
- 正式首頁、商城、購物車、結帳、付款結果與後台 HTTP 皆200，付款 API 內外 health 正常。
- 最終五項狀態查詢全部 true：新政策啟用、原活動分配維持啟用、9筆雙十一互斥、師資／經銷商政策保留、其他活動允許政策保留。
- 未建立正式測試訂單、未修改客戶訂單／庫存／歷史返饋，也未呼叫銀行。真實 TEST 學生驗收見原 ui-acceptance 與 implementation 紀錄。

## 回復

功能回復只關閉新政策，原分配保持 true；不刪新欄位、調整類型、訂單快照與帳務，也不回算歷史。已準備 `promotion-student-policy-production-disable.sql`，以 version2 作防護，尚未執行。若後續版本已改，須重新核對。

API 成對備份供部署故障還原；政策啟用後優先採功能開關回復，保留新版程式對既有價格加回明細的支援。

完整證據：`evidence/promotion-student-policy/production-release-20261030.json`；啟用結果：`production-activated.json`。私有完整函式備份不納版控。本文件是部署後紀錄，不屬於先前封存的執行提交。

Browser screenshots are retained locally; Git records contain the structured verification results.
