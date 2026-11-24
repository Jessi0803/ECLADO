# 結帳測試逐檔索引

盤點日期：2026-11-24。範圍、覆蓋判斷及優先順序見 [風險矩陣](checkout-test-risk-matrix-2026-11-24.md)。

共掃描 153 個測試檔。每個檔案保留目前工作區的 SHA256 於 [JSON 清單](checkout-test-inventory-2026-11-24.json)。以下宣告文字保留迴圈及變數，不能直接加總為案例數。

## 購物車與身分

### eclado/tests/auth-email.spec.ts

[原始檔](../tests/auth-email.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L11：`test('點「忘記密碼？」切換到忘記密碼表單，登入/註冊 tab 消失', async ({ page }) => {`
- L30：`test('送出後顯示「密碼重設信已發送」成功訊息', async ({ page }) => {`
- L43：`test('Supabase 回傳錯誤時顯示錯誤訊息', async ({ page }) => {`
- L90：`test('進入 /reset-password 顯示重設密碼表單', async ({ page }) => {`
- L96：`test('密碼少於 6 字元顯示錯誤，不送出 API', async ({ page }) => {`
- L113：`test('兩次密碼不一致顯示錯誤，不送出 API', async ({ page }) => {`
- L130：`test('密碼符合條件，成功更新後顯示「密碼已更新」', async ({ page }) => {`
- L140：`test('Supabase 回傳錯誤（連結失效）顯示錯誤訊息', async ({ page }) => {`
- L161：`test('Email 驗證後重導回登入頁，顯示「Email 已驗證成功」訊息', async ({ page }) => {`
- L175：`test('密碼登入成功後進入首頁且不顯示網路異常', async ({ page }) => {`
- L187：`test('密碼錯誤時顯示正確錯誤提示且不建立資料', async ({ page }) => {`
- L215：`test('Email 未驗證時顯示驗證提示且不建立資料', async ({ page }) => {`

### eclado/tests/integration/email-click.spec.ts

[原始檔](../tests/integration/email-click.spec.ts)｜Playwright｜外部整合；需明確啟用及測試憑證

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

須啟用 RUN_* 並提供專用測試設定；預設可 skip。

- L47：`test('使用者點擊驗證信連結後 email_confirmed_at 寫入資料庫', async ({ page }, testInfo) => {`
- L104：`test('使用者點擊忘記密碼連結後能成功更新密碼', async ({ page }, testInfo) => {`

### eclado/tests/integration/email.spec.ts

[原始檔](../tests/integration/email.spec.ts)｜Playwright｜外部整合；需明確啟用及測試憑證

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

須啟用 RUN_* 並提供專用測試設定；預設可 skip。

- L35：`test('新會員註冊後 Resend 確實寄出驗證信', async ({}, testInfo) => {`
- L69：`test('忘記密碼後 Resend 確實寄出重設密碼信', async ({}, testInfo) => {`

### eclado/tests/integration/instructor-student-foundation-db.test.cjs

[原始檔](../tests/integration/instructor-student-foundation-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L16：`test('1B migration scope is settings/relations only; no existing price/payment/order writes', () => {`
- L23：`test('isolated 1B: RPC permissions, validation, history, stale writes, qualification and Auth deletion', {`

### eclado/tests/integration/instructor-student-postgres-concurrency.test.cjs

[原始檔](../tests/integration/instructor-student-postgres-concurrency.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L18：`test('1B real PostgreSQL: separate sessions, bind/rebind/unbind/Auth-delete races and ACL',{`
- L101：`await t.test(ˋround ${round+1}: competing initial bindˋ,async()=>{`
- L105：`await t.test(ˋround ${round+1}: two administrators rebindˋ,async()=>{`
- L110：`for(const first of ['rebind','unbind'])await t.test(ˋround ${round+1}: ${first} wins rebind/unbindˋ,async()=>{`
- L117：`await t.test(ˋround ${round+1}: delete ${target}, deleteFirst=${deleteFirst}ˋ,async()=>{`
- L127：`for(const deleteFirst of [true,false])await t.test(ˋround ${round+1}: initial bind/teacher delete, deleteFirst=${deleteFirst}ˋ,async()=>{`
- L135：`await t.test('simultaneous start stress: 40 initial binds/rebinds',async()=>{`
- L145：`await t.test('actual caller ACL/RLS and immutable audit',async()=>{`

### eclado/tests/integration/line-handler.test.cjs

[原始檔](../tests/integration/line-handler.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L9：`test('LINE login 由伺服器產生 state 並存入 HttpOnly Cookie', () => {`
- L24：`test('LINE callback 拒絕缺少或不相符的 state，且不交換 token', async () => {`
- L42：`test('LINE callback - 新使用者會建立 auth user、profiles 與 magic link', async () => {`
- L108：`test('LINE callback - 已存在會員未填姓名時會補上 LINE 名稱並重用既有帳號', async () => {`
- L168：`test('LINE callback - 已存在會員已有姓名時不會用 LINE 名稱覆蓋', async () => {`
- L226：`test('LINE callback - LINE email 與既有會員相同時會綁定同一個帳戶', async () => {`
- L300：`test('LINE push 會送出出貨通知', async () => {`
- L348：`test('LINE push 會送出付款完成通知', async () => {`
- L398：`test('LINE push 拒絕未驗證呼叫者', async () => {`
- L472：`test('LINE push 不會通知歷史補登訂單', async () => {`

### eclado/tests/integration/professional-applications.spec.ts

[原始檔](../tests/integration/professional-applications.spec.ts)｜Playwright｜外部整合；需明確啟用及測試憑證

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

須啟用 RUN_* 並提供專用測試設定；預設可 skip。

- L22：`test('美容師申請可寫入並以 pending 狀態讀回', async ({}, testInfo) => {`
- L42：`test('核准申請：status 更新為 approved', async ({}, testInfo) => {`
- L61：`test('拒絕申請：status 更新為 rejected', async ({}, testInfo) => {`
- L80：`test('status 不接受非法值（DB constraint）', async ({}, testInfo) => {`
- L99：`test('standalone source 寫入正常', async ({}, testInfo) => {`

### eclado/tests/internal-staff-member-sql.spec.ts

[原始檔](../tests/internal-staff-member-sql.spec.ts)｜Playwright｜SQL／原始碼靜態斷言

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L7：`test('內部人員角色由後台 RPC 設定並保留師資經銷季度範圍', () => {`
- L14：`test('內部價為專業價五折並可購買專業商品', () => {`
- L19：`test('內部人員固定免運但不加入追加出貨角色', () => {`
- L26：`test('優惠券可由管理員明確選擇內部人員且不改寫既有受眾', () => {`

### eclado/tests/internal-staff-minimum.spec.ts

[原始檔](../tests/internal-staff-minimum.spec.ts)｜Playwright｜SQL／原始碼靜態斷言

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L5：`test('內部人員折扣後須滿5000、固定免運、不使用追加資格', () => {`

### eclado/tests/member-cart.spec.ts

[原始檔](../tests/member-cart.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區：??。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L37：`test('登入合併訪客購物車、更新數量、移除並在全新裝置恢復', async ({ page, browser }) => {`
- L67：`test('離線修改重新整理後保留，恢復連線同步；登出與切換帳號不帶入商品', async ({ page }) => {`
- L92：`test('背景同步另一裝置購物車時保留結帳表單與同一個輸入欄位', async ({ page }) => {`
- L107：`test('會員結帳完成後同步移除已購品項並保留付款期間新加入的商品', async ({ page }) => {`
- L141：`test('後端購物車還原數字規格 ID 並使用最新規格價格', async ({ page }) => {`
- L152：`test('同一會員的兩個分頁可同步新增與移除', async ({ page, context }) => {`
- L171：`test('購物車頁可由導覽列收合，側欄從視窗頂端覆蓋導覽列', async ({ page }) => {`
- L199：`test('提醒連結未登入時可登入並還原會員購物車', async ({ page }) => {`
- L213：`test('LINE 登入提醒連結後回到會員購物車',async({page})=>{`
- L225：`test('購物車側欄遇到導覽或瀏覽器返回會收合並恢復頁面捲動',async({page})=>{`

### eclado/tests/professional-registration.spec.ts

[原始檔](../tests/professional-registration.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區： M。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L66：`test('未登入點擊美容師申請會導到登入頁並顯示提醒', async ({ page }) => {`
- L74：`test('一般會員註冊表單不顯示美容師申請欄位', async ({ page }) => {`
- L83：`test('登入一般會員後，美容師申請頁顯示申請欄位', async ({ page }) => {`
- L99：`test('一般會員註冊：signUp metadata 攜帶 role=consumer，不觸發 professional_applications POST', async ({ page }) => {`
- L139：`test('美容師申請頁：送出後安全 RPC 帶正確資料並進入審核中', async ({ page }) => {`
- L177：`test('美容師申請發票資料可留白，填寫時需同時提供公司抬頭與八位統編', async ({ page }) => {`
- L200：`test('背景更新會員資料時保留美容師申請的選檔欄位', async ({ page }) => {`
- L227：`test(ˋ美容師申請可選填上傳最多三張私人證照圖片${fallback ? '（JPEG 備援）' : ''}ˋ, async ({ page }) => {`
- L274：`test('審核中會員不能再次送出美容師申請', async ({ page }) => {`
- L293：`test('已是美容師會員不能再次送出美容師申請', async ({ page }) => {`
- L313：`test('DB 已有 pending 申請的 consumer 會員不能再次送出（DB 層防重複）', async ({ page }) => {`
- L339：`test('會員可以在會員資料編輯自己的姓名', async ({ page }) => {`
- L366：`test('專業會員只能查看美容院資料並可編輯預設發票資料', async ({ page }) => {`
- L403：`test('一般會員不顯示美容院與發票預設資料', async ({ page }) => {`

### eclado/tests/student-pricing.spec.ts

[原始檔](../tests/student-pricing.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L14：`test('student price display is identity scoped; six original roles remain unchanged',()=>{`
- L23：`test('server student prices reach list, variants and cart; focus changes refresh them',async({page})=>{`
- L37：`test('OFF or pre-1C database preserves professional prices',async({page})=>{`
- L43：`test('price lookup failure is not mistaken for OFF',async({page})=>{`
- L48：`test('assisted manual equality stays MANUAL and AUTO uses server preview',async({page})=>{`
- L70：`test('old assisted backend cannot silently treat AUTO as manual',async({page})=>{`

### eclado/tests/unit/member-cart.test.mjs

[原始檔](../tests/unit/member-cart.test.mjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：直接或跨流程相關。工作區：tracked clean。本次執行通過。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L43：`test('guest merge is union/max; same specification is never added twice', () => {`
- L48：`test('checkout subtracts only purchased quantities and specifications', () => {`
- L53：`test('offline updates persist per member and replay on reload without price data', async () => {`
- L71：`test('lost response retry is deduplicated; another device additions survive removal', async () => {`
- L87：`test('changes while read is in flight overlay server state and are subsequently saved', async () => {`
- L100：`test('late response cannot replace another account state; shared tabs keep independent operations', async () => {`
- L118：`test('a delayed response cannot replace a newer server revision saved by another tab', async () => {`
- L131：`test('adding before the first restore merges rather than reducing an unseen quantity', async () => {`
- L139：`test('checkout consumes current server quantities once even after a lost response', async () => {`
- L151：`test('a failed initial restore still merges unseen items after connection recovers', async () => {`

## 報價與會員定價

### eclado/tests/cart-minimum-preview.spec.ts

[原始檔](../tests/cart-minimum-preview.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L6：`test('only consistent minimum errors become display-only previews',()=>{`
- L17：`test('cart shows qualified activity, authoritative payable and shortage, then clears preview after adding goods',async({page})=>{`
- L46：`test(ˋ${view} without an applied activity shows a compact actual minimum shortfallˋ,async({page})=>{`

### eclado/tests/integration/cart-minimum-preview-db.test.cjs

[原始檔](../tests/integration/cart-minimum-preview-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L5：`test('cart minimum preview keeps rejected quotes and order guards, including student BOGO and append orders', {`

### eclado/tests/integration/member-pricing-db.test.cjs

[原始檔](../tests/integration/member-pricing-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L18：`test('isolated DB: migration, authoritative prices, saves, roles, audit, stale versions and rerun', { skip:!process.env.PGLITE_MODULE }, async () => {`

### eclado/tests/member-price-rounding.spec.ts

[原始檔](../tests/member-price-rounding.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區：??。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L31：`test('師資購物車18品項23件的每一項價格及總額都與後端報價一致', () => {`
- L42：`test('會員倍率以十進位四捨五入，半元上下不因浮點誤差錯價', () => {`
- L56：`test('整車師資信用卡結帳一次成功到付款頁，不觸發價差確認', async ({ page }) => {`

### eclado/tests/member-pricing-admin.spec.ts

[原始檔](../tests/member-pricing-admin.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L20：`test('全域設定確認後送出三身份倍率與原版本，不修改會員身份', async ({ page }) => {`
- L36：`test('取消確認不寫入、版本衝突保留輸入並要求重新載入', async ({ page }) => {`
- L52：`test('商品編輯移除舊勾選，三身份個別折數與全域提示共用所有規格', async ({ page }) => {`
- L64：`test('商品小編沒有全域設定入口', async ({ page }) => {`
- L69：`test('師資商品卡及規格切換使用商品88折，而非全域70折', async ({ page }) => {`
- L84：`test('SQL未部署：全域設定失敗時不允許以預設假值儲存', async ({ page }) => {`

### eclado/tests/member-pricing.spec.ts

[原始檔](../tests/member-pricing.spec.ts)｜Playwright｜純函式／靜態或自行攔截的瀏覽器案例；依個別案例判讀

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L5：`test('折數輸入：空值繼承、10折不打折、8.8折為88%，拒絕無效值', () => {`
- L15：`test('個別倍率取代全域而非相乘；三身份互不影響', () => {`
- L27：`test('舊未勾選商品三身份皆不打折；新資料不再由舊flag決定價格', () => {`
- L36：`test('SQL守住權限、併發、一次性轉換、既有報價及稽核邊界', () => {`

### eclado/tests/professional-price-quote-hardening-sql.spec.ts

[原始檔](../tests/professional-price-quote-hardening-sql.spec.ts)｜Playwright｜SQL／原始碼靜態斷言

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L14：`test('hardening wrapper removes raw professional pricing inputs from both item copies', () => {`
- L21：`test('raw pricing and renamed discount helpers are not client-callable', () => {`
- L32：`test('public two-argument compatibility signature remains available', () => {`
- L38：`test('migration fails closed unless coupon and gift pricing layers are present', () => {`
- L49：`test('post-deployment verification inspects the wrapped pricing core', () => {`

### eclado/tests/promotion-pricing-engine-sql.spec.ts

[原始檔](../tests/promotion-pricing-engine-sql.spec.ts)｜Playwright｜SQL／原始碼靜態斷言

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L20：`test('第二批提供不建立訂單的後端權威報價 RPC', () => {`
- L30：`test('建立訂單與試算共用同一個計價核心', () => {`
- L42：`test('第二批只接受現有自動折扣，不會提前套用優惠券或贈品', () => {`
- L54：`test('會員價、專業門檻、運費與活動擇優規則仍存在權威核心', () => {`
- L67：`test('公開報價與新訂單快照不序列化專業價計算輸入', () => {`

## 活動優惠與贈品

### eclado/tests/automatic-price-allocation.spec.ts

[原始檔](../tests/automatic-price-allocation.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L4：`test('購物車以權威報價列出多筆活動，數量變更重新試算', async ({ page }) => {`
- L38：`test('合計同額但活動分配改變，付款前仍需再次確認', async ({ page }) => {`

### eclado/tests/coupon-discount-engine-sql.spec.ts

[原始檔](../tests/coupon-discount-engine-sql.spec.ts)｜Playwright｜SQL／原始碼靜態斷言

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L7：`test('batch 3 exposes sanitized coupon quote and compatible order overloads', () => {`
- L15：`test('coupon quota is checked and transactionally reserved', () => {`
- L23：`test('batch 3 calculates price benefits while allowing batch 4 gift-only coupons', () => {`
- L29：`test('percentage and fixed discounts support amount or quantity thresholds', () => {`
- L37：`test('coupon configuration stays private and admin writes are transactional RPCs', () => {`
- L45：`test('all-regular scope excludes event and gift-only products', () => {`

### eclado/tests/coupon-member-targeting-sql.spec.ts

[原始檔](../tests/coupon-member-targeting-sql.spec.ts)｜Playwright｜SQL／原始碼靜態斷言

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L9：`test('指定會員優惠券使用正規化關聯表與受權限保護的會員搜尋', () => {`
- L18：`test('指定會員模式不允許訪客且由同一後端函式驗證試算與建單', () => {`
- L27：`test('優惠券儲存會同步指定會員名單並保留既有身分模式相容性', () => {`
- L34：`test('指定會員搜尋會帶出並比對美容師聯絡人與皮膚管理院', () => {`

### eclado/tests/integration/automatic-price-allocation-db.test.cjs

[原始檔](../tests/integration/automatic-price-allocation-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L6：`test('automatic price allocation: installed pricing, exact differential reference, persistence and rollback', {`
- L204：`test('automatic allocation preserves double-wallet reservation and authoritative payment amount', {`

### eclado/tests/integration/automatic-promotion-allocation-contract.test.cjs

[原始檔](../tests/integration/automatic-promotion-allocation-contract.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L122：`test(fixture.name, () => {`
- L140：`test(ˋ${stacking} 不執行自動價格分配（非優惠券引擎整合測試）ˋ, () => {`
- L144：`test('同額依 priority、建立時間、ID 穩定判定', () => {`
- L151：`test('超出參考搜尋預算明確拒絕，不偷偷改貪婪結果', () => {`
- L154：`test('單件任意兩活動的最佳折抵符合直接可列舉答案', () => {`

### eclado/tests/integration/automatic-promotion-audience-db.test.cjs

[原始檔](../tests/integration/automatic-promotion-audience-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L12：`test('automatic audience: real pricing, gifts, assisted identity, atomic saves and rerun', {skip:!process.env.PGLITE_MODULE}, async()=>{`

### eclado/tests/integration/buy-x-get-y-db.test.cjs

[原始檔](../tests/integration/buy-x-get-y-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L5：`test('buy X get Y: mixed units, repeat, audience, coupons, snapshots and inventory',{`
- L131：`test('buy X get Y preserves installed reward-wallet and payment wrappers',{`

### eclado/tests/integration/coupon-member-create-compat.test.cjs

[原始檔](../tests/integration/coupon-member-create-compat.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L6：`test('member-targeted coupon quote and create use the same identity rule', {`

### eclado/tests/integration/promotion-multi-gifts.test.cjs

[原始檔](../tests/integration/promotion-multi-gifts.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L13：`test('multi gift migration: actual SQL calculation, editor, compatibility and ACL', {`
- L62：`await t.test('old single gift migrates, partial quantity granted', async () => {`
- L65：`await t.test('unauthorized save rejected', async () => { await assert.rejects(save(payload), /authorization/); });`
- L68：`await t.test('multiple rewards cap independently and skip zero stock, storefront and assisted agree', async () => {`
- L75：`await t.test('below threshold gives nothing', async () => { assert.equal((await quote([{qty:1,line_total:999}])).gifts.length,0); });`
- L76：`await t.test('repeat reward capped after multiplication and subtracts outstanding reservations', async () => {`
- L83：`await t.test('quantity gifts qualify by item count, not amount, and cap each reward', async () => {`
- L89：`await t.test('disabled reward skipped without suppressing remaining rewards; cannot save disabled reward', async () => {`
- L95：`await t.test('shared variant across activities cannot spend inventory twice', async () => {`
- L100：`await t.test('invalid/duplicate/disabled rewards and old client overwrite rejected atomically', async () => {`
- L109：`await t.test('actual order creator preserves all gift lines and reservations; next order gets remaining stock', async () => {`
- L142：`await t.test('zero inventory allows qualifying gift coupon with no gifts; unmet threshold still rejected', async () => {`
- L149：`await t.test('ACL: reward definitions only readable by backoffice, private save not callable', async () => {`

### eclado/tests/integration/promotion-student-policy-db.test.cjs

[原始檔](../tests/integration/promotion-student-policy-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區： M。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L6：`test('student policy: authoritative allocation, mixed rewards, coupons, snapshots and rollback', {`
- L218：`test('student policy migration preserves installed double-wallet checkout and bank amount', {`
- L248：`test('variant activity save and checkout use the same qualification and benefit scope', {`

### eclado/tests/promotion-display.spec.ts

[原始檔](../tests/promotion-display.spec.ts)｜Playwright｜純函式／靜態或自行攔截的瀏覽器案例；依個別案例判讀

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L15：`test(ˋ${invalid.name}不顯示活動說明且不影響原價ˋ, () => {`
- L25：`test('有效折扣與不使用舊折扣欄位的贈品活動仍可顯示', () => {`

### eclado/tests/promotion-gifts-engine-sql.spec.ts

[原始檔](../tests/promotion-gifts-engine-sql.spec.ts)｜Playwright｜SQL／原始碼靜態斷言

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L9：`test('batch 4 adds amount and quantity gifts to the authoritative quote', () => {`
- L21：`test('renamed pricing helpers cannot retain public-facing execute grants', () => {`
- L31：`test('gift stock is reserved atomically and cannot become a backorder', () => {`
- L42：`test('payment consumes and cancellation releases the gift reservation', () => {`
- L50：`test('admin save requires enabled gift inventory', () => {`
- L56：`test('all-sellable scope includes active and event-only products through the authoritative matcher', () => {`
- L63：`test('public catalog RPCs hide gift inventory operational fields', () => {`
- L69：`test('catalog product save accepts the gift-only publication status', () => {`
- L77：`test('event catalog migration preserves gift-only products and exposes its RPC', () => {`
- L84：`test('final admin save preserves discount threshold type', () => {`

### eclado/tests/promotion-student-policy.spec.ts

[原始檔](../tests/promotion-student-policy.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L18：`test('空活動列表仍可設定學生政策，缺少欄位時保留舊相容模式', async ({ page }) => {`
- L38：`test('學生互斥活動複製保留兩個政策，優惠券專用恢復原規則', async ({ page }) => {`
- L58：`test('既有複合活動在活動編輯調整政策，保留唯讀條件與過期防護', async ({ page }) => {`
- L77：`test('一般活動由同一編輯表單儲存學生價與返饋設定', async ({ page }) => {`
- L93：`test('學生價不疊活動的估價等待後端，價格調整可核對同額方案', () => {`
- L106：`test('購物車與結帳正確顯示不疊學生價的加回金額', async ({ page }) => {`

### eclado/tests/promotions-coupons-foundation-sql.spec.ts

[原始檔](../tests/promotions-coupons-foundation-sql.spec.ts)｜Playwright｜SQL／原始碼靜態斷言

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L10：`test('優惠券第一批 migration 建立完整加法資料結構', () => {`
- L31：`test('優惠券與贈品交易表不允許前端直接寫入', () => {`
- L51：`test('優惠券代碼不會寫入管理員稽核內容', () => {`
- L62：`test('第一批不取代現行結帳活動計算', () => {`

## 結帳操作與狀態

### eclado/tests/checkout-price-confirmation.spec.ts

[原始檔](../tests/checkout-price-confirmation.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區：??。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L56：`test('手機按確認後停在新金額與按鈕，不建單不跳頁；再次確認才付款', async ({ page }) => {`
- L76：`test('再次變價必須重新停留，不能用上一次已顯示的金額建單', async ({ page }) => {`
- L89：`test('返回修改保留收件資料，修改後不能沿用舊的報價確認', async ({ page }) => {`
- L105：`test('背景刷新保留提示，購物車改量則作廢舊確認並重新檢查', async ({ page }) => {`
- L127：`test('離開結帳不建單；第一次連點不會自動接受新金額', async ({ page }) => {`

### eclado/tests/checkout-summary-width.spec.ts

[原始檔](../tests/checkout-summary-width.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L19：`for(const width of [320,390,1280])test(ˋcheckout activity and gift text stays inside ${width}px viewport in both stepsˋ,async({page})=>{`

### eclado/tests/eclado-frontend.spec.ts

[原始檔](../tests/eclado-frontend.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區： M。本次僅收集案例，未執行。

有條件 skip，依案例判讀。

- L49：`test('活動限定商品只出現在未列出的活動路徑並標示 noindex', async ({ page }) => {`
- L142：`test('主要路徑可開啟且不白屏', async ({ page }) => {`
- L152：`test('LINE 內建瀏覽器只對固定導覽列啟用合成層穩定處理', async ({ page }) => {`
- L180：`test('首頁依指定順序呈現熱門商品、品牌理念、三大系列與六篇專欄', async ({ page }) => {`
- L210：`test('首頁第一張與第三張輪播的探索系列按鈕皆前往商城', async ({ page }) => {`
- L222：`test('首頁六篇專欄可進入完整文章、列表及上一篇下一篇且不顯示閱讀時間', async ({ page }) => {`
- L245：`test('首頁頁尾訪客訂單查詢可進入查詢頁並返回首頁', async ({ page }) => {`
- L254：`test('從登入頁進入訪客訂單查詢時返回登入頁', async ({ page }) => {`
- L262：`test('商品 API 尚未完成時不顯示內建 fallback 商品', async ({ page }) => {`
- L287：`test('聯絡我們與隱私權由前台 SPA 路由呈現', async ({ page }) => {`
- L297：`test('LINE 登入結帳回來後會回到結帳頁', async ({ page }) => {`
- L313：`test('LINE magic link 即使遺失 pending sessionStorage 仍會回到首頁', async ({ page }) => {`
- L325：`test('商城瀏覽、商品詳情、一般會員價格與院線商品限制', async ({ page }) => {`
- L338：`test('商品具有可分享唯一路徑，重新整理與返回列表皆正常', async ({ page }) => {`
- L359：`test('商品新分類正確，院線商品不重複出現在一般分類', async ({ page }) => {`
- L375：`test('手機分類橫向選單會自動捲入目前選取項目', async ({ page, isMobile }) => {`
- L398：`test('導覽列所有產品下拉分類會帶入商城分類並保留可分享網址', async ({ page, isMobile }) => {`
- L419：`test('商城可在功效分類與系列分類間切換並保留系列網址', async ({ page }) => {`
- L438：`test('後台以規格表格與交易式 RPC 儲存商品', async ({ page }) => {`
- L506：`test('後台新商品預設為草稿並提供五種發布狀態', async ({ page }) => {`
- L535：`test(ˋ後台可上傳多圖、指定首圖並以 RPC 儲存圖片順序（${jpegFallback ? 'JPG 備援' : 'WebP'}）ˋ, async ({ page }) => {`
- L607：`test(ˋ會員角色價格：${scenario.role} 看到對應價格並可購買院線商品ˋ, async ({ page }) => {`
- L630：`test(ˋ會員身分尚未載入時保留院線購物車，確認 ${role} 身分後才校驗購買資格ˋ, async ({ page }) => {`
- L668：`test('內部人員以專業價五折購買院線商品、最低五千且固定免運、不使用追加規則', async ({ page }) => {`
- L694：`test(ˋ固定專業價商品不套用 ${role} 身分倍率ˋ, async ({ page }) => {`
- L724：`test('一般會員不顯示會員購物須知', async ({ page }) => {`
- L734：`test('專業會員購物車即時提示最低訂購與免運門檻', async ({ page }) => {`
- L771：`test('專業會員有已付款可追加批次時低於五千仍可結帳且不重複收運費', async ({ page }) => {`
- L812：`test('DB 的 is_pro_only=true 會讓原本公開商品變院線限定', async ({ page }) => {`
- L828：`test('DB 的 price 覆蓋寫死的售價', async ({ page }) => {`
- L840：`test('Storage 商品圖片優先於舊欄位，並套用首圖、排序與停用規則', async ({ page }) => {`
- L891：`test('商品多容量規格可切換價格並分開加入購物車', async ({ page }) => {`
- L923：`test('DB 新增的商品會顯示在商城', async ({ page }) => {`
- L956：`test('DB 下架的商品不會顯示在商城', async ({ page }) => {`
- L966：`test('購物車中的商品收到下架更新後會被移除', async ({ page }) => {`
- L985：`test('購物車中的商品價格變更後會以最新價格重算', async ({ page }) => {`
- L1004：`test('購物車中的商品變成院線限定後一般會員不可繼續結帳', async ({ page }) => {`
- L1023：`test('購物車中的商品庫存變成零時會同步顯示預購', async ({ page }) => {`
- L1042：`test('現貨、預購、活動折扣與購物車操作', async ({ page }) => {`
- L1064：`test('優惠券專用活動不會在輸入優惠碼前當成自動折扣', async ({ page }) => {`
- L1086：`test(ˋ${scenario.name}僅在購物車達標後折抵ˋ, async ({ page }) => {`
- L1115：`test('活動折扣可先減金額再打折', async ({ page }) => {`
- L1136：`test('active=false 的停用活動不會顯示或套用折扣', async ({ page }) => {`
- L1153：`test('多個活動符合時套用折抵金額最高的一個', async ({ page }) => {`
- L1170：`test('異常折扣率與負折抵活動會被忽略', async ({ page }) => {`
- L1188：`test('尚未開始與已結束的活動不會套用折扣', async ({ page }) => {`
- L1201：`test('首頁優惠商品排成單列，捲動時固定各活動標題', async ({ page }) => {`
- L1246：`test('首頁滿件贈與滿額贈在指定商品右側顯示贈品卡', async ({ page }) => {`
- L1281：`test('活動開始與結束時間邊界依排程精確生效', async ({ page }) => {`
- L1305：`test('庫存為 0 顯示預購，且一般商品仍可加入購物車下單', async ({ page }) => {`
- L1319：`test('購物車重新整理後仍保留，且 localStorage 不保存價格資料', async ({ page }) => {`
- L1348：`test('數字型規格 ID 經 localStorage 還原後仍保留商品與正確價格', async ({ page }) => {`
- L1375：`test('結帳建立付款單但不寫入真實訂單或真金流', async ({ page }) => {`
- L1413：`test('專業會員公司發票帶入預設值並以本次修改內容保存訂單快照', async ({ page }) => {`
- L1458：`test('一般會員公司發票不帶入會員預設值但可填寫本次訂單資料', async ({ page }) => {`
- L1498：`test('付款單訂單明細優先顯示 product_images 的 Storage 首圖', async ({ page }) => {`
- L1523：`test(ˋ${scenario.name} 付款單在重新整理後恢復原付款資訊ˋ, async ({ page }) => {`
- L1547：`test(ˋ恢復 ${state} 付款時顯示對應標題並維持原付款限制ˋ, async ({ page }) => {`
- L1563：`test('舊付款單已付款時清除恢復紀錄，新的購物車可建立新付款單', async ({ page }) => {`
- L1595：`test('逾期付款單重新整理後停用付款入口且不建立第二張付款單', async ({ page }) => {`
- L1618：`test('後台取消訂單後清除本機付款恢復紀錄', async ({ page }) => {`
- L1632：`test('付款查詢暫時失敗時可手動清除舊紀錄', async ({ page }) => {`
- L1644：`test('後端成交價與預覽不同時須重新確認才建立付款單', async ({ page }) => {`
- L1679：`test('登入會員結帳會寫入訂單 payload 與 user_id，付款前不扣庫存', async ({ page }) => {`
- L1724：`test('登入會員可選擇購物金支付商品金額並保留至少一元外部付款', async ({ page }) => {`
- L1776：`test('全部為客訂規格時可選現場自取且後端訂單運費為零', async ({ page }) => {`
- L1810：`test('一般商品與混合購物車都只能宅配', async ({ page }) => {`
- L1834：`test('結帳可試算一組優惠碼並以同一代碼建立權威訂單', async ({ page }) => {`
- L1868：`test('竄改混合購物車為現場自取會被後端拒絕', async ({ page }) => {`
- L1899：`test('訪客付款單顯示短查詢碼與訂單成立信寄送結果', async ({ page }) => {`
- L1921：`test('訪客可用短查詢碼與結帳手機查看訂單，並在待付款時返回付款單', async ({ page }) => {`
- L1960：`test('訪客訂單查詢在重新整理後以短效憑證恢復，不需再次輸入手機', async ({ page }) => {`
- L1990：`test('訪客重新驗證查詢碼與手機後可從訂單明細重新付款', async ({ page }) => {`
- L2023：`test('訪客可查看已出貨訂單與順豐托運資訊，已付款後不顯示付款入口', async ({ page }) => {`
- L2045：`test('訪客逾期或已取消訂單不可重新付款或建立第二張付款單', async ({ page }) => {`
- L2066：`test('信用卡、Apple Pay、Google Pay 會送出對應金流 payType', async ({ page }) => {`
- L2112：`test('信用卡付款使用同分頁按鈕，並在付款結果頁權威確認成功', async ({ page }) => {`
- L2152：`test('付款回站即使沒有原分頁 session，仍可用限時結果憑證確認成功', async ({ page }) => {`
- L2169：`test('付款結果頁顯示購物金後的實際銀行付款金額', async ({ page }) => {`
- L2181：`test('付款回站遇到通知時間差會自動重查直到成功', async ({ page }) => {`
- L2200：`test('付款失敗頁保留原訂單並建立新的付款嘗試', async ({ page }) => {`
- L2243：`test('金流建單失敗時顯示錯誤且不進入付款完成畫面', async ({ page }) => {`
- L2270：`test('快速重複點擊建立付款單只會送出一次金流請求', async ({ page }) => {`
- L2304：`test('權威訂單建立失敗時不建立付款單', async ({ page }) => {`
- L2335：`test('會員專區顯示自己的訂單與托運單號', async ({ page }) => {`
- L2368：`test('會員專區安全顯示歷史補登且不偽造付款物流或內部備註', async ({ page }) => {`
- L2401：`test('會員專區隱藏後台已作廢的歷史補登但保留一般取消訂單', async ({ page }) => {`
- L2428：`test('會員專區顯示可用購物金並以收合明細呈現公開異動原因', async ({ page }) => {`
- L2469：`test('師資會員專區顯示以資格期間裁切的自然季採購統計', async ({ page }) => {`
- L2496：`test('師資會員專區的季度採購包含管理員補登的線下採購', async ({ page }) => {`
- L2520：`test('從首頁捲動位置進入長訂單會員專區時回到頁首', async ({ page }) => {`
- L2547：`test('會員可從我的訂單安全返回尚未付款的原付款單', async ({ page }) => {`
- L2590：`test('一般訂單使用購物金後，會員中心與重新開啟的付款單維持原折抵與銀行應付額', async ({ page }) => {`
- L2627：`test('舊分頁付款暫存缺購物金欄位時，以訂單權威資料恢復折抵', async ({ page }) => {`
- L2647：`test('購物金與應付額不一致時會員中心不開啟付款資訊', async ({ page }) => {`
- L2664：`test('付款 API 回傳舊版未帶購物金資料時不顯示原價付款單', async ({ page }) => {`
- L2685：`test('購物金訂單信用卡失敗後重試保留銀行應付額', async ({ page }) => {`
- L2724：`test('會員代客訂單顯示購物金與銀行應付額，從本人連結確認後再付款', async ({ page }) => {`
- L2759：`test('會員無法取得代客訂單連結時停留在原頁並顯示錯誤', async ({ page }) => {`
- L2771：`test('會員可從我的訂單以本人登入憑證重新付款且保留原訂單', async ({ page }) => {`
- L2805：`test('會員訂單付款期限已過時不顯示付款入口', async ({ page }) => {`
- L2829：`test('手機版主要購物流程可使用', async ({ page, isMobile }) => {`
- L2839：`test('手機版購物到結帳建立付款單可完成', async ({ page, isMobile }) => {`
- L2863：`test('未符合身分與訪客資格時不顯示自動活動或購物車折扣', async ({ page }) => {`
- L2876：`test('活動資格依目前身分判斷，訪客開關與會員身分各自獨立', async ({ page }) => {`
- L2897：`test('指定商品活動標籤與完整說明依範圍及狀態顯示', async ({ page }, testInfo) => {`
- L2926：`test('指定規格活動顯示在品項小卡與詳情，切換容量後仍列出適用規格', async ({ page }) => {`
- L2948：`test('全站公告緊接導覽列並在首頁隨主列換色，各頁保留內容間距', async ({page},testInfo)=>{`
- L2974：`test('全站公告停用、空白或讀取失敗時不留空列，減少動態時改為靜態文字', async ({page})=>{`
- L2990：`test('首頁輪播預留導覽與公告高度，三張內容不覆蓋公告或輪播指示', async ({page},testInfo)=>{`
- L3019：`test('公告排程在已開啟的頁面到時顯示與隱藏，同步收回主視覺留白',async({page})=>{`

### eclado/tests/integration/order-payment-amounts.test.mjs

[原始檔](../tests/integration/order-payment-amounts.test.mjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：直接或跨流程相關。工作區：tracked clean。本次執行通過。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L5：`test(ˋpayment snapshot: shopping ${shopping}, reward ${reward}, bank ${payment}ˋ, () => {`
- L10：`test('legacy order without wallet fields retains total fallback',()=>assert.equal(getOrderPaymentAmounts({total:1000}).paymentAmount,1000));`
- L11：`test('reject missing, negative, nonnumeric or inconsistent wallet snapshots',()=>{`

### eclado/tests/integration/staging-products.spec.ts

[原始檔](../tests/integration/staging-products.spec.ts)｜Playwright｜外部整合；需明確啟用及測試憑證

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

須啟用 RUN_* 並提供專用測試設定；預設可 skip。

- L28：`test('新增商品可保存圖片欄位，並可下架及重新上架', async ({}, testInfo) => {`

### eclado/tests/integration/storefront-display-db.test.cjs

[原始檔](../tests/integration/storefront-display-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L6：`test('storefront display: public reads, authorized RPC writes, validation and migration reapply', {skip:!process.env.PGLITE_MODULE}, async () => {`

### eclado/tests/order-discounts-display.spec.ts

[原始檔](../tests/order-discounts-display.spec.ts)｜Playwright｜純函式／靜態或自行攔截的瀏覽器案例；依個別案例判讀

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L8：`test(ˋ舊訂單優惠券備援保留名稱及遮罩且不改金額 ${Object.keys(metadata)[0]}ˋ, () => {`
- L15：`test('有明細快照時保留原明細，無券資料時保留活動及總額備援', () => {`

### eclado/tests/order-wallet-payment-merge.spec.ts

[原始檔](../tests/order-wallet-payment-merge.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L4：`test('雙錢包訂單從會員中心恢復及重新載入時保留返饋金與銀行應付額', async ({ page }) => {`

### eclado/tests/product-recommendations.spec.ts

[原始檔](../tests/product-recommendations.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區： M。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L58：`test('三份手冊：金箔片觸發金緞、安瓶分組、共通清潔不混入院線', () => {`
- L73：`test('多主商品合併推薦、已購安瓶仍保留替代款，失效商品及資格篩選', () => {`
- L90：`test('商品頁沿用商城小卡，加入後保留推薦並可重複加入或點進詳細頁', async ({ page }, testInfo) => {`
- L118：`test('院線商品頁平列安瓶小卡與擇一標示，加入後保留全部推薦', async ({ page }) => {`
- L132：`test('結帳加購重新向後端報價，保留收件資訊並顯示更新優惠運費', async ({ page }, testInfo) => {`
- L171：`test('只有推薦加購的清潔商品，不會在結帳啟動新一輪推薦', async ({ page }) => {`
- L181：`test('結帳推薦為緊湊列表，最多顯示三條半並可向下捲動，重複加購累加數量', async ({ page }, testInfo) => {`
- L206：`test('結帳混合搭配共用固定高度的捲動區，清潔與院線各有標題', async ({ page }) => {`
- L217：`test('確認付款頁驗證優惠碼期間暫停加購，加購後清除舊優惠碼報價', async ({ page }) => {`
- L252：`test(ˋ確認訂單前才加購：${pendingPreview ? '背景報價尚未返回' : '已完成重新報價'}仍以最新活動金額建單付款ˋ, async ({ page }) => {`

### eclado/tests/product-urls.spec.ts

[原始檔](../tests/product-urls.spec.ts)｜Playwright｜純函式／靜態或自行攔截的瀏覽器案例；依個別案例判讀

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L7：`test('42 組舊商品網址使用 301 導向當前英文 slug', () => {`
- L26：`test('商品 slug 只在新增時依英文名稱產生，不跟著名稱更新', () => {`
- L37：`test('未上架試用包使用對應正品的英文 slug', () => {`

### eclado/tests/recommendation-pricing-db.spec.ts

[原始檔](../tests/recommendation-pricing-db.spec.ts)｜Playwright｜瀏覽器＋隔離 SQL；身分／目錄／銀行模擬

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L77：`test(ˋ最後一步加購 SQL：${scenario.name}／${slowPreview?'預覽延遲':'預覽完成'}ˋ, async ({page}) => {`

### eclado/tests/shop-search.spec.ts

[原始檔](../tests/shop-search.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區： M。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L4：`test('search stays fixed-width at right and fills the row below modes when space runs out', async ({ page }) => {`
- L27：`test('shop name search supports Chinese and case-insensitive English and clearing', async ({ page }) => {`
- L46：`test('shop search intersects category and series; clear all resets both', async ({ page }) => {`
- L70：`test('search uses only storefront products and does not reveal restricted prices', async ({ page }) => {`

### eclado/tests/storefront-display.spec.ts

[原始檔](../tests/storefront-display.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L5：`test(ˋ供貨顯示關閉：庫存 ${stock} 隱藏詳情及購物車，結帳只留必要提醒ˋ, async ({ page }) => {`
- L33：`test('供貨顯示設定可在重新取得焦點時開關', async ({ page }) => {`
- L51：`test('系統設定可儲存供貨顯示開關，重新整理後保留', async ({ page }) => {`

## 錢包與交易生命週期

### eclado/tests/instructor-reward-checkout.spec.ts

[原始檔](../tests/instructor-reward-checkout.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區： M。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L17：`test('both wallets share one NT$1 payment floor; backend create and bank use the same amount',async({page})=>{`
- L27：`test('wallet repricing requires confirmation; refusal creates no order',async({page})=>{`
- L36：`test('insufficient server balance prevents creation and shows clear failure',async({page})=>{`
- L42：`for(const balance of [0,-100])test(ˋnonpositive balance ${balance} disables reward spendingˋ,async({page})=>{await checkout(page,'instructor',balance);await expect(page.getByRole('switch',{name:'使用返饋金'})).toBeDisabled();});`
- L43：`test('pro has no reward credit spending entrance',async({page})=>{await checkout(page,'pro');await expect(page.getByRole('switch',{name:'使用返饋金'})).toHaveCount(0);});`

### eclado/tests/instructor-reward-payment.spec.ts

[原始檔](../tests/instructor-reward-payment.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L13：`test('paid status requires explicit reward receipt confirmation; refusal does not write',async({page})=>{`
- L27：`test('read-only backoffice cannot see the manual payment confirmation action',async({page})=>{`
- L30：`test('installed dependency errors cannot silently become pre-2B compatibility',async({page})=>{`

### eclado/tests/integration/instructor-reward-checkout-db.test.cjs

[原始檔](../tests/integration/instructor-reward-checkout-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L167：`if(require.main===module)test('4: double wallet pricing, lifecycle and authoritative gateway contracts',{skip:!process.env.PGLITE_MODULE&&!process.env.EMBEDDED_POSTGRES_MODULE,timeout:180000},()=>runRewardCheckoutDatabaseScenario());`

### eclado/tests/integration/instructor-reward-ledger-db.test.cjs

[原始檔](../tests/integration/instructor-reward-ledger-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L3：`test('2B: reward ledger, verified evidence, terminal lifecycle and concurrent reconciliation',`

### eclado/tests/integration/instructor-reward-withdrawals-db.test.cjs

[原始檔](../tests/integration/instructor-reward-withdrawals-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L3：`test('5: encrypted bank snapshots, full withdrawals, immutable manual transfer and wallet concurrency',`

### eclado/tests/integration/reward-stage7a-production-coupon-compat.test.cjs

[原始檔](../tests/integration/reward-stage7a-production-coupon-compat.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L4：`test('7A: production member-targeted quote/create mismatch is reproduced without production writes',{skip:!process.env.EMBEDDED_POSTGRES_MODULE,timeout:120000},()=>runStudentPricingDatabaseScenario(async c=>{`

### eclado/tests/integration/reward-withdrawal-partial-db.test.cjs

[原始檔](../tests/integration/reward-withdrawal-partial-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L3：`test('partial withdrawals: amount validation, one batch, concurrent requests, failed retry and remaining-wallet spending',`

### eclado/tests/integration/student-reward-snapshots-db.test.cjs

[原始檔](../tests/integration/student-reward-snapshots-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L5：`test('2A: private immutable snapshots in existing ordinary/assisted transactions',`

### eclado/tests/shopping-credit-checkout-sql.spec.ts

[原始檔](../tests/shopping-credit-checkout-sql.spec.ts)｜Playwright｜SQL／原始碼靜態斷言

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L7：`test('購物金訂單保留總額並另外保存外部金流應付金額', () => {`
- L16：`test('購物金只能支付折扣後商品並保留至少一元外部付款', () => {`
- L23：`test('購物金與外部應付金額在首次 INSERT 就寫入不可變快照', () => {`
- L34：`test('付款、取消與逾期共用訂單狀態觸發器同步購物金', () => {`
- L42：`test('永豐付款 claim 使用 payment_amount 而非訂單總額', () => {`

### eclado/payment-api/reward-payment-evidence.test.cjs

[原始檔](../payment-api/reward-payment-evidence.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：直接或跨流程相關。工作區：tracked clean。本次執行通過。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L4：`test('reward proof excludes webhook/body claims, paid_at and inferred stored paid state',()=>{`
- L9：`test('only positive real bank query evidence bound to the registered provider reference qualifies',()=>{`
- L16：`test('reward failure requires explicit verified current query failure, never unknown/body/pending',()=>{`
- L22：`test('bank amount is extracted only from bound verified query; zero status stays pending',()=>{`

### eclado/payment-api/reward-payment-persistence.test.cjs

[原始檔](../payment-api/reward-payment-persistence.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：直接或跨流程相關。工作區：tracked clean。本次執行通過。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L6：`test('verified reward receipt sends no caller amount and propagates persistence failure for retry',async()=>{`
- L23：`test('released-wallet success is persisted then blocks activation; definite failure uses private release RPC',async()=>{`
- L35：`test('authoritative double-wallet net payment reaches bank as cents, caller amount ignored',async()=>{`

### eclado/payment-api/reward-schema-compatibility.test.cjs

[原始檔](../payment-api/reward-schema-compatibility.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：直接或跨流程相關。工作區：tracked clean。本次執行通過。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L12：`test('legacy order read retries only the absent reward column, preserves filters and authoritative bank amount', async () => {`
- L35：`test('permission, unrelated missing column and storage failures never downgrade the order projection', async () => {`
- L47：`test('schema cache fallback is temporary: subsequent reads use the newly installed reward column', async () => {`
- L68：`test('legacy guest lookup preserves code/phone checks and private-field redaction', async () => {`

## 付款建立與恢復

### eclado/tests/integration/payment-link-renewal-db.test.cjs

[原始檔](../tests/integration/payment-link-renewal-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L14：`test('verified renewal is atomic, private and preserves inventory and wallet reservations', {`

### eclado/tests/integration/payment-rpc-access-db.test.cjs

[原始檔](../tests/integration/payment-rpc-access-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L15：`test('payment RPC ACL repair blocks real client calls and preserves service payment behavior', {`

### eclado/tests/integration/payment.spec.ts

[原始檔](../tests/integration/payment.spec.ts)｜Playwright｜外部整合；需明確啟用及測試憑證

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

須啟用 RUN_* 並提供專用測試設定；預設可 skip。

- L40：`test('虛擬帳號可以建立付款單並回傳 807 與虛擬帳號', async ({ request }) => {`
- L61：`test('信用卡可以建立付款單並產生付款連結', async ({ request }) => {`

### eclado/tests/payment-link-renewal.spec.ts

[原始檔](../tests/payment-link-renewal.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L4：`test('到期的行動支付連結可在原訂單繼續付款，文案說明訂單仍保留', async ({ page }, testInfo) => {`
- L49：`test('銀行尚在確認時保留原訂單，連續點擊只確認一次', async ({ page }) => {`
- L78：`test('建單連線中斷後查證並續付，全程沿用已建立的訂單', async ({ page }) => {`
- L127：`test('結帳金額超過三萬元仍保留 ATM 選項並提示上限', async ({ page }) => {`

### eclado/payment-api/payment-link-renewal.test.cjs

[原始檔](../payment-api/payment-link-renewal.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：直接或跨流程相關。工作區：tracked clean。本次執行通過。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L14：`test('payment creation and renewal use only simulated bank/DB responses', async t => {`
- L122：`await t.test('long product details and note stay on the order; safe bank title and no Memo', async () => {`
- L137：`await t.test('expired mobile link is queried before rotating the same order', async () => {`
- L151：`await t.test('renewal preserves stored payment method for ' + method, async () => {`
- L158：`await t.test('ATM instructions retain the order deadline without a ten-minute timer', async () => {`
- L169：`await t.test('ATM limit uses the bank tender after shopping credit', async () => {`
- L180：`await t.test('ATM over the limit returns the customer message without sending a bank request', async () => {`
- L193：`await t.test('new links never extend beyond the remaining order deadline', async () => {`
- L202：`await t.test('local validation failure releases only the unsent request', async () => {`
- L211：`await t.test('verified absence allows renewal only after a definite bank rejection', async () => {`
- L224：`await t.test('does not renew when bank state is ' + status, async () => {`
- L233：`await t.test('paid bank transaction stops renewal', async () => {`
- L241：`await t.test('simultaneous renewals rotate and create at most once', async () => {`
- L249：`await t.test('preserves unresolved creation for ' + mode, async () => {`
- L264：`await t.test('48-hour expiry blocks renewal before any bank request', async () => {`
- L277：`test('bank contract boundaries reject invalid fields and validate successful responses', () => {`

### eclado/payment-api/payment-retry-auth.test.cjs

[原始檔](../payment-api/payment-retry-auth.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：直接或跨流程相關。工作區：tracked clean。本次執行通過。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L17：`test('retry authorization rejects unauthorized clients and sends legitimate retries through service RPC', async () => {`

### eclado/payment-api/payment-return-auth.test.cjs

[原始檔](../payment-api/payment-return-auth.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：直接或跨流程相關。工作區：tracked clean。本次執行通過。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L99：`test('return rejects a caller-owned PayToken paired with another order, including conflicting aliases', async () => {`
- L117：`test('return requires successful bank API identity, even when the request supplies an order', async () => {`
- L128：`test('verified pending and declined returns retain query authorization for both guests and members', async () => {`
- L148：`test('return maps retry provider identity to site order before issuing a result token', async () => {`
- L167：`test('matching paid return still confirms payment, and code plus phone guest lookup still refreshes', async () => {`
- L184：`test('public callback cannot turn request success flags into bank payment evidence', async () => {`
- L201：`test('paid callbacks require matching bank order, successful API, merchant, currency and cents amount', async () => {`
- L220：`test('callback rejects another order hint with a valid token before paid side effects', async () => {`
- L228：`test('ATM and card/mobile verified callback payment remains supported, including retry mapping', async () => {`
- L246：`test('late pending callback preserves manually confirmed paid or fulfilled orders', async () => {`
- L258：`test('bank verification uses net tender after wallet credit, not gross order total', async () => {`
- L272：`test('authorized result polling accepts verified pending/paid bank states and rejects wrong payment amounts', async () => {`

### eclado/payment-api/server.test.cjs

[原始檔](../payment-api/server.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：直接或跨流程相關。工作區：tracked clean。本次執行通過。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L32：`test('exports pure helpers without starting the server', () => {`
- L38：`test('ORDER_CLEANUP_KEY 必須設定，且清理金鑰需完全一致', () => {`
- L51：`test('PAYMENT_NOTIFY_SECRET 必須設定', () => {`
- L60：`test('訪客查詢碼、手機正規化與短效查詢憑證', () => {`
- L70：`test('付款回站使用限時且綁定訂單的查詢憑證', () => {`
- L77：`test('訪客付款單建立後寄送含查詢碼的訂單成立信並記錄結果', async () => {`
- L109：`test('付款通知轉發會帶共用密鑰，且檢查 Vercel 回應', async () => {`
- L126：`test('Vercel 拒絕付款通知時，Vultr 會留下明確失敗結果', async () => {`
- L145：`test('付款 webhook 日誌摘要不包含 PayToken 值或完整 payload', () => {`
- L164：`test('已付款事件只有在通知轉發或 Supabase 至少一邊成功時才可回覆成功', () => {`
- L171：`test('付款通知補償工作只重送已到重試時間且尚未送達的訂單', async () => {`
- L209：`test('單筆付款通知補送失敗仍回覆 200，讓外部排程下次繼續執行', async () => {`
- L247：`test('isPaidLike: 授權/請款/付款完成算已付款；待付款/逾期不算', () => {`
- L263：`test('isPendingLike: 待付款類', () => {`
- L269：`test('AES key 為 32 bytes（AES-256），加解密可往返', () => {`
- L280：`test('signableString 排序（不分大小寫）並排除空值/物件', () => {`
- L284：`test('generateSign 對相同輸入穩定、對不同 nonce 改變', () => {`
- L295：`test('buildCreateBody: 信用卡 AutoBilling=Y，且 BackendURL 強制指向本服務', () => {`
- L310：`test('buildCreateBody: ATM 帶 ATMParam；金額為 0 應拋錯', () => {`
- L317：`test('buildAuthoritativeCreateBody: 使用資料庫實際應付額並忽略舊版前端的長備註', async () => {`
- L363：`test('buildAuthoritativeCreateBody: 舊版 claim 回傳原價時仍以購物金後應付額向銀行建單', async () => {`
- L388：`test('buildAuthoritativeCreateBody: 購物金與應付額不相符時，未 claim 即停止建單', async () => {`
- L405：`test('buildAuthoritativeCreateBody: 雙錢包只向銀行收取快照應付額，拒絕不一致快照', async () => {`
- L432：`test('formatSinopacDeadline: 將權威截止時間轉為台灣日期與時間', () => {`
- L440：`test('buildAuthoritativeCreateBody: 缺少 payment token 時拒絕建單', async () => {`
- L447：`test('getSinopacPaymentError: 失敗回傳描述，成功回空字串', () => {`
- L452：`test('付款返回網址不洩漏永豐或資料庫付款 token，只帶限時結果憑證', () => {`
- L463：`test('resolvePaymentQueryState: 付款成功優先，逾期與取消不可再付款', () => {`
- L496：`test('resolveStoredTerminalPaymentState: 後台終態可不查銀行直接關閉本機付款單', () => {`
- L511：`test('未完成付款依付款方式保留正確訂單狀態', () => {`
- L520：`test('付款資訊持久化只選取可恢復的付款連結與付款方式', () => {`
- L536：`test('重新付款只允許信用卡與行動支付，並還原正確的永豐付款參數', () => {`
- L548：`test('會員付款資訊端點會驗證登入身分與訂單所有權', async () => {`
- L603：`test('會員不能讀取其他會員的付款資訊', async () => {`
- L646：`test('會員付款摘要查詢登入會員自己的全部訂單並標示可重新付款', async () => {`
- L689：`test('訪客以短查詢碼與手機取得付款資訊，且回應不洩漏個資', async () => {`
- L741：`test('訪客短效憑證可更新已出貨訂單，且已付款後不回傳付款入口', async () => {`
- L785：`test('訪客訂單更新端點拒絕過期或錯誤憑證', async () => {`
- L808：`test('訪客手機不符時使用通用錯誤且不讀付款資訊', async () => {`
- L839：`test('訪客訂單查詢使用 Supabase 共享限流，超限回覆 429', async () => {`

## 通知與逾期取消

### eclado/tests/integration/cancel-expired-orders.test.cjs

[原始檔](../tests/integration/cancel-expired-orders.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：直接或跨流程相關。工作區：tracked clean。本次執行通過。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L5：`test('cancel expired orders - rejects forged x-vercel-cron header without bearer secret', async () => {`
- L29：`test('cancel expired orders - cancels awaiting_confirm and unpaid orders past payment_due_at', async () => {`
- L96：`test('cancel expired orders - rejects unsupported methods', async () => {`
- L105：`test('cancel expired orders - returns zero when no expired orders exist', async () => {`
- L148：`test('cancel expired orders - returns 500 when service key is missing', async () => {`
- L177：`test('cancel expired orders - returns 500 when Supabase update fails', async () => {`
- L222：`test('cancel expired orders - does not report cancellation when order becomes paid during the race window', async () => {`

### eclado/tests/integration/line-webhook.test.cjs

[原始檔](../tests/integration/line-webhook.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L7：`test('LINE webhook - GET health check returns OK without a secret', async () => {`
- L22：`test('LINE webhook - rejects unsupported methods before webhook authentication', async () => {`
- L31：`test('LINE webhook - fails closed when the verification secret is missing', async () => {`
- L57：`test('LINE webhook - treats a blank verification secret as missing', async () => {`
- L74：`test('LINE webhook - rejects a missing or invalid signature when secret is configured', async () => {`
- L92：`test('LINE webhook - verifies and parses the exact raw JSON bytes', async () => {`
- L117：`test('LINE webhook - rejects a signature for semantically equal but different bytes', async () => {`
- L136：`test('LINE webhook - returns 400 for malformed JSON with a valid signature', async () => {`
- L155：`test('LINE webhook - returns 400 when the request stream fails', async () => {`
- L177：`test('LINE webhook - accepts LINE verification payloads with no events', async () => {`
- L196：`test('LINE webhook - does not impose a body limit below the hosting platform limit', async () => {`

### eclado/tests/integration/order-email.test.cjs

[原始檔](../tests/integration/order-email.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L5：`test('order email sends order placed notice through Resend', async () => {`
- L63：`test('member order placed email directs unfinished payments back to member orders', async () => {`
- L104：`test('order email accepts Payment API secret only for the opted-in email endpoint', async () => {`
- L132：`test('order email sends shipment notice with tracking link', async () => {`
- L173：`test('order email rejects unauthenticated callers', async () => {`
- L193：`test('order email accepts a verified administrator access token', async () => {`
- L233：`test('order email rejects a signed-in non-administrator', async () => {`
- L312：`test('order email skips historical manual orders', async () => {`

### eclado/tests/integration/remind-unpaid-orders.test.cjs

[原始檔](../tests/integration/remind-unpaid-orders.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L5：`test('remind unpaid orders - reminder delay defaults to 3 hours', () => {`
- L31：`test('remind unpaid orders - sends LINE first and marks reminded', async () => {`
- L126：`test('remind unpaid orders - falls back to email when LINE is unavailable', async () => {`
- L202：`test('remind unpaid orders - sends a second reminder after 24 hours and marks both timestamps', async () => {`
- L269：`test('remind unpaid orders - rejects forged x-vercel-cron header without bearer secret', async () => {`
- L294：`test('remind unpaid orders - does not mark reminder when LINE and Email both fail', async () => {`

### eclado/tests/integration/sinopac-notify-crypto.test.cjs

[原始檔](../tests/integration/sinopac-notify-crypto.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：直接或跨流程相關。工作區：tracked clean。本次執行通過。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L23：`test('__test helpers are exported', () => {`
- L30：`test('AES key derives to 32 bytes and AES-256 round-trips (regression: aes-128 would throw)', () => {`
- L50：`test('signString sorts case-insensitively and drops empty/object values', () => {`
- L55：`test('isFailedPayment treats explicit failure values as failed, success as not', () => {`
- L62：`test('getAmount / amountsMatch handle dollar and cent amounts', () => {`
- L71：`test('payment payload summary exposes presence but never PayToken/card values', () => {`
- L84：`test('real BackendURL {ShopNo, PayToken} resolves order via OrderPayQuery (AES-256) and marks paid', async () => {`

### eclado/tests/integration/sinopac-notify.test.cjs

[原始檔](../tests/integration/sinopac-notify.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：直接或跨流程相關。工作區：tracked clean。本次執行通過。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L19：`test('Sinopac notify rejects missing or incorrect payment notification secret', async () => {`
- L50：`test('Sinopac notify marks order paid and sends LINE payment notice', async () => {`
- L137：`test('Sinopac notify does not resend LINE notice for already paid orders', async () => {`
- L182：`test('Sinopac notify accepts cent-based amount from mobile payments', async () => {`
- L252：`test('Sinopac notify resolves mobile payment by PayToken when OrderNo is absent', async () => {`
- L323：`test('Sinopac notify accepts OrderNo from backendUrl query for PayToken-only mobile notices', async () => {`
- L395：`test('Sinopac notify queries OrderPayQuery for credit card PayToken-only notices', async () => {`
- L493：`test('Sinopac notify sends payment email when member has no LINE binding', async () => {`
- L570：`test('Sinopac notify retries customer notice for an already-paid order that has no delivery receipt', async () => {`
- L616：`test('Sinopac notify records delivery failure and asks caller to retry', async () => {`
- L676：`test('Sinopac notify ignores explicit failed payment notices', async () => {`
- L697：`test('Sinopac notify rejects amount mismatch without changing order or sending notices', async () => {`
- L747：`test('Sinopac notify returns 404 for an unknown order without creating one', async () => {`
- L780：`test('Sinopac notify returns 500 and sends no notice when paid status update fails', async () => {`

## 庫存與合併出貨

### eclado/tests/integration/inventory-receipts-db.test.cjs

[原始檔](../tests/integration/inventory-receipts-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：??。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L53：`test('receipt SQL preserves exact costs, posts once and fences old catalog stock values', {`

### eclado/tests/integration/product-costs-db.test.cjs

[原始檔](../tests/integration/product-costs-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：??。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L9：`test('FIFO uses whole fulfillment lines, preserves shortages, and handles opening, adjustments and returns', {`

### eclado/tests/integration/staging-inventory.spec.ts

[原始檔](../tests/integration/staging-inventory.spec.ts)｜Playwright｜外部整合；需明確啟用及測試憑證

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

須啟用 RUN_* 並提供專用測試設定；預設可 skip。

- L26：`test('付款後扣庫存，出貨流程不補回，退貨才補回', async ({}, testInfo) => {`

### eclado/tests/inventory-counts-sql.spec.ts

[原始檔](../tests/inventory-counts-sql.spec.ts)｜Playwright｜SQL／原始碼靜態斷言

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L7：`test('盤點單同時凍結一般與啟用中的贈品庫存及現場保留量', () => {`
- L15：`test('盤點輸入採逐項版號鎖，完成盤點則鎖定整張單與即時庫存', () => {`
- L23：`test('盤點差異套用完成當下可用庫存且不允許負數', () => {`
- L31：`test('盤虧保留舊訂單優先，贈品補回則依 FIFO 回補', () => {`
- L39：`test('未填完整不可完成，完成後不可修改或刪除且永久保留', () => {`
- L47：`test('庫存盤點 RPC 僅授權後台權限且不開放匿名呼叫', () => {`

### eclado/tests/inventory-sql.spec.ts

[原始檔](../tests/inventory-sql.spec.ts)｜Playwright｜SQL／原始碼靜態斷言

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L11：`test('庫存 trigger 將出貨流程狀態視為占用庫存', () => {`
- L19：`test('功能清單描述與庫存 trigger 行為一致', () => {`
- L27：`test('現場自取運費分支不會再被宅配規則覆寫', () => {`
- L33：`test('專業會員保留五千元起購，滿一萬五千元才免運', () => {`
- L42：`test('公開熱門商品統計排除客訂規格銷量', () => {`
- L49：`test('後台付款方式查詢不暴露完整金流指示資料', () => {`
- L59：`test('後台付款狀態查詢只回傳安全的付款嘗試摘要', () => {`
- L70：`test('後台角色採明確能力清單且商品小編不會被視為完整管理員', () => {`
- L94：`test('商品小編的商品 RPC 與 Storage 使用能力檢查並隔離進貨成本', () => {`
- L113：`test('重複付款狀態更新不會再次扣庫存，履約狀態互轉也不重複扣補', () => {`
- L121：`test('預購與超過現貨數量只扣付款當下可用規格庫存，且不允許負庫存', () => {`
- L128：`test('新版庫存配置以規格庫存為準並保存付款配置、回補與 FIFO 軌跡', () => {`
- L145：`test('待補頁未啟用期間允許訂單繼續履約，並以結案事件移出待補清單', () => {`
- L156：`test('待補商品權限只授予最高管理員並保留商品小編角色', () => {`
- L166：`test('訪客訂單歸戶採單筆原子鎖定、雙權限與獨立稽核事件', () => {`
- L179：`test('建單快照會以購買數量判斷部分缺貨而非只判斷庫存大於零', () => {`
- L187：`test('付款建單 claim 以資料列鎖與狀態欄位阻擋同訂單並行或重複建單', () => {`
- L198：`test('付款嘗試狀態與訂單履約狀態分開保存', () => {`
- L208：`test('重新付款保留原訂單並為每次金流建立獨立嘗試', () => {`

### eclado/tests/professional-shipping-groups-sql.spec.ts

[原始檔](../tests/professional-shipping-groups-sql.spec.ts)｜Playwright｜SQL／原始碼靜態斷言

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L7：`test('合併出貨只新增 nullable 關聯並保留獨立訂單', () => {`
- L14：`test('追加資格集中限制為既有三種專業角色', () => {`
- L20：`test('首單仍需五千，只有已付款 open group 能豁免追加單門檻', () => {`
- L27：`test('追加單運費為零且金額使用折扣後、購物金前商品金額', () => {`
- L34：`test('付款成功才建立新批次，備貨只鎖定群組', () => {`
- L42：`test('鎖定前已建立的未付款追加單仍可在鎖定後付款', () => {`
- L48：`test('滿一萬五只退首單原運費一次並寫入不可變購物金 ledger', () => {`
- L57：`test('取消只排除累積並產生人工警示，不追回退款', () => {`
- L64：`test('多個 open group 採 fail closed，不猜測或合併', () => {`
- L69：`test('只有一張安全的舊 paid 訂單才 lazy 建立群組，多張舊訂單拒絕猜測', () => {`
- L77：`test('群組資料不直接開放資料表，前後台透過受限 RPC', () => {`
- L85：`test('PL/pgSQL 變數不使用保留字，避免身分判斷讀到連線角色', () => {`
- L98：`test('舊版底層報價的最低金額檢查改為追加單例外，且不改寫整支函式', () => {`
- L113：`test('批次出貨在一次交易內完成，未付款擋下、已出貨跳過', () => {`

## 代客下單

### eclado/tests/assisted-orders.spec.ts

[原始檔](../tests/assisted-orders.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L21：`test('restored checkout resolves missing or broken snapshot images without changing totals',async({page})=>{`
- L34：`test('product search filters names and SKU without clearing chosen product or price',async({page})=>{`
- L49：`test('assisted order detail link action uses existing outlined button and field styles',async({page})=>{`
- L63：`test('order create button stays at header right with status filters below',async({page})=>{`
- L74：`test('member shortcut is the third inline action and preselects member contact and applicable pricing',async({page})=>{`
- L92：`test('member shortcut is hidden without order write permission',async({page})=>{`
- L98：`test('assisted dialog reuses historical modal styles and scrolls without clipping actions',async({page},testInfo)=>{`
- L112：`test('guest suggested retail price, manual price, snapshot and generated private customer link',async({page})=>{`
- L124：`test('member product override suggested price; role and minimum exception are visible',async({page})=>{`
- L132：`test('failure after order creation stays locked and retries payment without another order RPC',async({page})=>{`
- L140：`test('read-only staff cannot see assisted create entry',async({page})=>{`
- L143：`test('member custom price supports coupon and credit; creation waits for customer instead of calling bank',async({page})=>{`
- L172：`test('staff assisted orders require minimum exception but keep fixed free shipping',async({page})=>{`
- L182：`test('discounted minimum explanation stays visible and preserves quote while typing',async({page})=>{`
- L210：`test('switching customer clears coupon and shopping credit, while guest has no wallet input',async({page})=>{`
- L217：`test('customer credit consent is unchecked by default, binds exact amount and shows discounts/gifts',async({page})=>{`
- L237：`test(ˋ${label} can be selected by admin and the customer uses the saved wallet payment linkˋ,async({page})=>{`
- L254：`test('private customer page shows saved prices/invoice/ATM, no internal stock or admin UI',async({page})=>{`
- L261：`test('customer payment error and loading states use storefront cards and styled query actions',async({page},testInfo)=>{`

### eclado/tests/integration/assisted-member-link-db.test.cjs

[原始檔](../tests/integration/assisted-member-link-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L7：`test('member assisted link: owner only, active orders only, no guest or anonymous access', { skip:!process.env.PGLITE_MODULE }, async () => {`

### eclado/tests/integration/assisted-orders-db.test.cjs

[原始檔](../tests/integration/assisted-orders-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L5：`test('assisted SQL: atomic creation/recovery, owner/roles, immutable snapshots, reservation/payment/cancel/count', {skip:!process.env.PGLITE_MODULE},async()=>{`

### eclado/payment-api/assisted-orders.test.cjs

[原始檔](../payment-api/assisted-orders.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：直接或跨流程相關。工作區：tracked clean。本次執行通過。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L33：`test('customer projection explicitly excludes staff notes, costs, stock and payment credentials',()=>{`
- L45：`test('shopping credit requires explicit matching consent before any bank request; recorded consent recovers safely',async()=>{`
- L58：`test('customer amounts separate shipping, discount, credit and tender; gift rows are explicit',()=>{`
- L65：`test('invalid link denies details and never reaches bank',async()=>{`
- L69：`test('payment ignores client amounts/method; repeat/concurrent requests create only once',async()=>{`
- L76：`test('ambiguous timeout keeps claim; repeat cannot create another bank request',async()=>{`
- L81：`test('Apple/Google Pay use the existing wallet gateway mapping from the saved method, not caller input',async()=>{`
- L90：`test('definite rejection releases claim but retains original order for same-ID retry',async()=>{`
- L95：`test('duplicate bank response, malformed response and persistence failure never admit another creation',async()=>{`
- L102：`test('paid/cancelled/expired orders cannot create payment',async()=>{`

## 課程報名付款

### eclado/tests/course-registration.spec.ts

[原始檔](../tests/course-registration.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區：??。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L34：`test(ˋ${scenario} 課程報名、付款返回及狀態查詢ˋ, async ({ page }) => {`
- L142：`test('後台取消一人、保留同單其他報名並可記錄人工處理', async ({ page }) => {`
- L189：`test('課程後台可選取有效報名發送通知、查看結果及收入摘要', async ({ page }) => {`
- L256：`test('會員中心可直接從我的課程開啟 Zoom 並查看報名', async ({ page }) => {`
- L278：`test('會員中心沒有課程報名紀錄時隱藏我的課程', async ({ page }) => {`
- L288：`test('會員中心只有待付款及已取消紀錄時仍顯示我的課程', async ({ page }) => {`
- L309：`test(ˋ專業課程列表依報名紀錄顯示會員入口 (${status})ˋ, async ({ page }) => {`
- L334：`test(ˋ課程一步報名 ${method}ˋ, async ({ page }) => {`
- L376：`test('LINE 課程登入回來後會回到原報名頁', async ({ page }) => {`
- L399：`test('課程列表優先顯示可報名課程並收錄已結束課程', async ({ page }) => {`
- L409：`test('已結束課程只向有該堂報名紀錄的會員顯示紀錄入口', async ({ page }) => {`

### eclado/tests/courses.spec.ts

[原始檔](../tests/courses.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區：??。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L6：`test(ˋ管理員可以新增、編輯、上下架課程，公開頁面可直接開啟詳情（${jpegFallback ? 'JPG 備援' : 'WebP'}）ˋ, async ({ page }) => {`
- L204：`test('已上架課程在報名時間前展示預告，到時自動顯示報名入口', async ({ page }) => {`

### eclado/tests/integration/course-registration-db.test.cjs

[原始檔](../tests/integration/course-registration-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：??。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L8：`test('course registration, payment confirmation and single-seat cancellation use isolated transactions', {`

### eclado/tests/integration/course-shopping-credit-db.test.cjs

[原始檔](../tests/integration/course-shopping-credit-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：??。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L8：`test('ended courses grant each payer the saved fee once per active paid registration', {`

### eclado/tests/integration/courses-db.test.cjs

[原始檔](../tests/integration/courses-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：??。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L7：`test('course permissions, publication, image visibility and version conflicts', {`

### eclado/payment-api/course-payments.test.cjs

[原始檔](../payment-api/course-payments.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：直接或跨流程相關。工作區：??。本次執行通過。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L5：`test('course routes use payer authorization, server prices and bank-captured evidence', async () => {`

## 診斷與發布

### eclado/tests/checkout-events.spec.ts

[原始檔](../tests/checkout-events.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：直接或跨流程相關。工作區： M。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L36：`test('付款連線失敗可追蹤並查詢恢復原訂單，不重複建單', async ({ page }) => {`
- L74：`test('追蹤 API 故障與 sessionStorage 被封鎖都不阻擋付款建立', async ({ page }) => {`
- L93：`test('追蹤送出失敗後重載會補送原事件 ID，成功後清空佇列', async ({ page }) => {`

### eclado/tests/integration/checkout-events-db.test.cjs

[原始檔](../tests/integration/checkout-events-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L8：`test('checkout diagnostics: real PostgreSQL permissions, transaction evidence, dedupe, limits and failure isolation', {`

### eclado/tests/integration/checkout-events.test.cjs

[原始檔](../tests/integration/checkout-events.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：直接或跨流程相關。工作區：tracked clean。本次執行通過。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L16：`test('ingress strips customer data and cannot forge trusted stages or sources', () => {`
- L28：`test('ingress rejects unsupported requests, preserves DB dedupe IDs and handles rate limits without exposing DB errors', async t => {`
- L58：`test('payment telemetry ignores missing trace, strips raw errors and cannot reject on logging outage', async t => {`

### eclado/tests/integration/payment-diagnostics-db.test.cjs

[原始檔](../tests/integration/payment-diagnostics-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：直接或跨流程相關。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L3：`test('bank diagnostics are service-written, admin/order-permission read only, bounded and credential-free',{`

### eclado/payment-api/deploy-release.test.cjs

[原始檔](../payment-api/deploy-release.test.cjs)｜Node test｜發布腳本；本機檔案＋模擬 PM2／主機命令

範圍：直接或跨流程相關。工作區： M。本次執行通過。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L48：`test('release requires an explicitly provisioned host and matching current revision', t => {`
- L55：`test('complete runtime package activates and preserves the previous release and secret file', t => {`
- L62：`test('archive missing the course payment module is rejected before activation', t => {`
- L69：`test('failed candidate health check restores prior release through PM2', t => {`

### eclado/payment-api/sinopac-diagnostics-integration.test.cjs

[原始檔](../payment-api/sinopac-diagnostics-integration.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：直接或跨流程相關。工作區：tracked clean。本次執行通過。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L11：`test('real API wrapper captures 401 privately, verifies signatures before storing codes and tolerates telemetry failure',async t=>{`

### eclado/payment-api/sinopac-diagnostics.test.cjs

[原始檔](../payment-api/sinopac-diagnostics.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：直接或跨流程相關。工作區：tracked clean。本次執行通過。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L10：`test('verified inner transaction decline is distinct from successful API; no raw payload or card data persists', () => {`
- L18：`test('different bank references and untrusted local errors cannot become order evidence', () => {`
- L27：`test('HTTP authentication/transport evidence is explicit and cannot claim a card decline', () => {`
- L34：`test('logging outage cannot reject payment; duplicate snapshots use ignore-duplicates', async t => {`

## 相鄰營運流程

### eclado/tests/admin-analytics.spec.ts

[原始檔](../tests/admin-analytics.spec.ts)｜Playwright｜純函式／靜態或自行攔截的瀏覽器案例；依個別案例判讀

範圍：相鄰營運流程。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L5：`test('歷史補登不計入營業額與訂單數', () => {`
- L14：`test('歷史補登數量不計入商品銷售與補貨分析', () => {`
- L28：`test('自訂期間每日與跨月分組補零，商品合併及規格排行正確', () => {`
- L50：`test('日期驗證與快捷區間以台灣日期跨年及閏月計算', () => {`
- L58：`test('查詢最多一年，含閏年與近半年快捷區間', () => {`

### eclado/tests/admin-mappers.spec.ts

[原始檔](../tests/admin-mappers.spec.ts)｜Playwright｜純函式／靜態或自行攔截的瀏覽器案例；依個別案例判讀

範圍：相鄰營運流程。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L4：`test('歷史補登顯示於會員訂單數但不計入累計消費', () => {`
- L16：`test('會員消費總額只計入已付款及後續履約狀態', () => {`
- L38：`test('會員訂單只依 user_id 歸戶，不使用相同 Email 的訪客訂單', () => {`

### eclado/tests/admin.spec.ts

[原始檔](../tests/admin.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：相鄰營運流程。工作區： M。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L67：`test('系統設定重新載入沿用白底框線按鈕且只重新讀取設定', async ({ page }) => {`
- L89：`test('後台登入權限：非管理員擋下，管理員可進入', async ({ page }) => {`
- L108：`test('儀表板只查摘要，等待期間不顯示零元並在切換頁面後讀取訂單列表', async ({ page }) => {`
- L138：`test('儀表板摘要失敗可重試且不退回完整資料查詢', async ({ page }) => {`
- L157：`test('後台重整等待權限時顯示狀態且不提前載入資料', async ({ page }) => {`
- L183：`test('後台登入權限：管理員 session 可進入儀表板', async ({ page }) => {`
- L194：`test('導覽列可將頁面加入常用並依原本選單順序顯示', async ({ page }) => {`
- L216：`test('導覽列會載入帳號已存的常用並隱藏沒有權限的頁面', async ({ page }) => {`
- L231：`test('只有最高管理員能看到待補商品管理', async ({ page }) => {`
- L254：`test('商品小編只載入商品且無法看到營運、會員、叫貨與進貨成本', async ({ page }) => {`
- L320：`test('訂單管理以 user_id 區分訪客與一般會員', async ({ page }) => {`
- L346：`test('叫貨管理可多選商品、查看庫存、計算雙幣別並匯出三種格式', async ({ page }, testInfo) => {`
- L409：`test('叫貨單草稿可不填地址儲存並永久刪除，後期狀態不可降級後刪除', async ({ page }) => {`
- L446：`test('後台側邊欄將操作紀錄歸在會員分類', async ({ page }) => {`
- L464：`test('後台切換左側導覽時主內容自動回到頂部', async ({ page }) => {`
- L488：`test('儀表板最新訂單的查看全部會前往訂單管理', async ({ page }) => {`
- L506：`test('後台資料為空時維持空狀態，不顯示本機示範商品、會員或訂單', async ({ page }) => {`
- L522：`test('後台權限以資料庫 allow-list 為準，不再只相信管理員 Email', async ({ page }) => {`
- L533：`test('商品、訂單與會員列表響應式切換，詳情使用抽屜且不撐寬頁面', async ({ page }) => {`
- L634：`test('手機上一頁會關閉後台詳情，商品未儲存時先確認', async ({ page }) => {`
- L672：`test('儀表板顯示待處理資訊，點待審核申請可前往會員審核列表', async ({ page }) => {`
- L685：`test('儀表板六個月柱狀圖皆有有效背景色，歷史月份使用透明度', async ({ page }) => {`
- L698：`test('儀表板營業額與庫存警示固定上下排列，庫存內容獨立水平捲動', async ({ page }) => {`
- L732：`test('訂單列表由伺服器分頁與搜尋，啟動不讀明細或完整資料', async ({ page }) => {`
- L762：`test('只有訂單權限時不讀取會員選單或顯示歸戶操作', async ({ page }) => {`
- L775：`test('訂單明細載入完成沿用原側欄，不再次播放進場動畫', async ({ page }) => {`
- L797：`test('訂單明細慢回應在關閉或切換訂單後不會覆蓋目前詳情', async ({ page }) => {`
- L818：`test('訂單列表與明細失敗可各自重試且不顯示假空資料', async ({ page }) => {`
- L840：`test('訂單管理可查看明細並更新狀態', async ({ page }) => {`
- L872：`test('訂單付款區分 API 成功與信用卡內層 3D 失敗，顯示銀行碼與查核建議', async ({ page }) => {`
- L893：`test('付款診斷顯示永豐建單備註長度錯誤', async ({ page }) => {`
- L906：`test('付款診斷顯示 API 認證失敗，並保留訂單已付款的事實', async ({ page }) => {`
- L920：`test('診斷服務未部署時仍能查看原訂單，舊紀錄不捏造失敗原因', async ({ page }) => {`
- L940：`test('訂單詳情顯示合併出貨批次、未付款提醒與人工處理警示', async ({ page }) => {`
- L976：`test('批次出貨在有未付款訂單時被擋下，付款後一次出貨並只發一則通知', async ({ page }) => {`
- L1034：`test('未付款狀態依付款方式區分信用卡與虛擬帳號匯款', async ({ page }) => {`
- L1081：`test('訂單詳情顯示優惠券名稱與遮罩代碼', async ({ page }) => {`
- L1106：`test(ˋ訂單詳情錢包明細：${wallets.name}ˋ, async ({ page }) => {`
- L1125：`test('訂單詳情分開顯示訂單總額、購物金支付與尚需付款', async ({ page }) => {`
- L1151：`test('訂單詳情顯示發票快照並可獨立儲存人工發票號碼', async ({ page }) => {`
- L1177：`test('舊訂單沒有發票欄位時仍可開啟並顯示未記錄', async ({ page }) => {`
- L1186：`test('訂單列印只呈現歷史快照與顧客可見資訊', async ({ page }) => {`
- L1257：`test('舊訂單缺少新快照欄位仍可開啟列印預覽', async ({ page }) => {`
- L1270：`test('訂單全部分欄排除已取消，已取消分欄仍可查閱', async ({ page }) => {`
- L1289：`test('訂單管理可依狀態與待補庫存篩選', async ({ page }) => {`
- L1311：`test('已付款與備貨中訂單詳情顯示逐項現貨與缺少數量', async ({ page }) => {`
- L1359：`test('待補商品頁依付款順序執行 FIFO 並支援部分分配', async ({ page }) => {`
- L1404：`test('客訂自取訂單不顯示地址與托運欄位並可完成取貨流程', async ({ page }) => {`
- L1443：`test('已出貨與已到貨篩選包含對應的自取狀態', async ({ page }) => {`
- L1466：`test('訂單管理可取消訂單並同步 cancelled 狀態', async ({ page }) => {`
- L1488：`test('已取消且未付款的訂單可經二次確認後永久刪除', async ({ page }) => {`
- L1510：`test('曾付款後取消的訂單保留帳務紀錄且不可永久刪除', async ({ page }) => {`
- L1524：`test('訂單改為已付款會送出 LINE 付款通知，LINE 失敗時改寄 Email', async ({ page }) => {`
- L1552：`test('出貨可寫入托運單號並送出 LINE 通知', async ({ page }) => {`
- L1593：`test('未填托運單號不能確認出貨或發送通知', async ({ page }) => {`
- L1612：`test('已有成功通知紀錄時不會自動重複發送', async ({ page }) => {`
- L1636：`test('沒有 LINE 綁定的訂單出貨會送出 Email 通知', async ({ page }) => {`
- L1664：`test('商品庫存可在規格表格修改並透過交易式 RPC 儲存', async ({ page }) => {`
- L1688：`test('贈品庫存分頁同時顯示一般商品與贈品專用商品的獨立庫存', async ({ page }) => {`
- L1708：`test('庫存盤點涵蓋一般與贈品庫存、版本衝突、完整填寫及完成後唯讀', async ({ page }) => {`
- L1796：`test('商品庫存可依庫存狀態篩選', async ({ page }) => {`
- L1821：`test('商品庫存可依中文或英文名稱搜尋，並與庫存狀態共同篩選', async ({ page }) => {`
- L1846：`test('商品管理可編輯名稱、規格價格與院線限定並透過 RPC 儲存', async ({ page }) => {`
- L1881：`test('商品規格編輯改為多列卡片且窄畫面不需水平滑動', async ({ page }) => {`
- L1934：`test('商品管理可從本機上傳圖片並以規格 RPC 建立草稿', async ({ page }) => {`
- L1980：`test('新增商品缺少必填欄位時在編輯面板內顯示警示', async ({ page }) => {`
- L1996：`test('新增商品可不放圖片並建立草稿', async ({ page }) => {`
- L2026：`test('商品圖片上傳會阻止非圖片與超過 5 MB 的檔案', async ({ page }) => {`
- L2049：`test('新增商品寫入失敗時顯示錯誤且不加入商品清單', async ({ page }) => {`
- L2076：`test('商品管理可下架、於已下架清單查看並重新上架商品', async ({ page }) => {`
- L2099：`test('商品管理可將草稿商品設定為活動限定', async ({ page }) => {`
- L2134：`test('商品管理可設定固定專業價而不套用身分倍率', async ({ page }) => {`
- L2165：`test('商品下架與重新上架寫入失敗時維持原清單狀態', async ({ page }) => {`
- L2189：`test('活動管理可建立原子百分比折扣並指定全館一般商品', async ({ page }) => {`
- L2202：`test('活動可套用全館商品並包含活動限定商品', async ({ page }) => {`
- L2215：`test('活動管理預設不顯示已封存活動', async ({ page }) => {`
- L2234：`test('百分比與固定金額折抵可改用滿件門檻', async ({ page }) => {`
- L2250：`test('活動限定商品可以被指定到優惠券專用活動', async ({ page }) => {`
- L2267：`test('活動指定商品可全選及全取消', async ({ page }) => {`
- L2292：`test('活動可混合勾選整個品項及個別規格', async ({ page }) => {`
- L2314：`test('優惠券方案可打包多個優惠券專用活動', async ({ page }) => {`
- L2342：`test('編輯優惠券會依後端排序還原活動執行順序', async ({ page }) => {`
- L2364：`test('優惠券可搜尋並指定個別會員使用', async ({ page }) => {`
- L2390：`test('指定會員可用美容師聯絡人搜尋並顯示聯絡人名稱', async ({ page }) => {`
- L2413：`test('編輯指定會員優惠券會還原既有會員名單', async ({ page }) => {`
- L2432：`test('重複優惠碼顯示可理解的中文提示', async ({ page }) => {`
- L2452：`test('活動管理可從一般商品贈品庫存與贈品專用商品選擇贈品', async ({ page }) => {`
- L2476：`test('活動排程：排程中活動顯示「排程中」badge，已結束顯示「已結束」', async ({ page }) => {`
- L2494：`test('後台核准美容師申請會同步 application status 與 profiles.role', async ({ page }) => {`
- L2520：`test('後台拒絕美容師申請會同步 rejected 與 consumer', async ({ page }) => {`
- L2541：`test('會員管理操作欄的會員類型下拉選單寬度一致', async ({ page }) => {`
- L2556：`test('一般桌面寬度不需水平捲動即可看到會員詳細按鈕', async ({ page }) => {`
- L2578：`test('會員列表提供查看詳情按鈕並開啟既有會員詳情面板', async ({ page }) => {`
- L2600：`test('會員詳細只顯示目前美容師申請的私人證照圖片與歷史筆數', async ({ page }) => {`
- L2641：`test('訂單詳細可將單張訪客訂單歸戶至會員', async ({ page }) => {`
- L2675：`test('會員詳細可一次匯入一張訪客訂單並更新歷史訂單', async ({ page }) => {`
- L2710：`test('會員詳情可由訪客訂單按鈕右側補登歷史訂單', async ({ page }) => {`
- L2763：`test('後台可單向取消歷史補登並保留不可刪除提示', async ({ page }) => {`
- L2802：`test('手機會員小卡的查看詳情按鈕與會員類型選單並列且可開啟詳情', async ({ page }) => {`
- L2826：`test('會員管理長 Email 不會壓縮類型與申請狀態欄', async ({ page }) => {`
- L2870：`test('手機會員管理標題與篩選列上下排列，篩選項目維持三欄等寬', async ({ page }) => {`
- L2899：`test('會員管理可依會員與美容師申請資料搜尋，並與類型篩選共用', async ({ page }) => {`
- L2974：`test('會員管理待審核數量使用與訂單待確認相同的 badge 樣式', async ({ page }) => {`
- L2999：`test('會員管理可手動切換會員類型並同步 profile role', async ({ page }) => {`
- L3019：`test('會員管理只在會員詳細顯示師資目前季度採購額與資格歷程', async ({ page }) => {`
- L3051：`test('會員內部備註可在會員詳情編輯並顯示於該會員的訂單', async ({ page }) => {`
- L3079：`test('訂單列表以兩種顏色標籤區分會員內部備註與顧客訂單備註', async ({ page }) => {`
- L3102：`test('只有訂單權限的帳號看得到會員內部備註但不能跳到會員詳情', async ({ page }) => {`
- L3121：`test('訂單與會員詳情可雙向跳轉並顯示返回列', async ({ page }) => {`
- L3152：`test('會員管理可回溯資格起始日並補登線下季度採購', async ({ page }) => {`
- L3193：`test('會員管理可刪除會員並同步資料庫', async ({ page }) => {`
- L3215：`test('會員管理不提供刪除目前登入管理員的操作', async ({ page }) => {`
- L3229：`test('購物金管理顯示餘額與不可刪除明細，人工發放需原因及二次確認', async ({ page }) => {`
- L3315：`test('只有會員寫入權限才顯示刪除會員操作', async ({ page }) => {`
- L3328：`test('營業分析與 AI 補貨只使用真實訂單統計，不套用預設銷量', async ({ page }) => {`
- L3375：`test('操作紀錄可依資料類型篩選並查看不可竄改的前後差異', async ({ page }) => {`
- L3448：`test('自動活動可多選會員身分與訪客，優惠券專用活動沿用方案對象', async ({ page }) => {`
- L3468：`test('自動活動拒絕空白對象並允許僅訪客', async ({ page }) => {`
- L3485：`test('買 X 送 Y 共用適用對象與範圍，支援重複且不需贈品庫存或上限', async ({ page }) => {`
- L3511：`test('買 X 送 Y 編輯會還原件數與單次贈送，並可連結優惠券', async ({ page }) => {`
- L3531：`test('活動標籤可選色並即時預覽及儲存', async ({ page }, testInfo) => {`
- L3550：`test('全站公告沿用活動管理樣式，可預覽、儲存並重新載入', async ({ page }, testInfo) => {`
- L3576：`test('全站公告儲存失敗保留編輯內容', async ({page})=>{`
- L3587：`test('公告排程使用台北凌晨時間，拒絕倒置區間並保留重新載入的排程',async({page},testInfo)=>{`
- L3610：`test('營業分析自訂日期、跨月趨勢及商品規格排行共用期間且不載入原始訂單', async ({ page }, testInfo) => {`
- L3689：`test('營業分析查詢失敗可重試，不將錯誤顯示為零元', async ({ page }) => {`
- L3705：`test(ˋ${kind} 停用保留列表、封存與手動還原分離ˋ, async ({ page }) => {`
- L3752：`test('活動狀態更新失敗或已被其他人變更時保留原畫面並提示', async ({ page }) => {`
- L3769：`test('複製買贈活動帶入商品與設定，取消不寫入、儲存使用新 ID 且預設停用', async ({ page }) => {`
- L3795：`test('複製活動遇到無法表示的排除範圍時阻擋，不默默擴大範圍', async ({ page }) => {`
- L3807：`test(ˋ複製 ${benefit} 保留優惠與範圍設定並建立停用副本ˋ, async ({ page }) => {`
- L3827：`test(ˋ${benefit} 可新增多項贈品、各自設定數量並移除ˋ, async ({ page }) => {`
- L3852：`test(ˋ${benefit} 編輯與複製保留多項贈品及順序ˋ, async ({ page }) => {`

### eclado/tests/cart-reminder-settings.spec.ts

[原始檔](../tests/cart-reminder-settings.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：相鄰營運流程。工作區：??。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L13：`test('系統設定預設公版，可預覽、修改內容及儲存啟用狀態',async({page})=>{`
- L33：`test('缺少購物車連結不儲存；並行儲存衝突保留輸入',async({page})=>{`
- L48：`test('只有會員定價權限不顯示通知設定',async({page})=>{`

### eclado/tests/instructor-reward-operations.spec.ts

[原始檔](../tests/instructor-reward-operations.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：相鄰營運流程。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L14：`test('unified reward management preserves tab permissions and switches reports',async({page})=>{`
- L23：`test('withdrawal-only administrator sees unified entrance without account or reconciliation tabs',async({page})=>{`
- L30：`test('shared refresh queries only active tab without running reconciliation; tabs fit their contents',async({page})=>{`
- L47：`test('notification report is masked and uses original responsive styles',async({page})=>{`
- L54：`test('pending notice remains compact with no resend controls and retains detailed attempts',async({page})=>{`
- L60：`test('read-only permissions hide supplement and correction actions',async({page})=>{`
- L63：`test('manual supplement retries same key after unknown response',async({page})=>{`
- L67：`test('explicit correction sends only immutable event ID and request key',async({page})=>{`
- L70：`test('reconciliation lists pending review and executes no financial corrections',async({page})=>{`
- L73：`test('reconciliation explains mismatch in Chinese and keeps raw codes in collapsed details',async({page})=>{`
- L80：`test('query failure clears previous report instead of exposing stale records',async({page})=>{`
- L83：`test('uninstalled stage 6 shows explicit installation message',async({page})=>{`
- L86：`test('access policies require dedicated report capability and active administrator role',()=>{`

### eclado/tests/instructor-reward-queries.spec.ts

[原始檔](../tests/instructor-reward-queries.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：相鄰營運流程。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L15：`test('teacher summary emphasizes available rewards and expands financial details',async({page})=>{`
- L39：`test('teacher scoped report, debt and separate pagination; focus refresh uses no caller teacher ID',async({page})=>{`
- L48：`test('permission revocation clears previously loaded data; failed lookup cannot appear as zero balance',async({page})=>{`
- L55：`test('empty and missing RPC are distinct; pro has no teacher query entrance',async({page})=>{`
- L61：`test('non instructor role cannot see rewards tab',async({page})=>{await setup(page,'pro');await page.goto('/account');await expect(page.getByRole('tab',{name:'師資返饋金'})).toHaveCount(0);});`
- L63：`test('admin reads named account history through limited RPC only',async({page})=>{`
- L77：`test('twenty-account list opens drawer in viewport and preserves page and position on close',async({page})=>{`
- L93：`test('backoffice entrance requires both read permissions and admin role',async({page})=>{`
- L100：`test('admin purchase sales batch summary and yearly detail keep offline totals separate',async({page})=>{`
- L124：`test('missing purchase migration does not show misleading zero or hide reward history',async({page})=>{`

### eclado/tests/instructor-reward-withdrawals.spec.ts

[原始檔](../tests/instructor-reward-withdrawals.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：相鄰營運流程。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L10：`test('invalid withdrawal shows entered zero and dashes; only in-flight preview is calculating',async({page})=>{`
- L28：`test('full withdrawal uses authoritative preview and unique request key; bank remains masked',async({page})=>{`
- L32：`for(const balance of [0,15,-1])test(ˋwithdrawal is disabled at available ${balance}ˋ,async({page})=>{await setup(page);await page.route('**/rest/v1/rpc/get_my_reward_withdrawals',r=>r.fulfill({json:{...summary,balance,available_balance:Math.max(0,balance)}}));const p=await panel(page);await expect(p.getByRole('button',{name:'申請提領'})).toBeDisabled();await expect(p.getByText(/可用返饋金須超過 NT\$15/)).toBeVisible();});`
- L33：`test('bank save avoids persistent browser storage and sends no owner ID',async({page})=>{`
- L38：`test('stale withdrawal quote asks user to reconfirm and surfaces backend error',async({page})=>{`
- L44：`test('read-only administrator sees masked bank but no transfer controls',async({page})=>{await admin(page,['orders.read','rewards.withdrawals.read']);await expect(page.getByRole('heading',{name:'師資提領管理'})).toBeVisible();await expect(page.getByRole('button',{name:'領取處理'})).toHaveCount(0);await expect(page.getByRole('button',{name:'查看匯款銀行快照'})).toHaveCount(0);});`
- L45：`test('authorized administrator claims once; processing ownership is required',async({page})=>{`
- L49：`test('shared refresh retains withdrawal pagination',async({page})=>{`
- L56：`test('withdrawal management uses nominal monthly batch without annual bank calendar controls',async({page})=>{await admin(page,['orders.read','rewards.withdrawals.read','rewards.withdrawals.manage']);await expect(page.getByText(/每月 10 日為匯款批次/)).toBeVisible();await expect(page.getByRole('heading',{name:'年度銀行休假資料'})).toHaveCount(0);});`
- L57：`test('withdrawal access requires dedicated read capability and administrator role',()=>{expect(canAccessBackofficePage({role:'admin',permissions:['orders.read','members.read']},'withdrawals')).toBe(false);expect(canAccessBackofficePage({role:'catalog_editor',permissions:['rewards.withdrawals.read']},'withdrawals')).toBe(false);});`
- L58：`test('manual paid record supplies actual date reference amount; unresolved write retries same event key',async({page})=>{`
- L66：`test('manager bank snapshot is temporary and clears on page focus',async({page})=>{`
- L75：`test('missing bank explains disabled withdrawal and edits do not affect existing applications',async({page})=>{`
- L79：`test('teacher confirmation is cancellable and reviews authoritative quote without sending request',async({page})=>{`
- L86：`test('teacher statuses are plain language and uncertain submissions retry the same request',async({page})=>{`
- L92：`test('admin filters reach backend, batch summary spans all pages and export is explicit',async({page})=>{`
- L99：`test('read only has no export and paid form preserves draft and validates amount',async({page})=>{`
- L106：`for(const [amount,tax,premium,net] of [[19999,0,0,19984],[20000,0,422,19563],[20001,2000,422,17564],[30000,3000,633,26352]])test(ˋwithdrawal tax preview and frozen confirmation at ${amount}ˋ,async({page})=>{`
- L118：`test('legacy server cannot silently submit a fee-only withdrawal',async({page})=>{`
- L125：`test('taxed admin totals and paid dialog enforce the frozen net transfer',async({page})=>{`
- L138：`test('custom amount previews on backend, full amount fills and partial submission locks current batch',async({page})=>{`
- L152：`test('batch restriction comes from server across pagination; failed batch can be reapplied',async({page})=>{`
- L159：`test('late custom preview cannot replace newer amount and missing migration blocks submission',async({page})=>{`

### eclado/tests/instructor-student-admin.spec.ts

[原始檔](../tests/instructor-student-admin.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：相鄰營運流程。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L22：`test('學生折數独立設定、版本衝突可重讀，原會員折數不被呼叫', async ({ page }) => {`
- L48：`test('會員詳情可設定老師類型並確認清空，保留學生', async ({ page }) => {`
- L85：`test('學生建立、換綁、解除只送RPC，確認取消不寫入', async ({ page }) => {`
- L120：`test('只有會員讀權限時可讀關係但無管理操作或設定入口', async ({ page })=>{`

### eclado/tests/integration/admin-analytics-db.test.cjs

[原始檔](../tests/integration/admin-analytics-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：相鄰營運流程。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L6：`test('analytics SQL aggregates all orders, Taipei boundaries, snapshots, gifts and permissions', { skip: !process.env.PGLITE_MODULE }, async () => {`

### eclado/tests/integration/admin-dashboard-db.test.cjs

[原始檔](../tests/integration/admin-dashboard-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：相鄰營運流程。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L9：`test('dashboard SQL preserves totals, bounded payment summaries and permission boundaries', { skip: !process.env.PGLITE_MODULE }, async () => {`

### eclado/tests/integration/admin-orders-pagination-db.test.cjs

[原始檔](../tests/integration/admin-orders-pagination-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：相鄰營運流程。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L9：`test('paginated order RPCs preserve cross-page filters, lazy details and administrator boundaries', { skip: !process.env.PGLITE_MODULE }, async () => {`

### eclado/tests/integration/cart-reminder-worker.test.cjs

[原始檔](../tests/integration/cart-reminder-worker.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：相鄰營運流程。工作區：??。本次靜態盤點，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L11：`test('public copy is preserved and placeholders become a fixed, token-free cart URL',()=>{`
- L19：`test('LINE sends a stable retry key; an accepted retry response is success',async()=>{`
- L27：`test(ˋLINE ${status} classified as ${result}ˋ,async()=>assert.equal((await deliverCartReminder(job,{env,fetchImpl:async()=>json({},status)})).result,result));`
- L29：`test('timeout is ambiguous and missing credentials do not call providers',async()=>{`
- L33：`test('Email escapes custom text, adds a real cart button and preserves idempotency',async()=>{`
- L43：`test('worker rechecks eligibility before delivery and marks success only after acceptance',async()=>{`
- L56：`test('changed cart final check suppresses provider send',async()=>{`
- L65：`test('worker does not claim success for a stale completion or ambiguous provider response',async()=>{`
- L76：`test('worker auth fails closed and never touches a database for unauthorized requests',async()=>{`

### eclado/tests/integration/cart-reminders-db.test.cjs

[原始檔](../tests/integration/cart-reminders-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：相鄰營運流程。工作區：??。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L8：`test('abandoned cart reminders: settings, 24h eligibility, leases, delivery and round isolation', { skip:!process.env.PGLITE_MODULE }, async t => {`
- L46：`await t.test('default template, permission boundaries, and concurrent settings edits',async()=>{`
- L61：`await t.test('24 hours, disabled switch, verified contact and existing online orders',async()=>{`
- L69：`await t.test('exclusive lease, final order check and stale worker token',async()=>{`
- L75：`await t.test('cart changes before first delivery defer 24h; empty cart starts a new round',async()=>{`
- L86：`await t.test('ambiguous retry freezes content, recipient, sender and provider key',async()=>{`
- L94：`await t.test('definite LINE rejection falls back to verified Email with its own stable key',async()=>{`
- L99：`await t.test('changed cart after ambiguous attempt cancels; expired provider retry window becomes unknown',async()=>{`
- L107：`await t.test('pure cart reads and repeat operations do not restart the 24h clock',async()=>{`
- L116：`await t.test('online checkout starts a new cart round while historical and other-member orders do not suppress it',async()=>{`
- L126：`await t.test('disabling after claim pauses before provider access; deleted profile cancels the pending delivery',async()=>{`
- L134：`await t.test('lost lease retries with same key; deleting the test member removes routing data',async()=>{`

### eclado/tests/integration/instructor-reward-notifications-db.test.cjs

[原始檔](../tests/integration/instructor-reward-notifications-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：相鄰營運流程。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L6：`test('6: transactional outbox, fenced workers and read-only financial reconciliation', { skip: !process.env.PGLITE_MODULE && !process.env.EMBEDDED_POSTGRES_MODULE, timeout: 180000 }, () => runRewardCheckoutDatabaseScenario(async c => {`

### eclado/tests/integration/instructor-reward-queries-db.test.cjs

[原始檔](../tests/integration/instructor-reward-queries-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：相鄰營運流程。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L3：`test('3: isolated reward queries, historical ownership, ACL and consistent read pages',`

### eclado/tests/integration/professional-quarterly-notices.test.cjs

[原始檔](../tests/integration/professional-quarterly-notices.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：相鄰營運流程。工作區：tracked clean。本次靜態盤點，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L6：`test('一月排程只準備及領取季度通知，不進行年度結算或降級', async () => {`
- L38：`test('任一季度內重跑都只準備上一個完整季度', () => {`
- L45：`test('季度通知清楚區分季度、年度與暫估學員數', () => {`

### eclado/tests/integration/reward-bank.test.cjs

[原始檔](../tests/integration/reward-bank.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：相鄰營運流程。工作區：tracked clean。本次靜態盤點，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L6：`test('bank normalization rejects malformed and incomplete sensitive data',()=>{`
- L10：`test('AES-GCM ciphertext binds owner, authenticates content and preserves historical key IDs',()=>{`
- L18：`test('bank encryption fails closed without valid key, never using payment credentials',()=>{const old={...process.env};try{delete process.env.REWARD_BANK_ACTIVE_KEY_ID;assert.throws(()=>encryptBank('owner',bank));}finally{restore(old);}});`
- L26：`test('bank endpoint derives actor from verified Auth, ignores forged caller owner and returns only masked data',async()=>{`
- L30：`test('unauthorized callers never reach bank storage',async()=>{const {res,calls}=await scenario({action:'save',bank},{valid:false});assert.equal(res.code,401);assert.equal(calls.length,1);});`
- L31：`test('service RPC permission failures are generic, no crypto payload or account leakage',async()=>{const {res}=await scenario({action:'save',bank},{reject:true});assert.equal(res.code,403);assert.ok(!JSON.stringify(res.body).includes(bank.account));});`
- L32：`test('bank endpoint validates before encrypting or storage',async()=>{const {res,calls}=await scenario({action:'save',bank:{...bank,branch:''}});assert.equal(res.code,400);assert.equal(calls.length,1);});`
- L34：`test('CSV escapes text, prevents formulas, preserves account zeros and never exports ciphertext',()=>{`
- L42：`test('export API uses verified actor, one server batch selection and no partial CSV on decryption failure',async()=>{`
- L54：`test('taxed CSV and notification use frozen deductions and actual net amount',()=>{`

### eclado/tests/integration/reward-notification-worker.test.cjs

[原始檔](../tests/integration/reward-notification-worker.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：相鄰營運流程。工作區：tracked clean。本次靜態盤點，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L8：`test('templates expose only explicit safe fields for all five events', () => {`
- L16：`test('LINE accepts stable retry key; documented accepted 409 is success', async () => {`
- L20：`for(const code of [400,429,500])test(ˋconfirmed LINE ${code} policy requests Email fallbackˋ,async()=>{`
- L23：`test('network failure and timeout remain ambiguous; no immediate cross-channel call',async()=>{`
- L28：`test('Email stable key, branded escaping, provider acceptance and safe error classification',async()=>{`
- L33：`test('missing provider credentials do not make HTTP calls',async()=>{`
- L37：`test('worker only claims canonical DB jobs and completes with fenced token',async()=>{`
- L45：`test('worker accepts the Vercel SUPABASE_SERVICE_KEY alias',async()=>{`
- L56：`test('worker interruption after provider accepts is not swallowed as confirmed completion',async()=>{`
- L62：`test('worker refuses environments containing bank decryption credentials',async()=>{`
- L65：`test('worker endpoint refuses anonymous/member credentials and no arbitrary content is sent',async()=>{`
- L72：`test('authorized empty worker ticks and interruptions record safe execution metadata',async()=>{`

### eclado/tests/integration/reward-purchase-sales-db.test.cjs

[原始檔](../tests/integration/reward-purchase-sales-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：相鄰營運流程。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L34：`if(require.main===module)test('purchase sales: renewal parity, Taipei dates, qualification and admin ACL', {skip:!process.env.PGLITE_MODULE,timeout:60000},async()=>{`

### eclado/tests/integration/reward-reconciliation-presentation.test.mjs

[原始檔](../tests/integration/reward-reconciliation-presentation.test.mjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：相鄰營運流程。工作區：tracked clean。本次靜態盤點，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L6：`test('every emitted reconciliation rule has a Chinese label and explanation',()=>{`
- L12：`test('presentation distinguishes money, event counts, absent data and statuses without changing findings',()=>{`

### eclado/tests/integration/reward-redemption-export-db.test.cjs

[原始檔](../tests/integration/reward-redemption-export-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：相鄰營運流程。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L3：`test('redemption export: real lifecycle rows, role ACL, Taipei dates and immutable audit',`

### eclado/tests/integration/reward-withdrawal-deductions-db.test.cjs

[原始檔](../tests/integration/reward-withdrawal-deductions-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：相鄰營運流程。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L3：`test('deductions: boundaries, legacy snapshots, real net payments, export and financial reconciliation',`

### eclado/tests/integration/reward-withdrawal-operations-db.test.cjs

[原始檔](../tests/integration/reward-withdrawal-operations-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：相鄰營運流程。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L4：`test('withdrawal queue: full batch totals, filtered pagination, service-only audited export and ACL',`

### eclado/tests/integration/reward-worker-host.test.cjs

[原始檔](../tests/integration/reward-worker-host.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：相鄰營運流程。工作區： M。本次靜態盤點，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L4：`test('host: default disabled and check mode make zero network requests',async()=>{`
- L9：`test('host: bank keys, missing providers, project mismatch and unknown actions fail closed',async()=>{`
- L14：`test('host: dispatch uses existing bounded claim engine without arbitrary destinations',async()=>{`
- L17：`test('host: reconcile same Taiwan day reuses key, midnight changes key, manual retry retains key',async()=>{`
- L24：`test('host: reconciliation never calls providers and configuration has no payment secrets',async()=>{`
- L29：`test('host: scheduled dispatch opts into the course credit RPC without altering notification dispatch', async () => {`
- L45：`test('host: course dispatch sends the payer a single reminder and records provider acceptance', async () => {`

### eclado/tests/professional-renewals-manual.spec.ts

[原始檔](../tests/professional-renewals-manual.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：相鄰營運流程。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L9：`test('手動 migration 與完整 schema 一致，舊批次入口失效且保留交易防護', () => {`
- L34：`test('唯讀預覽：台灣跨年、資格邊界、歷史申請與人數分開計算', () => {`
- L101：`test('年度名單、單人結算與篩選不影響其他會員',async({page})=>{`
- L114：`test('未申請降級需原因與確認，處理後仍留在年度名單',async({page})=>{`
- L128：`test('取消確認不寫入；未結束年度禁止結算及降級',async({page})=>{`
- L138：`test('資格變更拒絕後可重試、不顯示成功',async({page})=>{`
- L146：`test('SQL 未部署只有唯讀預覽，禁止任何新寫入',async({page})=>{`
- L154：`test('僅讀取權限不提供資格異動操作',async({page})=>{`
- L160：`test('另一分頁已結算時不當成新成功，重新載入並移除結算按鈕',async({page})=>{`
- L168：`test('快速切換年度，較慢的舊年度回應不能覆蓋新名單',async({page})=>{`
- L183：`test('審核成功但通知斷線，仍更新狀態且不允許重複審核',async({page})=>{`

### eclado/tests/professional-renewals-sql.spec.ts

[原始檔](../tests/professional-renewals-sql.spec.ts)｜Playwright｜SQL／原始碼靜態斷言

範圍：相鄰營運流程。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L7：`test('續約送出修正與完整 migration 保持一致，年份變數不與欄位同名', () => {`
- L18：`test('獎狀新增修正由上傳路徑取得 ID，衝突時不覆蓋既有資料', () => {`
- L30：`test('續約申請、審核與未申請降級由後端交易函式處理', () => {`
- L40：`test('A 條件依有效日比例計算且年度路徑禁止零進貨季度', () => {`
- L48：`test('品牌專班證明使用 private bucket、短效存取所需 RLS 與人工審核', () => {`
- L58：`test('季度通知快照有唯一版本、原子領取與失敗重試', () => {`

### eclado/tests/professional-sales-opening-balance-sql.spec.ts

[原始檔](../tests/professional-sales-opening-balance-sql.spec.ts)｜Playwright｜SQL／原始碼靜態斷言

範圍：相鄰營運流程。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L14：`test('線下補登以資格季度為單位保存並只能透過 RPC 存取', () => {`
- L22：`test('自然季補登使用 quarter_start 且拒絕無法安全拆分的舊制總額', () => {`
- L29：`test('起始日與補登需要會員寫入權限、不可設為未來並留下操作紀錄', () => {`
- L39：`test('季度總額合併官網訂單與線下補登', () => {`
- L45：`test('舊補登 RPC 保持可用且修改起始日不會讓補登成為孤兒', () => {`
- L56：`test('同日切換身分的空資格紀錄會被清除且不影響回溯起始日', () => {`

### eclado/tests/professional-sales-sql.spec.ts

[原始檔](../tests/professional-sales-sql.spec.ts)｜Playwright｜SQL／原始碼靜態斷言

範圍：相鄰營運流程。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L14：`test('專業會員保留資格歷程並依 user_id 歸戶', () => {`
- L22：`test('專業會員採自然季並以資格起訖日裁切部分季度', () => {`
- L30：`test('季度採購額使用商品實付快照、不含運費並排除無效訂單', () => {`
- L38：`test('角色變更與季度查詢由後端權限及原子 RPC 保護', () => {`

### eclado/tests/reward-redemption-export.spec.ts

[原始檔](../tests/reward-redemption-export.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：相鄰營運流程。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L11：`test('export uses server filters and all returned rows, Chinese statuses and safe CSV text',async({page})=>{`
- L23：`test('missing migration and denied access cannot appear as successful export',async({page})=>{`
- L31：`test('date validation and no reward permission do not request export',async({page})=>{`

## 其他

### eclado/tests/admin-sidebar-favorites-sql.spec.ts

[原始檔](../tests/admin-sidebar-favorites-sql.spec.ts)｜Playwright｜SQL／原始碼靜態斷言

範圍：本次未列為結帳核心。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L7：`test('後台常用設定每個帳號只能讀寫自己的一筆', () => {`

### eclado/tests/brand-story.spec.ts

[原始檔](../tests/brand-story.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：本次未列為結帳核心。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L4：`test('品牌故事圖文、素材與導覽在不同寬度保持完整', async ({ page }, testInfo) => {`
- L49：`test('品牌故事數字進入畫面上數一次，導覽可回頂且不增加歷史紀錄', async ({ page }) => {`

### eclado/tests/clinical-journal.spec.ts

[原始檔](../tests/clinical-journal.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：本次未列為結帳核心。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L8：`test('公開文章資料及首頁入口不再包含待確認宣稱', () => {`
- L13：`test('首頁第二個 Hero 保養分享仍連到第一篇文章', async ({ page }) => {`
- L27：`test(ˋ保養專欄：${slug}ˋ, async ({ page }, testInfo) => {`

### eclado/tests/historical-orders-sql.spec.ts

[原始檔](../tests/historical-orders-sql.spec.ts)｜Playwright｜SQL／原始碼靜態斷言

範圍：本次未列為結帳核心。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L7：`test('歷史補登沿用 orders 並以來源與交易日期區分', () => {`
- L14：`test('後端固定歷史來源與既有完成狀態且不信任前端', () => {`
- L22：`test('商品快照使用管理員輸入的歷史價格並驗證資料', () => {`
- L31：`test('建立 order 與內部備註位於同一 transaction', () => {`
- L38：`test('歷史訂單不觸發庫存 allocation、付款或物流資料', () => {`
- L44：`test('歷史訂單快照與來源不可被後續改寫', () => {`
- L50：`test('歷史補登只能透過管理員 RPC 單向作廢且不可永久刪除', () => {`
- L60：`test('熱門商品統計排除歷史補登', () => {`
- L65：`test('內部備註不透過會員可讀的 orders row 保存', () => {`

### eclado/tests/instructor-student-notifications.spec.ts

[原始檔](../tests/instructor-student-notifications.spec.ts)｜Playwright｜純函式／靜態或自行攔截的瀏覽器案例；依個別案例判讀

範圍：本次未列為結帳核心。工作區：tracked clean。本次僅收集案例，未執行。

有條件 skip，依案例判讀。

- L3：`test('local binding preview: real bind/rebind/unbind, seven recipients and Email fallback',async({page})=>{`

### eclado/tests/integration/admin-delete-member.test.cjs

[原始檔](../tests/integration/admin-delete-member.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：本次未列為結帳核心。工作區：tracked clean。本次靜態盤點，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L11：`test('admin delete member writes a sanitized audit record with the real actor role', async () => {`
- L32：`test('self deletion is rejected before any service-role lookup or Auth deletion', async () => {`
- L41：`test('ordinary admin cannot delete another backoffice identity', async () => {`
- L52：`test('super admin also cannot use the member flow to delete another admin or super admin', async () => {`
- L69：`test('inactive backoffice identities fail closed and cannot be deleted as ordinary members', async () => {`
- L79：`test('missing members.write permission and inactive actors cannot delete members', async () => {`
- L89：`test('missing profiles and malformed ids are rejected without Auth deletion', async () => {`

### eclado/tests/integration/instructor-student-notification-delivery.test.cjs

[原始檔](../tests/integration/instructor-student-notification-delivery.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：本次未列為結帳核心。工作區：tracked clean。本次靜態盤點，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L8：`test('all seven recipient templates; new teacher copy is identical for bind and rebind',()=>{`
- L19：`test('binding LINE and branded Email use the same approved text and stable provider keys',async()=>{`
- L26：`test('one shared batch cap; binding completion uses its own queue; host allows only enabled binding RPCs',async()=>{`

### eclado/tests/integration/instructor-student-notifications-db.test.cjs

[原始檔](../tests/integration/instructor-student-notifications-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：本次未列為結帳核心。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L50：`if (require.main === module) test('binding outbox: atomic recipients, privacy, fencing, fallback, ACL, deletion and migration repeat', {skip:!process.env.PGLITE_MODULE,timeout:60000}, async () => {`

### eclado/tests/integration/member-cart-db.test.cjs

[原始檔](../tests/integration/member-cart-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：本次未列為結帳核心。工作區：??。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L7：`test('member carts enforce ownership, atomic validation, patching and retry deduplication', {`

### eclado/tests/integration/professional-application-admin-notice.test.cjs

[原始檔](../tests/integration/professional-application-admin-notice.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：本次未列為結帳核心。工作區：tracked clean。本次靜態盤點，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L5：`test('new professional application sends one minimal branded admin email', async () => {`
- L56：`test('already claimed or delivered application does not send a duplicate email', async () => {`
- L83：`test('admin notice endpoint rejects requests without member authentication', async () => {`

### eclado/tests/integration/professional-application-notice.test.cjs

[原始檔](../tests/integration/professional-application-notice.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：本次未列為結帳核心。工作區：tracked clean。本次靜態盤點，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L5：`test('professional application approval sends LINE first', async () => {`
- L49：`test('professional application rejection falls back to Email when LINE is unavailable', async () => {`
- L92：`test('professional application notice rejects unreviewed applications', async () => {`

### eclado/tests/integration/professional-renewal-notice.test.cjs

[原始檔](../tests/integration/professional-renewal-notice.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：本次未列為結帳核心。工作區：tracked clean。本次靜態盤點，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L11：`test('續約核准通知優先使用 LINE 並回寫發送狀態', async t => {`

### eclado/tests/integration/reward-withdrawal-mock-fixtures-db.test.cjs

[原始檔](../tests/integration/reward-withdrawal-mock-fixtures-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：本次未列為結帳核心。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L3：`test('test-only withdrawal fixtures create 30 coherent states without changing original available funds',`

### eclado/tests/integration/seo-rendering.test.cjs

[原始檔](../tests/integration/seo-rendering.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：本次未列為結帳核心。工作區： M。本次靜態盤點，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L15：`test('SEO renderer places product content and metadata in initial HTML', () => {`
- L36：`test('product pages without a public offer keep breadcrumbs but omit Product markup', () => {`
- L44：`test('legacy slugs and Vercel routing preserve real redirect and 404 handling', () => {`
- L65：`test('product fallback returns HTTP 301 for legacy slugs', async () => {`
- L72：`test('product fallback returns HTTP 404 and noindex for unknown products', async () => {`
- L88：`test('product template ignores request hosts and uses trusted origin without redirects', async () => {`
- L120：`test('template fetch failures retain safe product HTML instead of following an external redirect', async () => {`
- L138：`test('preview templates use isolated deployment configuration rather than request headers', async () => {`

### eclado/tests/integration/site-announcement-db.test.cjs

[原始檔](../tests/integration/site-announcement-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：本次未列為結帳核心。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L7：`test('announcement migration: permissions, validation, persistence and reapply', {skip:!process.env.PGLITE_MODULE}, async()=>{`
- L39：`test('announcement schedule migration: saved settings preserved, legacy writes retain schedule and invalid times roll back', {skip:!process.env.PGLITE_MODULE}, async()=>{`

### eclado/tests/integration/site-announcement-schedule.test.mjs

[原始檔](../tests/integration/site-announcement-schedule.test.mjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：本次未列為結帳核心。工作區：tracked clean。本次靜態盤點，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L5：`test('announcement schedule: inclusive start, exclusive end, switch and invalid timestamps',()=>{`
- L21：`test('announcement Taipei midnight conversion is independent of device timezone',()=>{`

### eclado/tests/integration/sitemap.test.cjs

[原始檔](../tests/integration/sitemap.test.cjs)｜Node test｜Node 規則／handler／HTTP；外部依賴模擬

範圍：本次未列為結帳核心。工作區：tracked clean。本次靜態盤點，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L15：`test('sitemap reads products through the public storefront RPC', async () => {`
- L39：`test('sitemap includes storefront product URLs', () => {`
- L54：`test('sitemap rejects malformed storefront responses', async () => {`

### eclado/tests/integration/student-pricing-db.test.cjs

[原始檔](../tests/integration/student-pricing-db.test.cjs)｜Node test｜隔離 SQL；自建 schema／部分依賴替身

範圍：本次未列為結帳核心。工作區：tracked clean。本次靜態盤點，未執行。

須提供隔離 DB runtime；缺少時可 skip；雙連線競爭案例另須 embedded PostgreSQL（如有）。

- L255：`if(require.main===module)test('1C: real existing engines plus student prices and AUTO/MANUAL',`

### eclado/tests/inventory-receipts.spec.ts

[原始檔](../tests/inventory-receipts.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：本次未列為結帳核心。工作區：??。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L4：`test('入庫單可建單、預覽、確認及從歷史查看成本', async ({ page }) => {`
- L92：`test('叫貨單可開啟分批入庫草稿並取消未到商品', async ({ page }) => {`

### eclado/tests/member-admin-notes-sql.spec.ts

[原始檔](../tests/member-admin-notes-sql.spec.ts)｜Playwright｜SQL／原始碼靜態斷言

範圍：本次未列為結帳核心。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L7：`test('會員內部備註獨立於 profiles 且會員本人無法讀寫', () => {`
- L14：`test('會員或訂單查看權限可讀、只有會員編輯權限可寫並留下操作紀錄', () => {`

### eclado/tests/operating-costs.spec.ts

[原始檔](../tests/operating-costs.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：本次未列為結帳核心。工作區：??。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L4：`test('營業分析提供成本待確認及估列核准，側欄只有一個入口', async ({ page }) => {`

### eclado/tests/product-image-optimization.spec.ts

[原始檔](../tests/product-image-optimization.spec.ts)｜Playwright｜純函式／靜態或自行攔截的瀏覽器案例；依個別案例判讀

範圍：本次未列為結帳核心。工作區： M。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L4：`test(ˋ圖片錯誤提示區分 ${failure}，不將所有原因誤報為不支援 WebPˋ, async ({ page }) => {`
- L28：`test('小證照不放大，損壞圖片不誤判為 WebP 不支援', async ({ page }) => {`
- L49：`test(ˋ${kind} WebP 輸出 ${failure} 時改用 JPEG，保留尺寸與白底ˋ, async ({ page }) => {`
- L96：`test('證照與商品 JPEG 也失敗時清楚報錯', async ({ page }) => {`
- L118：`test('後台商品圖片會縮放並轉成 WebP', async ({ page }) => {`
- L151：`test('證照與獎狀使用較高解析度的 WebP 設定', async ({ page }) => {`

### eclado/tests/professional-application-admin-notification-sql.spec.ts

[原始檔](../tests/professional-application-admin-notification-sql.spec.ts)｜Playwright｜SQL／原始碼靜態斷言

範圍：本次未列為結帳核心。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L10：`test('美容師申請管理員通知具有一次性 claim 與寄送狀態', () => {`
- L20：`test('通知狀態 RPC 只授權 service role', () => {`

### eclado/tests/professional-application-certificates-sql.spec.ts

[原始檔](../tests/professional-application-certificates-sql.spec.ts)｜Playwright｜SQL／原始碼靜態斷言

範圍：本次未列為結帳核心。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L10：`test('美容師證照使用私人 bucket 並限制圖片格式、大小與數量', () => {`
- L18：`test('證照圖片只允許本人上傳與讀取，會員管理權限可讀', () => {`
- L25：`test('不同 Storage bucket 的讀取不會被商品資料表權限連帶阻擋', () => {`
- L32：`test('申請 RPC 驗證 Storage 物件並以同一交易綁定圖片', () => {`

### eclado/tests/professional-application-invoice-defaults-sql.spec.ts

[原始檔](../tests/professional-application-invoice-defaults-sql.spec.ts)｜Playwright｜SQL／原始碼靜態斷言

範圍：本次未列為結帳核心。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L10：`test('美容師申請保存選填公司抬頭與統編快照', () => {`
- L18：`test('核准申請時同步發票預設值，空白申請不覆蓋既有資料', () => {`

### eclado/tests/professional-award-upload.spec.ts

[原始檔](../tests/professional-award-upload.spec.ts)｜Playwright｜瀏覽器＋模擬服務；可能含純函式案例

範圍：本次未列為結帳核心。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L5：`test(ˋ新獎狀上傳 ${fallback ? 'JPEG 備援' : 'WebP'} 並以新增模式呼叫 RPCˋ, async ({ page }) => {`

### eclado/tests/sales-domain.spec.ts

[原始檔](../tests/sales-domain.spec.ts)｜Playwright｜純函式／靜態或自行攔截的瀏覽器案例；依個別案例判讀

範圍：本次未列為結帳核心。工作區：tracked clean。本次僅收集案例，未執行。

未發現此檔直接宣告 skip；可能繼承 helper 的條件。

- L5：`test('客訂規格銷量不計入熱門商品統計', () => {`
- L18：`test('歷史補登商品不計入熱門商品統計', () => {`
- L27：`test('只有客訂規格的商品不會被熱門商品 fallback 補入', () => {`
- L46：`test('專業資格歷程忽略同日開始又結束的空紀錄', async () => {`
- L58：`test('自然季使用年份與季度顯示並以 quarter_start 產生穩定識別', async () => {`

