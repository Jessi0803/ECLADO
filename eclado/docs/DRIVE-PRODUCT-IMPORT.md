# Drive Product Import Rules

Google Drive 的「官網產品圖」資料夾匯入時，採用以下規則。

## Folder Mapping

- 每個子資料夾代表一個商品。
- 子資料夾名稱作為商品中文名稱與來源資料夾名稱。
- 子資料夾中的圖片寫入商品圖庫；檔名包含「首圖」的圖片會排在第一張並作為 `image_url` 主圖，其餘圖片依檔名排序後保留在 `image_urls`。
- 如果資料夾內沒有檔名包含「首圖」的圖片，則依檔名排序後的第一張圖片作為主圖。
- 子資料夾中的 `.txt` 作為商品介紹、成分、容量、適合膚況與價格來源。

## Import Command

下載或同步 Drive 資料夾到本機後，可執行：

```bash
node scripts/drive-product-import.mjs "/path/to/官網產品圖"
```

腳本會輸出：

- `tmp/drive-product-import/products-import.json`
- `tmp/drive-product-import/products-import.sql`

先檢查 JSON，再把 SQL 套到 Supabase。

## Professional Product Rule

- 如果 `.txt` 同時出現 `市場價` 與 `專業價`：
  - `price` 使用市場價。
  - `pro_price` 使用專業價。
  - `is_pro_only` 設為 `false`。
- 如果 `.txt` 只有 `專業價`，沒有 `市場價`：
  - `pro_price` 使用專業價。
  - `is_pro_only` 設為 `true`。
  - 一般會員仍可在前台看到商品卡、商品圖片與商品介紹。
  - 一般會員不可看到價格、不可加入購物車，前台改顯示 LINE 詢問與購買資格說明。
  - 美容師、師資、經銷商沿用既有專業會員購買規則。

## Variants

- 如果 `.txt` 內有多個容量與價格組合，寫入 `product_variants`。
- 同時可在 `products.variants` 保留同樣 JSON，作為 `product_variants` 尚未建立或匯入失敗時的 fallback。
- `products.size`、`products.price`、`products.pro_price` 保留第一個或預設規格，作為商品卡與舊流程 fallback。
- 前台商品詳情頁會顯示容量規格按鈕；不同容量加入購物車時會分開列。
- 師資價與經銷價不另外匯入，沿用前台現有規則由 `pro_price` 計算。
