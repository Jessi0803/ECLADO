import { expect, test } from '@playwright/test';
import { mockEcladoApis } from './support/eclado-mocks';

test.beforeEach(async ({ page }) => {
  await mockEcladoApis(page);
});

async function openCart(page: import('@playwright/test').Page) {
  await page.locator('nav').getByRole('button', { name: /^購物車/ }).click();
}

test('主要路徑可開啟且不白屏', async ({ page }) => {
  for (const path of ['/', '/shop', '/cart', '/checkout', '/login', '/professional-apply', '/about', '/info', '/privacy', '/contact', '/admin']) {
    await page.goto(path);
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

test('購物車只存在瀏覽器記憶體，重新整理會清空', async ({ page }) => {
  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await openCart(page);
  await expect(page.getByText('胜肽修護精華液')).toBeVisible();

  await page.reload();
  await expect(page.getByText('購物車是空的')).toBeVisible();
});

test('手機版主要購物流程可使用', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile project only');

  await page.goto('/');
  await page.locator('.nav-hamburger').getByRole('button').last().click();
  await expect(page.getByRole('button', { name: '所有產品' })).toBeVisible();
  await page.getByRole('button', { name: '所有產品' }).click();
  await expect(page.getByText('胜肽修護精華液').first()).toBeVisible();
});
