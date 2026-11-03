import { expect, test } from '@playwright/test';
import { mockEcladoApis, mockProducts } from './support/eclado-mocks';

for (const stock of [0, 5]) {
  test(`供貨顯示關閉：庫存 ${stock} 隱藏詳情及購物車，結帳只留必要提醒`, async ({ page }) => {
    await mockEcladoApis(page, {
      showFulfillment:false,
      products:mockProducts.map(product => product.id === 2 ? {...product, stock} : product),
      promotions:[],
    });
    await page.goto('/products/peptide-repair-serum');
    await expect(page.getByRole('heading', {name:'胜肽修護精華液'})).toBeVisible();
    await expect(page.getByTestId('product-fulfillment')).toHaveCount(0);
    await page.getByRole('button', {name:/加入購物車/}).click();
    await page.locator('nav').getByRole('button', {name:/^購物車/}).click();
    const drawer = page.getByRole('dialog', {name:'購物車'});
    await expect(drawer.getByTestId('cart-item-name')).toBeVisible();
    await expect(drawer.getByTestId('cart-item-fulfillment')).toHaveCount(0);
    await page.goto('/cart');
    await expect(page.getByTestId('cart-item-name')).toBeVisible();
    await expect(page.getByTestId('cart-item-fulfillment')).toHaveCount(0);
    await page.getByRole('button', {name:/前往結帳/}).click();
    const guest = page.getByRole('button', {name:/訪客結帳/});
    if (await guest.isVisible({timeout:1000}).catch(() => false)) await guest.click();
    const summary = page.getByTestId('checkout-order-summary');
    await expect(summary).toBeVisible();
    await expect(summary.getByText(/現貨商品|預購商品/)).toHaveCount(0);
    await expect(summary.getByTestId('checkout-shipping-notice')).toHaveCount(stock === 0 ? 1 : 0);
    if (stock === 0) await expect(summary.getByTestId('checkout-shipping-notice')).toContainText('7–14 個工作天');
  });
}

test('供貨顯示設定可在重新取得焦點時開關', async ({ page }) => {
  await mockEcladoApis(page);
  let enabled = false;
  await page.route('**/rest/v1/storefront_display_settings**', route => route.fulfill({json:{show_fulfillment:enabled}}));
  await page.goto('/products/peptide-repair-serum');
  await expect(page.getByRole('heading', {name:'胜肽修護精華液'})).toBeVisible();
  await expect(page.getByTestId('product-fulfillment')).toHaveCount(0);
  enabled = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('product-fulfillment')).toContainText('現貨商品');
  await page.getByRole('button', {name:/加入購物車/}).click();
  await page.goto('/cart');
  await expect(page.getByTestId('cart-item-fulfillment')).toContainText('現貨商品');
  enabled = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId('cart-item-fulfillment')).toHaveCount(0);
});

test('系統設定可儲存供貨顯示開關，重新整理後保留', async ({ page }) => {
  await mockEcladoApis(page, {
    authUser:{id:'display-admin', email:'admin@example.com', user_metadata:{name:'管理員'}, app_metadata:{provider:'email'}, aud:'authenticated', role:'authenticated', created_at:'2026-05-01T00:00:00.000Z'},
    adminAccess:true,
    backofficeAccess:{role:'admin', permissions:['member_pricing.manage']},
  });
  async function openSettings() {
    const menu = page.getByRole('button', {name:'開啟選單'});
    if ((page.viewportSize()?.width || 0) <= 900) await menu.click();
    await page.locator('.app-sidebar button:not(.sidebar-star)').filter({hasText:'系統設定'}).first().click();
  }
  await page.goto('/admin');
  await openSettings();
  const section = page.getByRole('form', {name:'前台商品顯示'});
  const toggle = section.getByRole('switch');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await section.getByRole('button', {name:'儲存顯示設定'}).click();
  await expect(section.getByRole('status')).toHaveText('前台商品顯示設定已儲存。');
  await page.reload();
  await openSettings();
  await expect(toggle).not.toBeChecked();
});
