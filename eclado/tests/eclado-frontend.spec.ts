import { expect, test } from '@playwright/test';
import { activePromotion, mockEcladoApis, mockProducts, type MockAuthUser } from './support/eclado-mocks';

test.beforeEach(async ({ page }) => {
  await mockEcladoApis(page);
});

const TEST_USER_ID = 'user-e2e-member';

function authUser(email: string): MockAuthUser {
  return {
    id: TEST_USER_ID,
    email,
    user_metadata: { name: 'E2E 會員' },
    app_metadata: { provider: 'email' },
    aud: 'authenticated',
    role: 'authenticated',
    created_at: '2026-05-01T00:00:00.000Z',
  };
}

function profile(role: string, email = 'member@example.com') {
  return {
    id: TEST_USER_ID,
    email,
    name: 'E2E 會員',
    phone: '0912345678',
    role,
    created_at: '2026-05-01T00:00:00.000Z',
  };
}

async function openCart(page: import('@playwright/test').Page) {
  await page.locator('nav').getByRole('button', { name: /^購物車/ }).click();
}

test('主要路徑可開啟且不白屏', async ({ page }) => {
  for (const path of ['/', '/shop', '/cart', '/checkout', '/login', '/professional-apply', '/about', '/info', '/privacy', '/contact', '/admin']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    const body = page.locator('body');
    await expect(body).toBeVisible();
    await expect(body).not.toBeEmpty();
  }
});

test('商城瀏覽、商品詳情、一般會員價格與院線商品限制', async ({ page }) => {
  await page.goto('/shop');
  await expect(page.getByText('胜肽修護精華液').first()).toBeVisible();
  await expect(page.getByText('NT$ 3,980').first()).toBeVisible();

  await page.getByText('NK細胞活化安瓶').first().click();
  await expect(page.getByText('院線專業課程')).toBeVisible();
  await expect(page.getByText('私訊 LINE 官方詢問')).toBeVisible();
  await expect(page.getByRole('button', { name: /加入購物車/ })).toHaveCount(0);
});

for (const scenario of [
  { role: 'pro', label: '專業價', priceLabel: 'NT$ 2,980', proOnlyButton: true },
  { role: 'instructor', label: '師資價・專業價7折', priceLabel: 'NT$ 2,086', proOnlyButton: true },
  { role: 'distributor', label: '經銷價・專業價65折', priceLabel: 'NT$ 1,937', proOnlyButton: true },
]) {
  test(`會員角色價格：${scenario.role} 看到對應價格並可購買院線商品`, async ({ page }) => {
    await mockEcladoApis(page, {
      authUser: authUser(`${scenario.role}@example.com`),
      profiles: [profile(scenario.role, `${scenario.role}@example.com`)],
    });

    await page.goto('/shop');
    await expect(page.getByText(scenario.label).first()).toBeVisible();
    await expect(page.getByText(scenario.priceLabel).first()).toBeVisible();

    await page.getByText('NK細胞活化安瓶').first().click();
    await expect(page.getByText('院線專業集中護理')).toBeVisible();
    await expect(page.getByRole('button', { name: /加入購物車/ })).toBeVisible();
  });
}

