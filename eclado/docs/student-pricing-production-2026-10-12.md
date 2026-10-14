# 1C 正式 Migration 與部署｜2026-10-12

## 授權及狀態

使用者授權完成 1C 正式 Migration／部署、不合併 main；經說明 2A／2B 尚未實作後，使用者確認本次學生價格保持 OFF。原本須待 2A／2B 驗收才啟用的規則保留。未進入 2A，未建立正式測試訂單／付款／綁定，未啟用學生價。

## 正式資料庫

- Supabase：`ilvdvlkdpntwmaijncaz`，Primary Database，登入中的 SQL Editor。
- 唯讀前置核對：相依六簽章存在、新六函式及開關表不存在；1B 三業務表欄位相容。
- 待修改三函式定義 MD5 與本機測試基線一致：基礎報價 `3c290cac55a4a5fecc06c4e8fdb408ab`，代客報價 `bacb6afeeb0e979ceb604687cd3ea725`，代客建單 `c8d2f2e431ad2ed7ede19117c066bac6`。
- 完整原定義／owner／ACL 與基線備份：`student-pricing-production-backup-2026-10-12.json`。不含會員、訂單、銀行資料或連線憑證。
- 套用：提交 `7097925299680a48b74233b644894a79e51a21d5` 的 `supabase-student-pricing-integration.sql`，SHA-256 `b98df545aba432e4c0aa793bbf1e41646ef80c5d6a42fba5ee21429f3fdc353a`。編輯器完整內容與來源長度／校驗一致，單一 BEGIN／COMMIT；顯示 `Success. No rows returned`。
- 開關初始化：`enabled=false`、`version=0`。
- 正式唯讀驗證 14 項全部 true：OFF、RLS、客戶端開關讀寫封閉、三價格接點、代客同份 quote 總額、四 helper EXECUTE 封閉、兩公開入口 EXECUTE、三修改函式 ACL 不變、其餘函式／Trigger／權限不變、開關初始狀態。
- 非目標 public 函式定義＋ACL＋owner 指紋 `199418d96afad6a9f480fe109942d303`；Trigger `fd154a7edc1f70ea59d6c77736d4c4fc`；後台權限 `a78b6b0e8594996ee5a3183176538df5`，前後一致。原付款／庫存／活動／購物金函式包括在不變基線內。
- S1 前置確認：付款重試與 claim 對 anon／authenticated 仍拒絕、service_role 允許；本次未修改。
- 額外唯讀 runtime：BEGIN READ ONLY＋SET LOCAL ROLE anon，呼叫本人價格查詢，回 `{"prices":[],"enabled":false}` 後 ROLLBACK。未呼叫報價或建單業務 RPC。

## Vercel 正式部署

- 專案：`eclado-s-projects/eclado`，project `prj_urkSQ2ibqoOsHPSGpc53UWqKJJy2`，Root Directory `eclado`。
- 來源：`git archive 7097925299680a48b74233b644894a79e51a21d5` 匯出至隔離暫存目錄；不包含本機 `.env`、未追蹤 `.claude/launch.json` 或此次新增紀錄。
- 部署：CLI `vercel deploy --prod --yes --scope eclado-s-projects`，metadata 指明 commit／分支。沒有切換或合併 main；Vercel 使用既有正式專案環境設定。
- Deployment：`dpl_HW4Ka2MJVQkRggYwTXrvwG7Q6TcK`，狀態 **Ready**，target **production**。
- URL：https://eclado-riora2py3-eclado-s-projects.vercel.app
- Inspect：https://vercel.com/eclado-s-projects/eclado/HW4Ka2MJVQkRggYwTXrvwG7Q6TcK
- 正式網域：https://ecladotaiwan.com ，CLI deploy／inspect 均確認 alias。
- 建置：456 模組，SEO 預渲染 62 商品／8 文章；Build Completed、Deployment completed。有既有大型 chunk 警告，SEO harness 結束時出現 Vite dependency scan 的 server closed 警告；建置成功，未順便修改相關腳本。

## 部署後驗證及限制

- 唯讀 HTTP：`/`、`/shop`、`/admin`、`/checkout`、`/payment-result`、`/sitemap.xml` 全部 200。
- 正式 `/admin` 引用新 `admin-Cj1I9YzP.js`；資產 HTTP 200，包含 AUTO 系統計價／MANUAL 指定單價字串。
- 真實瀏覽器 `/shop` 商品及公開價格正常渲染；檢查時沒有 error 類 console 紀錄。
- 本機隔離 DB／Playwright 證據沿用統一開發 v0.8；此次沒有修改功能程式或重跑整套測試。正式 Build 另有上述實際結果。專案沒有 Lint script。
- HTTP／公開商城與 Metadata 驗證不能取代登入會員、管理員操作及完整下單／付款人工驗收；沒有用正式建單來測試，也沒有宣稱學生價 ON 或返饋帳務完成。

## 回復準備（未執行）

- 舊正式部署：https://eclado-bjfdkb5wy-eclado-s-projects.vercel.app 。需要回復時重新核對其 Ready 狀態、環境及 aliases，再將正式流量切回；未變更 main。
- 開關已 OFF；優先回復前端。資料庫回復 SQL `student-pricing-production-rollback-2026-10-12.sql` 由原備份產生，恢復三函式及其 ACL、撤銷新公開入口，保留新表及 1B 歷史。必須另行批准才執行，未執行。
- 原有未追蹤 `.claude/launch.json` 保留。此次三份正式紀錄／備份／回復檔尚未 commit／push；不混入部署來源或自行提交。

## 正式網站回復｜2026-10-12（最新狀態）

使用者表示尚不希望部署至正式網站，要求取消此次部署。已核對舊部署 Ready，執行 Vercel rollback，CLI 回報 Success。

- 正式流量回到 `dpl_AATJYRnksm5bGafqm1kQ89Usxdkv`，URL https://eclado-bjfdkb5wy-eclado-s-projects.vercel.app （2026-10-11 23:10 台北時間建立）。
- 回復後首頁及 /admin HTTP 200；main-By3xmMjZ.js／admin-5DpoOyQ3.js／membership-Cj5mE8oX.js 已為舊版，不再引用此次 1C 資產。
- 未刪除此次部署或 Git 提交；未合併 main。1C 程式仍保留在開發分支。
- 本次沒有操作 Supabase；1C Migration 保留，學生價格維持 OFF，沒有執行資料庫回復 SQL。
- 後續正式網站部署須依使用者新的指示執行。本節取代前述正式網站已部署 1C 的現況，先前紀錄保留作歷史。
