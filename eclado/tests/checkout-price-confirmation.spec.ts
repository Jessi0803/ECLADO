import { expect, test, type Page } from '@playwright/test';
import { mockEcladoApis } from './support/eclado-mocks';

async function setup(page: Page, member = false) {
  await page.context().route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort('blockedbyclient'));
  // Reproduce the original browser silently refusing native confirm dialogs.
  await page.addInitScript(() => { window.confirm = () => false; });
  const user = { id: 'price-confirmation-test', email: 'price@example.test', user_metadata: { name: '計價測試' },
    app_metadata: { provider: 'email' }, aud: 'authenticated', role: 'authenticated', created_at: '2026-05-01' };
  await page.addInitScript(id => localStorage.setItem(`eclado_pro_banner_${id}`, '1'), user.id);
  const orders: any[] = [], payments: any[] = [];
  await mockEcladoApis(page, { products: [{ id: 2, name: 'Price Test', name_zh: '價格確認測試商品',
    price: 2000, pro_price: 1000, stock: 100, active: true, category: '清潔' }], promotions: [],
    ...(member ? { authUser: user, profiles: [{ id: user.id, email: user.email, name: '計價測試', role: 'consumer' }] } : {}),
    onPaymentRequest: request => payments.push(request) });
  let unitPrice = 2000, quantity = 1;
  const quote = (args: any) => ({ subtotal: unitPrice * Number(args.p_items[0].qty), discount: 0, shipping: 120,
    total: unitPrice * Number(args.p_items[0].qty) + 120, adjustments: [],
    items: [{ id: 2, product_id: 2, variant_id: null, qty: Number(args.p_items[0].qty), name: '價格確認測試商品',
      unit_price: unitPrice, price: unitPrice, line_total: unitPrice * Number(args.p_items[0].qty) }] });
  await page.route('**/rest/v1/rpc/quote_order_pricing', route => route.fulfill({ json: quote(route.request().postDataJSON()) }));
  await page.route('**/rest/v1/rpc/create_order_with_pricing', route => {
    const body = route.request().postDataJSON(); orders.push(body);
    const result = quote(body);
    return route.fulfill({ json: { ...result, payment_amount: result.total, order_id: 'ECL-PRICE-CONFIRM-TEST', payment_token: 'mock-only' } });
  });
  if (member) {
    await page.route('**/rest/v1/rpc/sync_my_cart', route => route.fulfill({ json: {
      items: [{ id: 2, variantId: '', qty: quantity }], revision: quantity,
    } }));
  } else {
    await page.addInitScript(() => localStorage.setItem('eclado_cart_v1', JSON.stringify([{ id: 2, qty: 1 }])));
  }
  await page.goto('/checkout');
  await expect(page.getByText('NT$ 2,120', { exact: true }).first()).toBeVisible();
  await page.locator('#checkout-name').fill('保留收件人');
  await page.locator('#checkout-phone').fill('0912345678');
  await page.locator('#checkout-email').fill('price@example.test');
  await page.getByPlaceholder('縣市').fill('台北市');
  await page.getByPlaceholder('區域').fill('大安區');
  await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('保留地址1號');
  await page.getByRole('button', { name: /繼續確認付款/ }).click();
  await page.getByRole('button', { name: /^信用卡/ }).click();
  unitPrice = 2100;
  return { orders, payments, setQuantity(value: number) { quantity = value; }, setPrice(value: number) { unitPrice = value; } };
}

async function openReview(page: Page) {
  await page.getByRole('button', { name: /^確認訂單$/ }).click();
  const notice = page.getByRole('alert', { name: /訂單(金額|優惠內容)已更新/ });
  await expect(notice).toBeVisible();
  return notice;
}

