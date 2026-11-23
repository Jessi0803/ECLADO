import { expect, test } from '@playwright/test';
import { getMemberPrice } from '../src/domain/catalog.jsx';
import { mockEcladoApis } from './support/eclado-mocks';

// Catalog/pricing snapshot only; no customer identity, contact or payment data.
// Expected unit prices are the independently observed PostgreSQL numeric quote.
const cartLines = [
  [102, 15, '乳酸菌益膚面膜', '10pcs', 5, 750, 525],
  [112, 25, '氧氣泡泡', '120ml', 1, 980, 686],
  [115, 28, '記憶抗皺眼霜', '30g', 1, 1300, 910],
  [116, 29, '記憶修護霜', '50g', 1, 930, 651],
  [116, 92, '記憶修護霜', '200g', 1, 1650, 1155],
  [120, 33, '棉花水光管理', '(1g + 10ml) * 6', 2, 2650, 1855],
  [121, 34, '水嫩凍膜', '800g', 1, 1580, 1106],
  [123, 36, '極致珍珠緞面膜', '10片', 1, 1380, 966],
  [124, 37, '溫和增效潔面乳', '500ml', 1, 1080, 756],
  [124, 38, '溫和增效潔面乳', '200ml', 1, 655, 459],
  [136, 50, 'VONO 喚膚調理組', '5ml × 6、6ml × 6', 1, 2750, 1925],
  [138, 52, '呼吸安瓶', '30ml', 1, 930, 651],
  [140, 54, '呼吸雪霜', '100g', 1, 1080, 756],
  [141, 55, '呼吸精華液', '100g', 1, 1320, 924],
  [145, 59, '記憶修護霜（試用包）', '2g × 50包', 1, 850, 595],
  [156, 80, '記憶奇蹟活膚乳', '140ml', 1, 1060, 742],
  [159, 84, '淨痘修護霜（試用包）', '2g × 50包', 1, 800, 560],
  [165, 91, 'AHA 角質霜', '100ml', 1, 750, 525],
].map(([id, variantId, name, size, qty, proPrice, expected]) => ({
  id: Number(id), variantId: String(variantId), name: String(name), size: String(size),
  qty: Number(qty), proPrice: Number(proPrice), expected: Number(expected),
}));

test('師資購物車18品項23件的每一項價格及總額都與後端報價一致', () => {
  expect(cartLines).toHaveLength(18);
  expect(cartLines.reduce((sum, line) => sum + line.qty, 0)).toBe(23);
  for (const line of cartLines) {
    expect(getMemberPrice({ proPrice: line.proPrice }, { role: 'instructor' }), line.name + line.size)
      .toBe(line.expected);
  }
  expect(cartLines.reduce((sum, line) => sum + getMemberPrice({ proPrice: line.proPrice }, { role: 'instructor' }) * line.qty, 0))
    .toBe(19702);
});

test('會員倍率以十進位四捨五入，半元上下不因浮點誤差錯價', () => {
  for (const [price, multiplier, expected] of [
    [655, 0.7, 459], [45, 0.7, 32], [100, 0.655, 66],
    [100, 0.654, 65], [100, 0.656, 66], [100.5, 1, 101],
    [654.999, 0.7, 458], [655.001, 0.7, 459], [0, 0.7, 0],
    [0.0000001, 0.7, 0], [9999999.5, 1, 10000000],
  ]) {
    const product = { proPrice: price, pricingOverrides: { instructor: multiplier } };
    expect(getMemberPrice(product, { role: 'instructor' }), `${price} × ${multiplier}`).toBe(expected);
  }
  expect(getMemberPrice({ proPrice: 10, pricingOverrides: { distributor: 0.65 } }, { role: 'distributor' })).toBe(7);
  expect(getMemberPrice({ proPrice: 655 }, { role: 'staff' })).toBe(328);
});

