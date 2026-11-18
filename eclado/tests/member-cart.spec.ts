import { expect, test, type Page } from '@playwright/test';
import { mockEcladoApis, type MockAuthUser } from './support/eclado-mocks';
import { applyCartOperation } from '../src/services/memberCart.js';

const uid = 'member-cart-a';
const user = (id = uid): MockAuthUser => ({ id, email: `${id}@example.com`,
  user_metadata: { name: id }, app_metadata: { provider: 'email' },
  aud: 'authenticated', role: 'authenticated', created_at: '2026-05-01T00:00:00Z' });
const profile = (id = uid) => ({ id, role: 'consumer', name: id, email: `${id}@example.com` });
const item = (id: number, qty = 1) => ({ id, variantId: '', qty });

function backend(initial = [item(2, 2)]) {
  const carts = new Map([[uid, initial]]);
  const seen = new Set();
  let offline = false;
  return { carts, set offline(value: boolean) { offline = value; },
    async attach(page: Page) {
      await page.route('**/rest/v1/rpc/sync_my_cart', async route => {
        if (offline) return route.abort('internetdisconnected');
        const body = route.request().postDataJSON();
        if (body.p_operation_id && !seen.has(body.p_operation_id)) {
          carts.set(body.p_member_id, applyCartOperation(carts.get(body.p_member_id) || [], {
            mode: body.p_mode, items: body.p_items,
          }));
          seen.add(body.p_operation_id);
        }
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: carts.get(body.p_member_id) || [] }) });
      });
    } };
}
async function setup(page: Page, api: ReturnType<typeof backend>, options = {}) {
  await page.addInitScript(id => localStorage.setItem(`eclado_pro_banner_${id}`, '1'), uid);
  await mockEcladoApis(page, { authUser: user(), profiles: [profile()], promotions: [], ...options });
  await api.attach(page);
}

test('登入合併訪客購物車、更新數量、移除並在全新裝置恢復', async ({ page, browser }) => {
  const api = backend();
  await setup(page, api);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('cart-seeded')) {
      localStorage.setItem('eclado_cart_v1', JSON.stringify([{ id: 1, qty: 1 }, { id: 2, qty: 1 }]));
      sessionStorage.setItem('cart-seeded', '1');
    }
  });
  await page.goto('/cart');
  await expect(page.getByTestId('cart-item-name')).toHaveCount(2);
  await expect.poll(() => api.carts.get(uid)?.map(i => [i.id, i.qty]).sort()).toEqual([[1, 1], [2, 2]]);
  expect(await page.evaluate(() => localStorage.getItem('eclado_cart_v1'))).toBeNull();
  await page.getByRole('button', { name: '+', exact: true }).first().click();
  await expect.poll(() => api.carts.get(uid)?.find(i => i.id === 2)?.qty).toBe(3);
  await page.getByRole('button', { name: /移除/ }).last().click();
  await expect.poll(() => api.carts.get(uid)).toEqual([item(2, 3)]);
  const context = await browser.newContext();
  try {
    const second = await context.newPage();
    await setup(second, api);
    await second.goto(new URL('/cart', page.url()).href);
    await expect(second.getByTestId('cart-item-name')).toHaveText('胜肽修護精華液');
    await expect(second.getByText('NT$ 11,940', { exact: true }).first()).toBeVisible();
    await second.reload();
    await expect(second.getByTestId('cart-item-name')).toHaveCount(1);
    expect(api.carts.get(uid)).toEqual([item(2, 3)]);
  } finally { await context.close(); }
});

test('離線修改重新整理後保留，恢復連線同步；登出與切換帳號不帶入商品', async ({ page }) => {
  const api = backend([item(2)]);
  await setup(page, api, { signInUser: user('member-cart-b'), profiles: [profile(), profile('member-cart-b')] });
  await page.goto('/cart');
  await expect(page.getByTestId('cart-item-name')).toBeVisible();
  api.offline = true;
  await page.getByRole('button', { name: '+', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '購物車尚未同步' })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('cart-item-name')).toHaveText('胜肽修護精華液');
  await expect(page.getByText('NT$ 7,960', { exact: true }).first()).toBeVisible();
  api.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => api.carts.get(uid)).toEqual([item(2, 2)]);
  await page.evaluate(async () => { await (window as any).supabase.auth.signOut(); });
  await expect(page.getByText('購物車還沒有商品')).toBeVisible();
  await page.evaluate(async () => {
    await (window as any).supabase.auth.signInWithPassword({ email: 'member-cart-b@example.com', password: 'mock-password' });
  });
  await expect(page.locator('nav').getByRole('button', { name: '會員專區' })).toBeVisible();
  await expect(page.getByText('購物車還沒有商品')).toBeVisible();
  expect(api.carts.get(uid)).toEqual([item(2, 2)]);
  expect(api.carts.get('member-cart-b') || []).toEqual([]);
});