test('手機按確認後停在新金額與按鈕，不建單不跳頁；再次確認才付款', async ({ page }) => {
  const api = await setup(page);
  const notice = await openReview(page);
  const button = page.getByRole('button', { name: '確認更新金額並付款', exact: true });
  await expect(notice.getByText('NT$ 2,120', { exact: true })).toBeVisible();
  await expect(notice.getByText('NT$ 2,220', { exact: true })).toBeVisible();
  await expect(notice).toBeFocused();
  await expect(notice).toBeInViewport({ ratio: 1 });
  await expect(button).toBeInViewport({ ratio: 1 });
  await expect(button).toBeEnabled();
  await expect(page).toHaveURL(/\/checkout$/);
  expect(api.orders).toHaveLength(0); expect(api.payments).toHaveLength(0);
  await button.click();
  await expect(page.getByRole('heading', { name: '請完成付款' })).toBeVisible();
  expect(api.orders).toHaveLength(1); expect(api.payments).toHaveLength(1);
  expect(api.orders[0].p_expected_quote.total).toBe(2220);
  expect(api.orders[0].p_items[0].expected_unit_price).toBe(2100);
  expect(api.payments[0].amount).toBe(2220);
});

test('再次變價必須重新停留，不能用上一次已顯示的金額建單', async ({ page }) => {
  const api = await setup(page);
  const notice = await openReview(page);
  api.setPrice(2200);
  await page.getByRole('button', { name: '確認更新金額並付款' }).click();
  await expect(notice.getByText('NT$ 2,320', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/checkout$/);
  expect(api.orders).toHaveLength(0); expect(api.payments).toHaveLength(0);
  await page.getByRole('button', { name: '確認更新金額並付款' }).click();
  await expect(page.getByRole('heading', { name: '請完成付款' })).toBeVisible();
  expect(api.payments).toHaveLength(1); expect(api.payments[0].amount).toBe(2320);
});

test('返回修改保留收件資料，修改後不能沿用舊的報價確認', async ({ page }) => {
  const api = await setup(page);
  await openReview(page);
  await page.getByRole('button', { name: '修改', exact: true }).first().click();
  await expect(page.locator('#checkout-name')).toHaveValue('保留收件人');
  await expect(page.getByPlaceholder('路/街/巷/弄/號/樓')).toHaveValue('保留地址1號');
  await page.locator('#checkout-name').fill('修改後收件人');
  await page.getByRole('button', { name: /繼續確認付款/ }).click();
  await expect(page.getByRole('button', { name: /^確認訂單$/ })).toBeVisible();
  const notice = await openReview(page);
  expect(api.orders).toHaveLength(0);
  await page.getByRole('button', { name: '確認更新金額並付款' }).click();
  await expect(page.getByRole('heading', { name: '請完成付款' })).toBeVisible();
  expect(api.orders).toHaveLength(1); expect(api.orders[0].p_member).toBe('修改後收件人');
});

test('背景刷新保留提示，購物車改量則作廢舊確認並重新檢查', async ({ page }) => {
  const api = await setup(page, true);
  const notice = await openReview(page);
  const refreshed = page.waitForResponse('**/rest/v1/rpc/sync_my_cart');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await refreshed;
  await expect(page.locator('form').getByText('NT$ 2,220', { exact: true }).first()).toBeVisible();
  await expect(notice).toBeVisible();
  api.setQuantity(2);
  const synced = page.waitForResponse('**/rest/v1/rpc/sync_my_cart');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await synced;
  await expect(notice).not.toBeVisible();
  await expect(page.getByRole('button', { name: /^確認訂單$/ })).toBeEnabled();
  expect(api.orders).toHaveLength(0); expect(api.payments).toHaveLength(0);
  await openReview(page);
  await page.getByRole('button', { name: '確認更新金額並付款' }).click();
  await expect(page.getByRole('heading', { name: '請完成付款' })).toBeVisible();
  expect(api.orders).toHaveLength(1); expect(api.orders[0].p_items[0].qty).toBe(2);
  expect(api.payments[0].amount).toBe(4320);
});

test('離開結帳不建單；第一次連點不會自動接受新金額', async ({ page }) => {
  const api = await setup(page);
  await page.getByRole('button', { name: /^確認訂單$/ }).evaluate(button => {
    (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('button', { name: '確認更新金額並付款' })).toBeEnabled();
  expect(api.orders).toHaveLength(0); expect(api.payments).toHaveLength(0);
  await page.goto('/shop');
  expect(api.orders).toHaveLength(0); expect(api.payments).toHaveLength(0);
});