test('DB 的 is_pro_only=true 會讓原本公開商品變院線限定', async ({ page }) => {
  // 商品 id=2（胜肽修護精華液）在 PRODUCTS 常數裡 isProOnly=false
  // 模擬 DB 回傳 is_pro_only: true，前端應該讀 DB 值並限制非專業會員
  await mockEcladoApis(page, {
    products: mockProducts.map(p => p.id === 2 ? { ...p, is_pro_only: true } : p),
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await expect(page.getByText('院線專業課程')).toBeVisible();
  await expect(page.getByRole('button', { name: /加入購物車/ })).toHaveCount(0);
});

test('DB 的 price 覆蓋寫死的售價', async ({ page }) => {
  // 商品 id=2 在 PRODUCTS 常數裡 price=3980，改成 DB 回傳 price=2999
  await mockEcladoApis(page, {
    products: mockProducts.map(p => p.id === 2 ? { ...p, price: 2999 } : p),
    promotions: [],
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await expect(page.getByText('NT$ 2,999').first()).toBeVisible();
});

test('現貨、預購、活動折扣與購物車操作', async ({ page }) => {
  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await expect(page.getByText(/現貨商品/).first()).toBeVisible();
  await expect(page.getByText('限時優惠')).toBeVisible();
  await page.getByRole('button', { name: /加入購物車/ }).click();

  await openCart(page);
  await expect(page.getByText('E2E 測試活動')).toBeVisible();
  await expect(page.getByText('NT$ 3,702')).toBeVisible();

  await page.getByRole('button', { name: '+' }).first().click();
  await expect(page.getByText('NT$ 7,284')).toBeVisible();

  await page.getByRole('button', { name: /移除/ }).click();
  await expect(page.getByText('購物車是空的')).toBeVisible();
});

test('活動折扣可先減金額再打折', async ({ page }) => {
  await mockEcladoApis(page, {
    promotions: [{
      ...activePromotion,
      name: '先減再折測試活動',
      discount_rate: 0.8,
      discount_amount: 100,
      discount_order: 'amount_then_rate',
    }],
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await expect(page.getByText('NT$ 3,104')).toBeVisible();
  await page.getByRole('button', { name: /加入購物車/ }).click();

  await openCart(page);
  await expect(page.getByText('先減再折測試活動')).toBeVisible();
  await expect(page.getByText('NT$ 3,224')).toBeVisible();
});

test('活動不受 active 欄位影響，只依排程時間顯示活動商品', async ({ page }) => {
  await mockEcladoApis(page, {
    promotions: [{
      ...activePromotion,
      name: '排程有效活動',
      active: false,
      start_at: '2020-01-01T00:00:00.000Z',
      end_at: '2099-12-31T23:59:59.000Z',
    }],
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await expect(page.getByText('限時優惠')).toBeVisible();
  await expect(page.getByText('NT$ 3,582')).toBeVisible();
});

test('庫存為 0 顯示預購，且一般商品仍可加入購物車下單', async ({ page }) => {
  await mockEcladoApis(page, {
    products: mockProducts.map(product => product.id === 2 ? { ...product, stock: 0 } : product),
    promotions: [],
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await expect(page.getByText(/預購商品/).first()).toBeVisible();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await openCart(page);
  await expect(page.getByText('胜肽修護精華液')).toBeVisible();
});

test('結帳建立付款單但不寫入真實訂單或真金流', async ({ page }) => {
  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await openCart(page);
  await page.getByRole('button', { name: /前往結帳/ }).click();

  const checkoutInputs = page.locator('form input');
  await checkoutInputs.nth(0).fill('E2E 測試');
  await checkoutInputs.nth(1).fill('0912345678');
  await checkoutInputs.nth(2).fill('e2e@example.com');
  await page.getByPlaceholder('縣市').fill('台北市');
  await page.getByPlaceholder('區域').fill('大安區');
  await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('測試路 1 號');
  await page.getByRole('button', { name: /繼續確認付款/ }).click();

  await expect(page.getByText('付款方式')).toBeVisible();
  await page.getByRole('button', { name: /虛擬帳號匯款/ }).click();
  await page.getByRole('button', { name: /建立付款單/ }).click();

  await expect(page.getByText('付款單已建立')).toBeVisible();
  await expect(page.getByText('807 永豐銀行')).toBeVisible();
  await expect(page.getByText('8071234567890123')).toBeVisible();
});

test('登入會員結帳會寫入訂單 payload 與 user_id，付款前不扣庫存', async ({ page }) => {
  let capturedOrder: Record<string, unknown> | null = null;

  await mockEcladoApis(page, {
    authUser: authUser('buyer@example.com'),
    profiles: [profile('consumer', 'buyer@example.com')],
    onOrderInsert: order => { capturedOrder = order; },
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await openCart(page);
  await page.getByRole('button', { name: /前往結帳/ }).click();

  const checkoutInputs = page.locator('form input');
  await checkoutInputs.nth(0).fill('登入買家');
  await checkoutInputs.nth(1).fill('0911111111');
  await checkoutInputs.nth(2).fill('buyer@example.com');
  await page.getByPlaceholder('縣市').fill('台北市');
  await page.getByPlaceholder('區域').fill('信義區');
  await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('測試路 99 號');
  await page.getByRole('button', { name: /繼續確認付款/ }).click();
  await page.getByRole('button', { name: /虛擬帳號匯款/ }).click();
  await page.getByRole('button', { name: /建立付款單/ }).click();

  await expect(page.getByText('付款單已建立')).toBeVisible();
  expect(capturedOrder).not.toBeNull();
  expect(capturedOrder?.user_id).toBe(TEST_USER_ID);
  expect(capturedOrder?.email).toBe('buyer@example.com');
  expect(capturedOrder?.phone).toBe('0911111111');
  expect(capturedOrder?.address).toContain('台北市');
  expect(capturedOrder?.status).toBe('awaiting_confirm');
  expect(capturedOrder?.total).toBe(3702);
  expect(capturedOrder?.promotion_name).toBe(activePromotion.name);
  const items = capturedOrder?.items as Array<Record<string, unknown>>;
  expect(items[0].stock_at_order).toBe(2);
});

test('信用卡、Apple Pay、Google Pay 會送出對應金流 payType', async ({ page }) => {
  const paymentRequests: Record<string, unknown>[] = [];
  await mockEcladoApis(page, {
    onPaymentRequest: request => paymentRequests.push(request),
  });

  for (const method of [
    { button: /信用卡/, payType: 'C' },
    { button: /Apple Pay/, payType: 'M' },
    { button: /Google Pay/, payType: 'M' },
  ]) {
    await page.goto('/shop');
    await page.getByText('胜肽修護精華液').first().click();
    await page.getByRole('button', { name: /加入購物車/ }).click();
    await openCart(page);
    await page.getByRole('button', { name: /前往結帳/ }).click();

    const checkoutInputs = page.locator('form input');
    await checkoutInputs.nth(0).fill('付款測試');
    await checkoutInputs.nth(1).fill('0912345678');
    await checkoutInputs.nth(2).fill('pay@example.com');
    await page.getByPlaceholder('縣市').fill('台北市');
    await page.getByPlaceholder('區域').fill('大安區');
    await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('支付路 1 號');
    await page.getByRole('button', { name: /繼續確認付款/ }).click();
    await page.getByRole('button', { name: method.button }).click();
    await page.getByRole('button', { name: /建立付款單/ }).click();

    await expect(page.getByText('付款單已建立')).toBeVisible();
    expect(paymentRequests.at(-1)?.payType).toBe(method.payType);
  }
});

test('購物車只存在瀏覽器記憶體，重新整理會清空', async ({ page }) => {
  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await openCart(page);
  await expect(page.getByText('胜肽修護精華液')).toBeVisible();

  await page.reload();
  await expect(page.getByText('購物車是空的')).toBeVisible();
});

test('會員專區顯示自己的訂單與托運單號', async ({ page }) => {
  await mockEcladoApis(page, {
    authUser: authUser('member@example.com'),
    profiles: [profile('consumer')],
    orders: [
      {
        id: 'ACCOUNT-ORDER-001',
        user_id: TEST_USER_ID,
        member: 'E2E 會員',
        items: [{ name: '胜肽修護精華液', qty: 1, price: 3980 }],
        total: 3980,
        status: 'shipped',
        date: '2026-05-21',
        address: '台北市測試路 1 號',
        tracking: 'SF123456789',
        promotion_name: null,
        created_at: '2026-05-21T00:00:00.000Z',
      },
    ],
  });

  await page.goto('/account');
  await expect(page.getByText('您好，E2E 會員')).toBeVisible();
  await expect(page.getByText('ACCOUNT-ORDER-001')).toBeVisible();
  await expect(page.getByText('已出貨')).toBeVisible();
  await expect(page.getByText('物流編號：SF123456789')).toBeVisible();
});

test('手機版主要購物流程可使用', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile project only');

  await page.goto('/');
  await page.locator('.nav-hamburger').getByRole('button').last().click();
  await expect(page.getByRole('button', { name: '所有產品' })).toBeVisible();
  await page.getByRole('button', { name: '所有產品' }).click();
  await expect(page.getByText('胜肽修護精華液').first()).toBeVisible();
});

test('手機版購物到結帳建立付款單可完成', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile project only');

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await openCart(page);
  await page.getByRole('button', { name: /前往結帳/ }).click();

  const checkoutInputs = page.locator('form input');
  await checkoutInputs.nth(0).fill('Mobile E2E');
  await checkoutInputs.nth(1).fill('0999999999');
  await checkoutInputs.nth(2).fill('mobile@example.com');
  await page.getByPlaceholder('縣市').fill('台北市');
  await page.getByPlaceholder('區域').fill('中山區');
  await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('手機路 1 號');
  await page.getByRole('button', { name: /繼續確認付款/ }).click();
  await page.getByRole('button', { name: /虛擬帳號匯款/ }).click();
  await page.getByRole('button', { name: /建立付款單/ }).click();

  await expect(page.getByText('付款單已建立')).toBeVisible();
  await expect(page.getByText('8071234567890123')).toBeVisible();
});