test('背景同步另一裝置購物車時保留結帳表單與同一個輸入欄位', async ({ page }) => {
  const api = backend([item(2)]);
  await setup(page, api);
  await page.goto('/checkout');
  const name = page.getByRole('textbox', { name: /^收件人姓名/ });
  await expect(name).toBeVisible();
  await name.fill('尚未送出的姓名');
  await name.evaluate(input => input.setAttribute('data-instance', 'original'));
  api.carts.set(uid, [item(2, 2), item(1)]);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('深層清潔泡沫洗面乳', { exact: true }).first()).toBeVisible();
  await expect(name).toHaveValue('尚未送出的姓名');
  await expect(name).toHaveAttribute('data-instance', 'original');
});

test('會員結帳完成後同步移除已購品項並保留付款期間新加入的商品', async ({ page }) => {
  const api = backend([item(2)]);
  await setup(page, api);
  let releasePayment!: () => void;
  const paymentGate = new Promise<void>(resolve => { releasePayment = resolve; });
  await page.route('**/api/sinopac/create-payment', async route => {
    await paymentGate;
    await route.fallback();
  });
  await page.goto('/checkout');
  await page.locator('#checkout-name').fill('購物車測試');
  await page.locator('#checkout-phone').fill('0912345678');
  await page.getByPlaceholder('縣市').fill('台北市');
  await page.getByPlaceholder('區域').fill('大安區');
  await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('測試路 1 號');
  await page.getByRole('button', { name: /繼續確認付款/ }).click();
  await page.getByRole('button', { name: /虛擬帳號匯款/ }).click();
  const payment = page.waitForRequest('**/api/sinopac/create-payment');
  await page.getByRole('button', { name: /確認訂單/ }).click();
  await payment;
  api.carts.set(uid, [item(2), item(1)]);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect.poll(() => page.evaluate(id => JSON.parse(
    localStorage.getItem(`eclado_member_cart_v1:${id}:cache`) || '{"items":[]}'
  ).items.map((row: any) => row.id), uid)).toEqual([2, 1]);
  // This later quantity update is deliberately not refreshed into this tab.
  api.carts.set(uid, [item(2, 3), item(1)]);
  releasePayment();
  await expect(page.getByRole('heading', { name: '請完成付款' })).toBeVisible();
  await expect.poll(() => api.carts.get(uid)).toEqual([item(2, 2), item(1)]);
  await page.goto('/cart');
  await expect(page.getByTestId('cart-item-name')).toHaveText(['胜肽修護精華液', '深層清潔泡沫洗面乳']);
});

test('後端購物車還原數字規格 ID 並使用最新規格價格', async ({ page }) => {
  const api = backend([{ ...item(2), variantId: '202' }]);
  await setup(page, api, { productVariants: [
    { id: 201, product_id: 2, size: '30ml', price: 3980, pro_price: 2980, stock: 2, is_default: true, active: true },
    { id: 202, product_id: 2, size: '60ml', price: 6880, pro_price: 5200, stock: 4, active: true },
  ] });
  await page.goto('/cart');
  await expect(page.getByTestId('cart-item-specification')).toHaveText('60ml');
  await expect(page.getByText('NT$ 6,880', { exact: true }).first()).toBeVisible();
});

