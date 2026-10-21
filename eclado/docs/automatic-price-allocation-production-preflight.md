# 自動活動分配：正式盤點與備份

2026-10-21 台北時間14:13起執行。候選程式 `878f364`。本步只讀正式資料庫並建立備份，未安裝 migration、未推送、未啟用引擎、未重啟付款服務。

## 資料庫

- 正式專案 `ilvdvlkdpntwmaijncaz`，以 read-only transaction 擷取271個 public 函式的完整定義、MD5、owner、ACL，及 constraints、活動、範圍、優惠券疊加政策；不讀取會員或訂單明細。
- 備份位於 gitignored 私有目錄 `.playwright/private-backups/automatic-allocation-production-20261021/`，CSV、JSON及查詢檔限制0600，目錄0700。CSV SHA256：`c1f46f068ea79923eebead337886f83b9da3c442b7d4dc604006b3c3a0f808dc`。這是本次變更所需的函式／設定備份，不是全庫資料備份。
- 新分配設定表尚不存在。12個將改動函式，加上原始權威價格函式，共13個的定義、owner、ACL與 test 驗收前版本一致。
- 其他共同函式僅 `reward_withdrawal_schedule(timestamptz)` 定義與 test 基準不同；屬於提領排程，這次不修改或覆蓋。
- 查詢當下97筆訂單、12個活動、17筆折抵。這只是線上資料的時間點統計，未修改任何業務資料，也未宣稱線上訂單數在後續固定不變。
- 目前有效自動價格活動1個：「急救安瓶三盒折300元」，限 pro、3件門檻，商品107–110，至2030-12-31。另一個啟用的「叫貨9折優惠」是 coupon_only。當下沒有多個有效自動價格活動相互重疊；未來新增活動仍須評估搜尋界線。
- 7筆優惠券政策：allow_auto_gifts 4、coupon_only 2、allow_all 1。本步不改動優惠券。

## 付款 API

- SSH 唯讀核對現行 `server.js`、`assisted-orders.js` 的 SHA256，皆與候選提交的父版本一致，未發現未納管的檔案差異。
- 已在主機建立 `/opt/eclado-payment-api/backups/automatic-allocation-20261021-mofYG5/`，備份兩個程式檔及 package.json／package-lock.json，附 SHA256SUMS，四檔逐一檢驗通過。沒有複製或讀出環境金鑰。
- 備份前後 PID 皆1983124，未重啟；公開 health 回傳 ok=true（2026-10-21T06:13:17.521Z）。本次付款 API 備份屬於程式回復備份，不取代既有完整營運備份。
- 依既定要求，後續仍直接管理付款主機，不採 GitHub 部署 workflow。

## 正式前端

重新整理 Vercel 後確認目前 Production 為 `1ba8ae7c596b2a7c6b2cccb31e55ad7cb16fd862`、Ready；部署 `88FsgZss7Cazx4md9jSbLs16pTVX` 顯示 Current 並綁定 ecladotaiwan.com。候選 `878f364` 尚未發布。

結構證據見 [盤點 JSON](evidence/automatic-allocation-production-preflight-20261021.json)。未取得或寫入付款金鑰，未建立正式假訂單／付款／核銷。

## 下一步

執行完整增量 SQL 並保持新引擎關閉，接著核對10項安裝檢查、既有權限及函式差異，再做經正式資料範圍檢查的交易回滾驗收。本份備份是盤點時間點，若安裝間隔期間有人改動函式或設定，須先重新核對，必要時重做備份。
