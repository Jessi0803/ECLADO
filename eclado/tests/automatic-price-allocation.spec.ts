import { test, expect } from '@playwright/test';
import { mockEcladoApis } from './support/eclado-mocks';

test('購物車以權威報價列出多筆活動，數量變更重新試算', async ({ page }) => {
  await mockEcladoApis(page);
  let calls = 0;
  await page.route('**/rest/v1/rpc/quote_order_pricing', async route => {
    const request = route.request().postDataJSON();
    const qty = request.p_items.reduce((n: number, item: { qty: number }) => n + item.qty, 0);
    calls++;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      items: [], subtotal: 3980 * qty, discount: 300 * qty, shipping: 120, total: 3680 * qty + 120,
      promotion_id: null, automatic_allocation_version: 1,
      adjustments: [
        { name: '商品 A 自動優惠', amount: 100 * qty, adjustment_type: 'fixed_discount' },
        { name: '商品 B 買贈優惠', amount: 200 * qty, adjustment_type: 'buy_x_get_y' },
      ],
    }) });
  });
  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await page.locator('nav').getByRole('button', { name: /^購物車/ }).click();
  const cart = page.getByRole('dialog', { name: '購物車' });
  await expect(cart.getByText('商品 A 自動優惠')).toBeVisible();
  await expect(cart.getByText('商品 B 買贈優惠')).toBeVisible();
  await expect(cart.getByText('NT$ 3,800', { exact: true })).toBeVisible();
  await cart.getByRole('button', { name: '+', exact: true }).click();
  await expect(cart.getByText('−NT$ 400', { exact: true })).toBeVisible();
  expect(calls).toBeGreaterThan(1);
  await cart.getByRole('button', { name: '前往結帳', exact: true }).click();
  await page.getByRole('button', { name: '訪客結帳', exact: true }).click();
  await cart.waitFor({ state: 'hidden' });
  await expect(page.getByText('商品 A 自動優惠', { exact: true })).toBeVisible();
  await expect(page.getByText('商品 B 買贈優惠', { exact: true })).toBeVisible();
});

test('合計同額但活動分配改變，付款前仍需再次確認', async ({ page }) => {
  let changed = false;
  let created = 0;
  await mockEcladoApis(page, { promotions: [], onOrderPricingRequest: () => created++ });
  await page.route('**/rest/v1/rpc/quote_order_pricing', async route => {
    const request = route.request().postDataJSON();
    const name = changed ? '更新後的活動' : '原本的活動';
    const items = request.p_items.map((item: { product_id: number; variant_id: string; qty: number }) => ({ ...item,
      name: '胜肽修護精華液', nameZh: '胜肽修護精華液', unit_price: 3980, line_total: 3980 * item.qty, line_type: 'merchandise' }));
    const subtotal = items.reduce((n: number, item: { line_total: number }) => n + item.line_total, 0);
    const adjustment = { promotion_id: 'activity', name, amount: 400, adjustment_type: 'fixed_discount' };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items, subtotal, discount: 400, shipping: 120,
      total: subtotal - 280, adjustments: [adjustment], automatic_allocation_version: 1,
      pricing_snapshot: { automatic_allocation_version: 1, automatic_allocations: [adjustment] },
    }) });
  });
  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await page.locator('nav').getByRole('button', { name: /^購物車/ }).click();
  await page.getByRole('button', { name: '前往結帳', exact: true }).click();
  await page.getByRole('button', { name: '訪客結帳', exact: true }).click();
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('TEST'); await inputs.nth(1).fill('0900000000'); await inputs.nth(2).fill('test@example.test');
  await page.getByPlaceholder('縣市').fill('TEST'); await page.getByPlaceholder('區域').fill('TEST'); await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('TEST');
  await expect(page.getByText('原本的活動', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '繼續確認付款' }).click();
  changed = true;
  let prompted = false;
  page.on('dialog', async dialog => { prompted = true; await dialog.dismiss(); });
  await page.getByRole('button', { name: '建立付款單', exact: true }).click();
  await expect.poll(() => prompted).toBe(true);
  await expect(page.getByText('更新後的活動', { exact: true })).toBeVisible();
  expect(created).toBe(0);
});