test('同一會員的兩個分頁可同步新增與移除', async ({ page, context }) => {
  const api = backend([item(2)]);
  await setup(page, api);
  await page.goto('/cart');
  await expect(page.getByTestId('cart-item-name')).toHaveCount(1);
  const second = await context.newPage();
  await setup(second, api);
  await second.goto(new URL('/cart', page.url()).href);
  await expect(second.getByTestId('cart-item-name')).toHaveCount(1);
  await second.getByRole('button', { name: '+', exact: true }).click();
  await expect.poll(() => api.carts.get(uid)).toEqual([item(2, 2)]);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('NT$ 7,960', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /移除/ }).click();
  await expect.poll(() => api.carts.get(uid)).toEqual([]);
  await second.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(second.getByText('購物車還沒有商品')).toBeVisible();
});

test('購物車頁可由導覽列收合，側欄從視窗頂端覆蓋導覽列', async ({ page }) => {
  const api = backend([item(2)]);
  await setup(page, api);
  await page.goto('/cart');
  await expect(page.getByTestId('cart-item-name')).toBeVisible();
  const navCart = page.locator('nav').getByRole('button', { name:'購物車', exact:true });
  await expect(navCart).toHaveAttribute('aria-expanded','true');
  await navCart.click();
  await expect(page).toHaveURL(/\/shop$/);
  await expect(navCart).toHaveAttribute('aria-expanded','false');
  await navCart.click();
  const drawer = page.getByRole('dialog', { name:'購物車' });
  await expect(drawer).toBeVisible();
  await expect(navCart).toHaveAttribute('aria-expanded','true');
  await expect(drawer).toHaveCSS('top','0px');
  const drawerBox = await drawer.boundingBox();
  expect(drawerBox?.y).toBe(0);
  await expect(drawer).toHaveAttribute('aria-modal','true');
  await drawer.getByRole('button',{name:'關閉購物車',exact:true}).click();
  await expect(drawer).toHaveCount(0);
  await expect(navCart).toHaveAttribute('aria-expanded','false');
  await page.goto('/cart');
  await expect(page.getByRole('button',{name:'← 繼續購物',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'關閉購物車',exact:true}).click();
  await expect(page).toHaveURL(/\/shop$/);
  expect(api.carts.get(uid)).toEqual([item(2)]);
});

test('提醒連結未登入時可登入並還原會員購物車', async ({ page }) => {
  const api = backend([item(2)]);
  await mockEcladoApis(page,{signInUser:user(),profiles:[profile()],promotions:[]});
  await api.attach(page);
  await page.goto('/cart');
  await page.getByRole('button',{name:'登入並還原購物車'}).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.locator('form input[type="email"]').fill('member-cart-a@example.com');
  await page.locator('form input[type="password"]').fill('mock-password');
  await page.locator('form').getByRole('button',{name:'登入',exact:true}).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByTestId('cart-item-name')).toHaveText('胜肽修護精華液');
});

test('LINE 登入提醒連結後回到會員購物車',async({page})=>{
  const api=backend([item(2)]);
  await setup(page,api);
  await page.addInitScript(()=>{
    sessionStorage.setItem('eclado_checkout_login_redirect','cart');
    sessionStorage.setItem('eclado_line_login_pending','1');
  });
  await page.goto('/line-callback#access_token=mock-access-token&refresh_token=mock-refresh-token&expires_in=3600&token_type=bearer&type=magiclink');
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByTestId('cart-item-name')).toHaveText('胜肽修護精華液');
});

test('購物車側欄遇到導覽或瀏覽器返回會收合並恢復頁面捲動',async({page})=>{
  const api=backend([item(2)]);
  await setup(page,api);
  await page.goto('/cart');
  await expect(page.getByRole('button',{name:'← 繼續購物',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'關閉購物車',exact:true}).click();
  const navCart=page.locator('nav').getByRole('button',{name:'購物車',exact:true});
  await navCart.click();
  await expect(page.getByRole('dialog',{name:'購物車'})).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByRole('dialog',{name:'購物車'})).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveCSS('overflow','hidden');
  await navCart.click();
  await navCart.click();
  await expect(page.getByRole('dialog',{name:'購物車'})).toBeVisible();
  await page.getByRole('dialog',{name:'購物車'}).getByRole('button',{name:'關閉購物車',exact:true}).click();
  await page.locator('nav').getByRole('link',{name:'ECLADO Laboratory'}).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('dialog',{name:'購物車'})).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveCSS('overflow','hidden');
});
