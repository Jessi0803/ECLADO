# 首次會員結帳橫幅修正驗證

日期：2026-11-24，Asia/Taipei。

R23 程式已修正：專業會員申請邀請在 `page === 'checkout'` 時不渲染，涵蓋收件資料、付款確認及付款單畫面。離開結帳後仍依原本資格顯示；沒有關閉邀請狀態或寫入已看過標記。

修正僅新增頁面顯示條件，沒有更改會員身分、背景刷新、購物車、計價、錢包、付款或訂單邏輯。

## 回歸範圍

新增 [checkout-first-member-banner.spec.ts](../../../tests/checkout-first-member-banner.spec.ts)，使用未看過橫幅、未送過美容師申請的一般會員，沒有預設 dismiss、強制點擊或 CSS 隱藏。

- 從商城確認邀請可見，經購物車進入結帳後邀請消失。
- 公司發票及使用 500 元購物金，均能以正常點擊確認訂單，只建立一單及一個付款請求；銀行應付額分別為 4,100／3,600 元。
- 背景 focus 刷新會員資格後，邀請仍不進入結帳頁，原姓名 input 保持掛載且保留輸入。
- 直接載入結帳，延遲的申請資格查詢完成後，仍不插入邀請或清空姓名。
- 點品牌連結離開後邀請重新可見；瀏覽器返回、重新整理結帳後仍不顯示。
- 全程確認 `eclado_pro_banner_<memberId>` 沒有被寫成已看過。

## 結果

| 檢查 | 結果 |
|---|---|
| 修正前，新手機公司發票案例 | 預期失敗：進入 checkout 後仍有 1 個邀請，違反應為 0 的斷言。證明案例可偵測原缺陷。 |
| 修正後，新檔完整執行 | 6 通過、0 失敗、0 跳過，約 9.4 秒；三個情境各跑桌機 Chromium／Pixel 7 模擬。 |
| 既有相關回歸 | 18 通過、0 失敗、0 跳過，約 14.6 秒。 |

既有回歸包含結帳／購物車背景刷新、角色尚未完成載入時保留購物車、離線與切換帳號、LINE 登入返回結帳、公司發票、購物金，以及美容師申請原檔案 input 在刷新時保持 mounted。

第一次執行新檔時，手機的離開頁面步驟使用了只在桌機可見的「所有產品」連結而逾時；改為桌機／手機都有的品牌連結後，重新完整跑 6 項通過。這是測試定位修正，沒有修改產品導覽。

## 重跑指令

在 `eclado` 目錄執行：

```sh
npm run test:e2e -- tests/checkout-first-member-banner.spec.ts --workers=2

npm run test:e2e -- tests/member-cart.spec.ts tests/checkout-price-confirmation.spec.ts \
  tests/professional-registration.spec.ts tests/eclado-frontend.spec.ts \
  --grep '背景|會員身分尚未載入|一般會員公司發票|登入會員可選擇購物金|LINE 登入結帳|離線修改重新整理' \
  --workers=3
```

測試使用本機 Vite、模擬登入／API／銀行，未觸發正式交易。這次沒有重跑完整全站、修改部署或發布；iPhone Safari／LINE 實機尚未驗收。R23 狀態為程式與自動回歸完成，待發布及實機確認。
