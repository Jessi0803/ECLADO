# 會員購物車儲存與同步

本次只處理會員購物車，不包含未結帳提醒、通知內容設定或排程。

## 行為

- 訪客使用既有 `eclado_cart_v1` 本機購物車。會員身份及角色確認後，才轉移至該會員。
- 登入合併以商品 ID + 規格 ID 識別品項。同品項取兩邊數量最大值，不相加；一般購買品項優先於 recommendationOnly 標記。
- 登入後的本機備份與待同步操作按會員 ID 隔離，登出不會把會員商品轉成訪客商品；切換帳號不會挪用上一人的內容。
- 每次變更先保存待同步操作，再送往後端；連線恢復、視窗聚焦、頁面重新可見及每 30 秒會重試／重新讀取。背景更新不重建會員表單。
- 更新逐項套用，其他裝置新增的不同品項不會被整車覆寫。同品項衝突採伺服器最後接受的操作為準。購物車不鎖庫存。
- 伺服器用每會員資料列鎖序列化更新，以操作 UUID 去重；遲到的回應不得覆蓋本機已知的較新 revision。
- 後端與本機只保留商品、規格、數量及既有 recommendationOnly 標記，不保存價格、折扣、商品名稱、收件資料或付款資料。最多 200 個品項、每品項 1–99 件。
- 商品目錄重新補齊價格及顯示資訊，會員資格確認後才剔除不可購買品項；活動商品目錄讀取失敗時保留資料待重試。
- 延續既有付款流程：付款單與恢復資訊儲存成功後，從當前購物車扣除本次購買數量，保留付款期間另外加入的商品。付款服務失敗時仍保留購物車。
- 離線操作仍以這台瀏覽器的待同步紀錄為準；同步成功前清除網站資料，會失去這些未同步操作。

## 部署順序

1. 在目標 Supabase 執行 `supabase-member-carts.sql`，再部署前端。SQL 可重跑，不修改訂單、付款、會員角色或庫存邏輯。
2. `member_carts` 與 `member_cart_operations` 開啟 RLS，且不開放 anon/authenticated 直接存取。僅 authenticated 可執行 `sync_my_cart`，函式強制 `p_member_id = auth.uid()`。
3. 用兩個不同會員檢查帳號隔離，再用同一會員的兩台裝置檢查新增、改量、移除及重新登入。
4. 正式環境請額外實機確認 iPhone Safari／LINE 返回頁面後的購物車與未送出表單。自動化已保留原始選檔欄位節點的回歸測試，不能取代原生選檔器的實機行為。

遷移與發布狀態請以實際部署紀錄為準。回退前端不需刪除資料表；請保留會員購物車及操作紀錄，以免破壞重試去重。`member_cart_operations` 是去重帳本，不宜直接定期刪除，需先定義離線操作的有效期限才能規劃清理。

## 驗證

```sh
node --test tests/unit/member-cart.test.mjs
PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node --test tests/integration/member-cart-db.test.cjs
npx playwright test tests/member-cart.spec.ts --project=chromium --project=mobile-chrome --workers=1
```

另外執行既有會員角色尚未載入、購物車儲存與規格還原、購物車操作、結帳及美容師申請背景更新選檔欄位測試。所有付款測試使用攔截 API，不送正式金流或真實訂單。
