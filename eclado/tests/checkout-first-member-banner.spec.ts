import { expect, test, type Page } from '@playwright/test';
import { mockEcladoApis } from './support/eclado-mocks';

const memberId = 'r23-first-member';
const seenKey = `eclado_pro_banner_${memberId}`;
const invitation = (page: Page) => page.getByText('您是美容師嗎？申請專業會員享有院線商品與專業折扣。', { exact: true });

async function setup(page: Page) {
  await page.context().route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort('blockedbyclient'));
  const orders: any[] = [], payments: any[] = [];
  await mockEcladoApis(page, {
    authUser: { id: memberId, email: 'first-member@example.test', user_metadata: { name: '首次會員' },
      app_metadata: { provider: 'email' }, aud: 'authenticated', role: 'authenticated', created_at: '2026-05-01' },
    profiles: [{ id: memberId, email: 'first-member@example.test', name: '首次會員', role: 'consumer' }],
    memberCartItems: [{ id: 2, variantId: '', qty: 1 }],
    promotions: [],
    shoppingCreditByMember: { [memberId]: { available_balance: 1000, entries: [] } },
    onOrderPricingRequest: request => orders.push(request),
    onPaymentRequest: request => payments.push(request),
  });
  return { orders, payments };
}

for (const scenario of ['公司發票', '購物金'] as const) {
  test(`首次會員${scenario}結帳不被申請橫幅遮擋，背景刷新保留表單且只建一單`, async ({ page }) => {
    const api = await setup(page);
    await page.goto('/shop');
    // Prove eligibility and an unseen invitation rather than pre-dismissing it.
    await expect(invitation(page)).toBeVisible();
    expect(await page.evaluate(key => localStorage.getItem(key), seenKey)).toBeNull();
    await page.locator('nav').getByRole('button', { name: /^購物車/ }).click();
    await page.getByRole('dialog', { name: '購物車' }).getByRole('button', { name: '前往結帳', exact: true }).click();
    await expect(page).toHaveURL(/\/checkout$/);
    await expect(invitation(page)).toHaveCount(0);

    const name = page.locator('#checkout-name');
    await name.fill('首次會員收件人');
    await name.evaluate(input => input.setAttribute('data-r23-instance', 'original'));
    const refresh = page.waitForResponse('**/rest/v1/professional_applications**');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await refresh;
    await expect(name).toHaveValue('首次會員收件人');
    await expect(name).toHaveAttribute('data-r23-instance', 'original');
    await expect(invitation(page)).toHaveCount(0);

    await page.locator('#checkout-phone').fill('0912345678');
    await page.locator('#checkout-email').fill('first-member@example.test');
    await page.getByPlaceholder('縣市').fill('台北市');
    await page.getByPlaceholder('區域').fill('大安區');
    await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('回歸測試路1號');
    if (scenario === '公司發票') {
      await page.getByRole('button', { name: '公司', exact: true }).click();
      await page.getByLabel('公司抬頭').fill('首次會員測試公司');
      await page.getByLabel('統一編號').fill('87654321');
    }
    await page.getByRole('button', { name: '繼續確認付款', exact: true }).click();
    await expect(invitation(page)).toHaveCount(0);
    if (scenario === '購物金') {
      await page.getByRole('switch', { name: '使用購物金', exact: true }).click();
      await page.getByLabel('購物金使用金額').fill('500');
    }
    await page.getByRole('button', { name: /^信用卡/ }).click();
    // A normal click must succeed; force clicks would hide the original bug.
    await page.getByRole('button', { name: '確認訂單', exact: true }).click();
    await expect(page.getByRole('heading', { name: '請完成付款' })).toBeVisible();
    await expect(invitation(page)).toHaveCount(0);
    expect(api.orders).toHaveLength(1);
    expect(api.payments).toHaveLength(1);
    expect(api.orders[0]).toMatchObject(scenario === '公司發票'
      ? { p_invoice_type: 'company', p_invoice_company_name: '首次會員測試公司', p_invoice_tax_id: '87654321' }
      : { p_shopping_credit_amount: 500 });
    expect(api.payments[0].amount).toBe(scenario === '公司發票' ? 4100 : 3600);
    expect(await page.evaluate(key => localStorage.getItem(key), seenKey)).toBeNull();
  });
}

test('直接載入與重新整理結帳時，延遲的首次會員邀請不插入頁面，離開後仍可申請', async ({ page }) => {
  await setup(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/rest/v1/professional_applications**', async route => {
    await gate;
    await route.fallback();
  });
  try {
    const eligibility = page.waitForResponse('**/rest/v1/professional_applications**');
    await page.goto('/checkout');
    await expect(page.locator('#checkout-name')).toBeVisible();
    await page.locator('#checkout-name').fill('延遲查詢保留姓名');
    release();
    await eligibility;
    await expect(invitation(page)).toHaveCount(0);
    await expect(page.locator('#checkout-name')).toHaveValue('延遲查詢保留姓名');

    await page.locator('nav').getByRole('link', { name: 'ECLADO Laboratory', exact: true }).click();
    await expect(invitation(page)).toBeVisible();
    expect(await page.evaluate(key => localStorage.getItem(key), seenKey)).toBeNull();
    await page.goBack();
    await expect(page.locator('#checkout-name')).toBeVisible();
    await expect(invitation(page)).toHaveCount(0);
    const refreshedEligibility = page.waitForResponse('**/rest/v1/professional_applications**');
    await page.reload();
    await refreshedEligibility;
    await expect(page.locator('#checkout-name')).toBeVisible();
    await expect(invitation(page)).toHaveCount(0);
    expect(await page.evaluate(key => localStorage.getItem(key), seenKey)).toBeNull();
  } finally {
    release();
  }
});