test('整車師資信用卡結帳一次成功到付款頁，不觸發價差確認', async ({ page }) => {
  // Block all real services, even if a mock route is accidentally missing.
  await page.context().route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort('blockedbyclient'));
  const user = { id: 'rounding-instructor', email: 'rounding@example.test', user_metadata: { name: '計價測試' },
    app_metadata: { provider: 'email' }, aud: 'authenticated', role: 'authenticated', created_at: '2026-05-01' };
  const products = [...new Map(cartLines.map(line => [line.id, {
    id: line.id, name: line.name, name_zh: line.name, category: '清潔', price: 3000,
    pro_price: line.proPrice, stock: 100, active: true, publication_status: 'active',
  }])).values()];
  const productVariants = cartLines.map(line => ({ id: Number(line.variantId), product_id: line.id,
    size: line.size, price: 3000, pro_price: line.proPrice, stock: 100, active: true,
    is_default: !cartLines.some(other => other.id === line.id && Number(other.variantId) < Number(line.variantId)),
  }));
  const payments: any[] = [], orders: any[] = [], dialogs: string[] = [];
  await mockEcladoApis(page, { authUser: user, profiles: [{ id: user.id, email: user.email, name: '計價測試', role: 'instructor' }],
    products, productVariants, promotions: [], memberCartItems: cartLines.map(line => ({ id: line.id, variantId: line.variantId, qty: line.qty })),
    onPaymentRequest: request => payments.push(request),
  });
  await page.route('**/rest/v1/rpc/get_my_reward_credit', route => route.fulfill({ json: { available_balance: 0, balance: 0, reserved_balance: 0 } }));
  const quote = { subtotal: 19702, discount: 0, shipping: 0, total: 19702, payment_amount: 19702,
    shopping_credit_amount: 0, reward_credit_amount: 0, automatic_allocation_version: 1,
    pricing_snapshot: { automatic_allocation_version: 1, automatic_allocations: [] }, adjustments: [],
    items: cartLines.map(line => ({ id: line.id, product_id: line.id, variant_id: line.variantId,
      nameZh: line.name, name: line.name, size: line.size, qty: line.qty,
      price: line.expected, unit_price: line.expected, line_total: line.expected * line.qty })),
  };
  for (const rpc of ['quote_order_pricing', 'quote_order_with_wallets']) {
    await page.route(`**/rest/v1/rpc/${rpc}`, route => route.fulfill({ json: quote }));
  }
  await page.route('**/rest/v1/rpc/create_order_with_wallets', route => {
    orders.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...quote, order_id: 'ECL-ROUNDING-TEST', payment_token: 'mock-only' } });
  });
  await page.addInitScript(id => localStorage.setItem(`eclado_pro_banner_${id}`, '1'), user.id);
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.goto('/checkout');
  await expect(page.getByText('NT$ 459', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('NT$ 19,702', { exact: true }).first()).toBeVisible();
  await page.locator('#checkout-name').fill('計價測試');
  await page.locator('#checkout-phone').fill('0912345678');
  await page.getByPlaceholder('縣市').fill('台北市');
  await page.getByPlaceholder('區域').fill('大安區');
  await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('測試路1號');
  await page.getByRole('button', { name: /繼續確認付款/ }).click();
  await page.getByRole('button', { name: /^信用卡/ }).click();
  await page.getByRole('button', { name: /^確認訂單$/ }).click();
  await expect(page.getByRole('heading', { name: '請完成付款' })).toBeVisible();
  expect(dialogs).toEqual([]);
  expect(orders).toHaveLength(1);
  expect(orders[0].p_items).toHaveLength(18);
  expect(orders[0].p_items.find((item: any) => String(item.variant_id) === '38').expected_unit_price).toBe(459);
  expect(payments).toHaveLength(1);
  expect(payments[0].amount).toBe(19702);
  expect(payments[0].payType).toBe('C');
  await expect(page.getByRole('link', { name: /前往.*付款|信用卡/ }).or(page.getByRole('button', { name: /前往.*付款|信用卡/ })).first()).toBeVisible();
});
