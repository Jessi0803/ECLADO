import { expect, test } from '@playwright/test';
import {
  activePromotion,
  adminApplicationRows,
  adminOrderRows,
  adminProductRows,
  adminProfileRows,
  mockEcladoApis,
  mockProducts,
  type MockAuthUser,
} from './support/eclado-mocks';

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
  const drawer = page.getByRole('dialog', { name: '購物車' });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function proceedToCheckout(page: import('@playwright/test').Page) {
  const drawer = page.getByRole('dialog', { name: '購物車' });
  const scope = await drawer.isVisible().catch(() => false) ? drawer : page;
  await scope.getByRole('button', { name: /前往結帳/ }).click();
  const guestCheckout = page.getByRole('button', { name: /訪客結帳/ });
  if (await guestCheckout.isVisible({ timeout: 1000 }).catch(() => false)) {
    await guestCheckout.click();
  }
}

async function createCheckoutPayment(
  page: import('@playwright/test').Page,
  methodName: RegExp,
) {
  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await openCart(page);
  await proceedToCheckout(page);

  const checkoutInputs = page.locator('form input');
  await checkoutInputs.nth(0).fill('付款恢復測試');
  await checkoutInputs.nth(1).fill('0912345678');
  await checkoutInputs.nth(2).fill('restore@example.com');
  await page.getByPlaceholder('縣市').fill('台北市');
  await page.getByPlaceholder('區域').fill('大安區');
  await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('恢復路 1 號');
  await page.getByRole('button', { name: /繼續確認付款/ }).click();
  await page.getByRole('button', { name: methodName }).click();
  await page.getByRole('button', { name: /^建立付款單$/ }).click();
  await expect(page.getByRole('heading', { name: '付款單已建立' })).toBeVisible();
}

async function openAdminCatalog(page: import('@playwright/test').Page) {
  await page.goto('/admin');
  const openMenu = page.getByRole('button', { name: '開啟選單' });
  if ((page.viewportSize()?.width || 0) <= 900) {
    await expect(openMenu).toBeVisible();
    await openMenu.click();
    await expect(page.locator('.app-sidebar')).toHaveClass(/\bopen\b/);
  }
  await page.getByRole('button', { name: /商品 & 庫存/ }).click();
}

async function triggerProductsRealtime(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const client = (window as any).supabase;
    const channel = client.getChannels().find((candidate: any) => candidate.topic === 'realtime:products-realtime');
    const callback = channel?.bindings?.postgres_changes?.[0]?.callback;
    if (!callback) throw new Error('products realtime callback not found');
    return callback({});
  });
}

test('主要路徑可開啟且不白屏', async ({ page }) => {
  test.slow();
  for (const path of ['/', '/shop', '/products/peptide-repair-serum', '/journal', '/journal/peptide-hyaluronic-centella-order', '/cart', '/checkout', '/login', '/order-lookup', '/professional-apply', '/about', '/info', '/privacy', '/contact', '/admin']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    const body = page.locator('body');
    await expect(body).toBeVisible();
    await expect(body).not.toBeEmpty();
  }
});

test('LINE 內建瀏覽器只對固定導覽列啟用合成層穩定處理', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Line/15.12.0',
    });
  });
  await page.goto('/?browser-debug=1');

  await expect(page.locator('html')).toHaveClass(/is-line-browser/);
  await expect(page.locator('nav.site-nav')).toHaveCSS('will-change', 'transform');
  await expect(page.locator('nav.site-nav')).not.toHaveCSS('transform', 'none');
  await expect(page.getByTestId('browser-debug-panel')).toContainText('LINE UA：true');
  await expect(page.getByTestId('browser-debug-panel')).toContainText('LINE class：true');
  const initialHeroHeight = await page.evaluate(() => (
    document.documentElement.style.getPropertyValue('--line-home-hero-height')
  ));
  expect(initialHeroHeight).toMatch(/^\d+px$/);
  await expect(page.getByTestId('browser-debug-panel')).toContainText(`LINE 固定 Hero：${initialHeroHeight}`);

  await page.setViewportSize({ width:390, height:700 });
  const resizedHeroHeight = await page.evaluate(() => (
    document.documentElement.style.getPropertyValue('--line-home-hero-height')
  ));
  expect(resizedHeroHeight).toBe(initialHeroHeight);
  await expect(page.locator('.home-hero')).toHaveCSS('height', initialHeroHeight);
});

test('首頁依指定順序呈現熱門商品、品牌理念、三大系列與六篇專欄', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('browser-debug-panel')).toHaveCount(0);

  const headings = await page.locator('h2').allTextContents();
  const popularIndex = headings.findIndex(text => text.includes('熱門商品'));
  const aboutIndex = headings.findIndex(text => text.includes('源自韓國醫美診所'));
  const memoryIndex = headings.findIndex(text => text.includes('記憶系列'));
  const essentialIndex = headings.findIndex(text => text.includes('精粹系列'));
  const acIndex = headings.findIndex(text => text.includes('AC 系列'));
  const journalIndex = headings.findIndex(text => text.includes('保養專欄'));

  expect(popularIndex).toBeGreaterThanOrEqual(0);
  expect(aboutIndex).toBeGreaterThan(popularIndex);
  expect(memoryIndex).toBeGreaterThan(aboutIndex);
  expect(essentialIndex).toBeGreaterThan(memoryIndex);
  expect(acIndex).toBeGreaterThan(essentialIndex);
  expect(journalIndex).toBeGreaterThan(acIndex);
  await expect(page.getByRole('heading', { name: '精選商品' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '四大系列' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '呼吸系列' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '瀏覽全部專欄 →' })).toBeVisible();
  await expect(page.getByText(/min read/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '上一組記憶系列商品' })).toHaveCount(0);

  await page.getByRole('button', { name: '瀏覽記憶系列商品' }).click();
  await expect(page).toHaveURL(/\/shop\?view=series&series=Cell$/);
});

test('首頁六篇專欄可進入完整文章、列表及上一篇下一篇且不顯示閱讀時間', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: /胜肽、玻尿酸、積雪草/ }).first().click();

  await expect(page).toHaveURL(/\/journal\/peptide-hyaluronic-centella-order$/);
  await expect(page.getByRole('heading', { level:1, name:'胜肽、玻尿酸、積雪草，修護型保養怎麼排先後？' })).toBeVisible();
  await expect(page).toHaveTitle(/胜肽、玻尿酸、積雪草.*ECLADO 保養專欄/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /胜肽、玻尿酸、積雪草怎麼搭/);
  await expect(page.getByText('修護，不是把所有成分一次疊上去')).toBeVisible();
  await expect(page.getByText('ECLADO 專業保養觀點')).toBeVisible();
  await expect(page.getByText(/min read|分鐘閱讀/i)).toHaveCount(0);

  await page.getByRole('button', { name:/下一篇/ }).click();
  await expect(page).toHaveURL(/\/journal\/sensitive-skin-routine$/);
  await expect(page.getByRole('heading', { level:1, name:/敏弱肌日常流程/ })).toBeVisible();

  await page.getByRole('button', { name:'← 返回保養專欄' }).click();
  await expect(page).toHaveURL(/\/journal$/);
  await expect(page.getByRole('heading', { level:1, name:'保養專欄' })).toBeVisible();
  await expect(page.locator('.journal-list-grid > a')).toHaveCount(8);
  await expect(page.getByText(/min read|分鐘閱讀/i)).toHaveCount(0);
});

test('首頁頁尾訪客訂單查詢可進入查詢頁並返回首頁', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: '訪客訂單查詢' }).click();
  await expect(page).toHaveURL(/\/order-lookup$/);
  await expect(page.getByRole('heading', { name: '訪客訂單查詢' })).toBeVisible();
  await page.getByRole('button', { name: '返回' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('從登入頁進入訪客訂單查詢時返回登入頁', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: '訪客訂單查詢' }).click();
  await expect(page).toHaveURL(/\/order-lookup$/);
  await page.getByRole('button', { name: '返回' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('商品 API 尚未完成時不顯示內建 fallback 商品', async ({ page }) => {
  await mockEcladoApis(page, {
    productResponseDelayMs: 900,
    products: [{
      id: 101,
      name: 'Published Product',
      name_zh: '資料庫上架商品',
      category: '其他',
      size: '30ml',
      stock: 5,
      price: 1000,
      pro_price: 800,
      is_pro_only: false,
      active: true,
    }],
    promotions: [],
  });

  await page.goto('/shop');
  await expect(page.getByRole('status').filter({ hasText: '商品載入中…' })).toBeVisible();
  await expect(page.getByText('深層清潔泡沫洗面乳')).toHaveCount(0);
  await expect(page.getByText('金流測試商品')).toHaveCount(0);
  await expect(page.getByText('資料庫上架商品 · 30ml')).toBeVisible();
});

test('聯絡我們與隱私權由前台 SPA 路由呈現', async ({ page }) => {
  await page.goto('/contact');
  await expect(page).toHaveURL(/\/contact$/);
  await expect(page.getByRole('heading', { name: '聯絡我們' })).toBeVisible();

  await page.goto('/privacy');
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole('heading', { name: '隱私權政策' })).toBeVisible();
});

test('LINE 登入結帳回來後會回到結帳頁', async ({ page }) => {
  await mockEcladoApis(page, {
    authUser: authUser('line-checkout@example.com'),
    profiles: [profile('consumer', 'line-checkout@example.com')],
  });
  await page.addInitScript(() => {
    window.sessionStorage.setItem('eclado_checkout_login_redirect', 'checkout');
    window.sessionStorage.setItem('eclado_line_login_pending', '1');
  });

  await page.goto('/line-callback#access_token=mock-access-token&refresh_token=mock-refresh-token&expires_in=3600&token_type=bearer&type=magiclink');

  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByRole('heading', { name: '結帳' })).toBeVisible();
});

test('LINE magic link 即使遺失 pending sessionStorage 仍會回到首頁', async ({ page }) => {
  await mockEcladoApis(page, {
    authUser: authUser('line-home@example.com'),
    profiles: [profile('consumer', 'line-home@example.com')],
  });

  await page.goto('/login#access_token=mock-access-token&refresh_token=mock-refresh-token&expires_in=3600&token_type=bearer&type=magiclink');

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: '會員專區' })).toContainText('E2E 會員');
});

test('商城瀏覽、商品詳情、一般會員價格與院線商品限制', async ({ page }) => {
  await page.goto('/shop');
  await expect(page.getByText('胜肽修護精華液').first()).toBeVisible();
  await expect(page.getByText('NT$ 3,980').first()).toBeVisible();

  await page.getByText('NK細胞活化安瓶').first().click();
  await expect(page).toHaveURL(/\/products\/nk-cell-activator$/);
  await expect(page.getByText('院線專業商品')).toBeVisible();
  await expect(page.getByText('院線專業集中護理')).toBeVisible();
  await expect(page.getByText('私訊 LINE 官方詢問')).toBeVisible();
  await expect(page.getByRole('button', { name: /加入購物車/ })).toHaveCount(0);
});

test('商品具有可分享唯一路徑，重新整理與返回列表皆正常', async ({ page }) => {
  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await expect(page).toHaveURL(/\/products\/peptide-fixed-url$/);
  await expect(page.getByRole('heading', { name: '胜肽修護精華液' })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/products\/peptide-fixed-url$/);
  await expect(page.getByRole('heading', { name: '胜肽修護精華液' })).toBeVisible();

  await page.goto('/products/peptide-repair-serum');
  await expect(page).toHaveURL(/\/products\/peptide-fixed-url$/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://ecladotaiwan.com/products/peptide-fixed-url');

  await page.getByRole('button', { name: '返回商品列表' }).click();
  await expect(page).toHaveURL(/\/shop$/);

  await page.goto('/products/not-a-real-product');
  await expect(page.getByRole('heading', { name: '找不到此商品' })).toBeVisible();
});

test('商品新分類正確，院線商品不重複出現在一般分類', async ({ page }) => {
  await page.goto('/shop');

  await page.getByRole('button', { name: '安瓶精華', exact: true }).click();
  await expect(page.getByText('胜肽修護精華液').first()).toBeVisible();
  await expect(page.getByText('急救修護安瓶組').first()).toBeVisible();
  await expect(page.getByText('NK細胞活化安瓶').first()).toHaveCount(0);

  await page.getByRole('button', { name: '院線課程儀器（含試用包）', exact: true }).click();
  await expect(page.getByText('NK細胞活化安瓶').first()).toBeVisible();
  await expect(page.getByText('急救修護安瓶組').first()).toHaveCount(0);

  await page.getByRole('button', { name: '其他', exact: true }).click();
  await expect(page.getByText('此分類目前無商品')).toBeVisible();
});

test('手機分類橫向選單會自動捲入目前選取項目', async ({ page, isMobile }) => {
  test.skip(!isMobile, '僅驗證手機版橫向分類列');

  await page.goto(`/shop?category=${encodeURIComponent('院線課程儀器（含試用包）')}`);

  const tabs = page.locator('.filter-tabs');
  const selectedCategory = page.getByRole('button', {
    name: '院線課程儀器（含試用包）',
    exact: true,
  });

  await expect(selectedCategory).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => {
    const [tabsBox, selectedBox] = await Promise.all([
      tabs.boundingBox(),
      selectedCategory.boundingBox(),
    ]);
    if (!tabsBox || !selectedBox) return false;
    return selectedBox.x >= tabsBox.x - 1
      && selectedBox.x + selectedBox.width <= tabsBox.x + tabsBox.width + 1;
  }).toBe(true);
});

test('導覽列所有產品下拉分類會帶入商城分類並保留可分享網址', async ({ page, isMobile }) => {
  await page.goto('/');

  if (isMobile) {
    await page.locator('.nav-hamburger').getByRole('button').last().click();
    await page.getByRole('button', { name: '所有產品', exact: true }).click();
  } else {
    await page.getByRole('button', { name: '所有產品', exact: true }).hover();
  }

  await page.getByRole('button', { name: '安瓶精華', exact: true }).click();
  await expect(page).toHaveURL(/\/shop\?view=category&category=%E5%AE%89%E7%93%B6%E7%B2%BE%E8%8F%AF$/);
  await expect(page.getByRole('button', { name: '安瓶精華', exact: true }).last()).toHaveCSS('font-weight', '500');
  await expect(page.getByText('胜肽修護精華液').first()).toBeVisible();
  await expect(page.getByText('NK細胞活化安瓶').first()).toHaveCount(0);

  await page.reload();
  await expect(page.getByText('胜肽修護精華液').first()).toBeVisible();
  await expect(page.getByText('NK細胞活化安瓶').first()).toHaveCount(0);
});

test('商城可在功效分類與系列分類間切換並保留系列網址', async ({ page }) => {
  await page.goto('/shop?view=series&series=Cell');

  await expect(page.getByRole('button', { name: '依系列分類', exact: true }).last()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Cell', exact: true }).last()).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('胜肽修護精華液').first()).toBeVisible();
  await expect(page.getByText('深層清潔泡沫洗面乳').first()).toHaveCount(0);

  await page.reload();
  await expect(page.getByText('胜肽修護精華液').first()).toBeVisible();

  await page.getByRole('button', { name: '依功效分類', exact: true }).last().click();
  await expect(page).toHaveURL('/shop');
  await expect(page.getByText('深層清潔泡沫洗面乳').first()).toBeVisible();
});

test('後台以規格表格與交易式 RPC 儲存商品', async ({ page }) => {
  let savedRequest: Record<string, any> | null = null;
  const admin = authUser('ecladotaiwan@gmail.com');
  await mockEcladoApis(page, {
    authUser: admin,
    products: adminProductRows,
    productVariants: [
      {
        id: 201,
        product_id: 2,
        sku: 'SERUM-30',
        size: '30ml',
        price: 3980,
        pro_price: 2980,
        stock: 2,
        is_default: true,
        sort_order: 0,
        active: true,
      },
    ],
    orders: adminOrderRows,
    profiles: adminProfileRows,
    applications: adminApplicationRows,
    onProductWithVariantsSave: request => { savedRequest = request; },
  });

  await openAdminCatalog(page);
  await expect(page.getByText('批次圖片縮放', { exact: true })).toHaveCount(0);
  const productRow = page.getByRole('row').filter({ hasText: '胜肽修護精華液' });
  await productRow.getByRole('button', { name: '編輯' }).click();

  await expect(page.getByText('商品規格', { exact: true })).toBeVisible();
  await expect(page.getByText('商品列表圖片縮放', { exact: true })).toBeVisible();
  await expect(page.locator('#productSize')).toHaveCount(0);
  await expect(page.locator('#productPrice')).toHaveCount(0);
  await expect(page.locator('#productStock')).toHaveCount(0);
  await expect(page.locator('#productImage')).toHaveCount(0);
  await expect(page.locator('#productImageUrls')).toHaveCount(0);

  await page.getByRole('button', { name: '+ 新增規格' }).click();
  await page.getByLabel('規格 2 名稱').fill('100ml');
  await page.getByLabel('規格 2 SKU').fill('SERUM-100');
  await page.getByLabel('規格 2 市場價').fill('8800');
  await page.getByLabel('規格 2 專業價').fill('6600');
  await page.getByLabel('規格 2 庫存').fill('5');
  await page.getByLabel('規格 2 進貨 USD 單價').fill('12.34');
  await page.getByRole('button', { name: '儲存', exact: true }).click();

  await expect.poll(() => savedRequest).not.toBeNull();
  expect(savedRequest?.p_product?.id).toBe(2);
  expect(savedRequest?.p_product?.publication_status).toBe('active');
  expect(savedRequest?.p_product).not.toHaveProperty('image_url');
  expect(savedRequest?.p_product).not.toHaveProperty('image_urls');
  expect(savedRequest?.p_variants).toHaveLength(2);
  expect(savedRequest?.p_variants?.[1]).toMatchObject({
    sku: 'SERUM-100',
    size: '100ml',
    price: 8800,
    pro_price: 6600,
    stock: 5,
    is_default: false,
    sort_order: 1,
    active: true,
    procurement_unit_cost_usd: 12.34,
  });
  expect(savedRequest?.p_variants?.[0]?.procurement_unit_cost_usd).toBeNull();
});

test('後台新商品預設為草稿並提供三種發布狀態', async ({ page }) => {
  const admin = authUser('ecladotaiwan@gmail.com');
  await mockEcladoApis(page, {
    authUser: admin,
    products: adminProductRows,
    orders: adminOrderRows,
    profiles: adminProfileRows,
    applications: adminApplicationRows,
  });

  await openAdminCatalog(page);
  await expect(page.getByRole('button', { name: /^上架中/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^草稿/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^已下架/ })).toBeVisible();

  await page.getByRole('button', { name: '+ 新增商品' }).click();
  const status = page.locator('#productPublicationStatus');
  await expect(status).toHaveValue('draft');
  await expect(status.locator('option')).toHaveText([
    '草稿（前台不可見）',
    '正式上架',
    '已下架',
  ]);
  await expect(page.getByRole('button', { name: '建立草稿' })).toBeVisible();
});

test('後台可上傳多圖、指定首圖並以 RPC 儲存圖片順序', async ({ page }) => {
  let savedImagesRequest: Record<string, any> | null = null;
  let uploadedPath = '';
  const assetKey = '11111111-2222-4333-8444-555555555555';
  const admin = authUser('ecladotaiwan@gmail.com');
  await mockEcladoApis(page, {
    authUser: admin,
    products: adminProductRows.map(product => product.id === 2 ? { ...product, asset_key: assetKey } : product),
    productVariants: [
      { id: 201, product_id: 2, sku: 'SERUM-30', size: '30ml', price: 3980, pro_price: 2980, stock: 2, is_default: true, sort_order: 0, active: true },
    ],
    productImages: [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', product_id: 2, storage_path: `products/${assetKey}/hero.webp`, alt_text: '原首圖', sort_order: 0, is_primary: true, active: true },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', product_id: 2, storage_path: `products/${assetKey}/detail.webp`, alt_text: '原附圖', sort_order: 1, is_primary: false, active: true },
      { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', product_id: 2, storage_path: `products/${assetKey}/removed.webp`, alt_text: '已移除舊圖片', sort_order: 2, is_primary: false, active: false },
    ],
    orders: adminOrderRows,
    profiles: adminProfileRows,
    applications: adminApplicationRows,
    onProductImagesSave: request => { savedImagesRequest = request; },
    onProductImageUpload: path => { uploadedPath = path; },
  });

  await openAdminCatalog(page);
  const productRow = page.getByRole('row').filter({ hasText: '胜肽修護精華液' });
  await productRow.getByRole('button', { name: '編輯' }).click();

  await expect(page.getByText('首圖', { exact: true })).toBeVisible();
  await expect(page.getByAltText('已移除舊圖片')).toHaveCount(0);
  await page.locator('#productImageFiles').setInputFiles({
    name: 'new-detail.webp',
    mimeType: 'image/webp',
    buffer: Buffer.from('eclado-image-test'),
  });
  await expect(page.getByText('待上傳', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '設為首圖' }).nth(2).click();
  await page.getByRole('button', { name: '儲存', exact: true }).click();

  await expect.poll(() => uploadedPath).toContain(`products/${assetKey}/`);
  await expect.poll(() => savedImagesRequest).not.toBeNull();
  expect(savedImagesRequest?.p_product_id).toBe(2);
  expect(savedImagesRequest?.p_images).toHaveLength(3);
  expect(savedImagesRequest?.p_images.filter((image: any) => image.is_primary)).toHaveLength(1);
  expect(savedImagesRequest?.p_images[2]).toMatchObject({
    original_name: 'new-detail.webp',
    mime_type: 'image/webp',
    is_primary: true,
    active: true,
  });
});

for (const scenario of [
  { role: 'pro', noticeLabel: '美容師', label: '專業價', priceLabel: 'NT$ 2,980', proOnlyButton: true },
  { role: 'instructor', noticeLabel: '師資', label: '師資價・專業價7折', priceLabel: 'NT$ 2,086', proOnlyButton: true },
  { role: 'distributor', noticeLabel: '經銷商', label: '經銷價・專業價65折', priceLabel: 'NT$ 1,937', proOnlyButton: true },
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

    await page.goto('/info');
    await expect(page.getByRole('button', { name: '會員購物須知', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '會員購物須知', exact: true }).click();
    await expect(page.getByRole('heading', { name: `${scenario.noticeLabel}－購物規範` })).toBeVisible();
    await expect(page.getByText('單筆訂單折扣後商品小計滿 NT$15,000 享免運優惠。')).toBeVisible();
  });
}

test('一般會員不顯示會員購物須知', async ({ page }) => {
  await mockEcladoApis(page, {
    authUser: authUser('consumer@example.com'),
    profiles: [profile('consumer', 'consumer@example.com')],
  });

  await page.goto('/info');
  await expect(page.getByRole('button', { name: '會員購物須知', exact: true })).toHaveCount(0);
});

test('專業會員購物車即時提示最低訂購與免運門檻', async ({ page }) => {
  await mockEcladoApis(page, {
    authUser: authUser('pro@example.com'),
    profiles: [profile('pro', 'pro@example.com')],
    promotions: [],
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  const cartDrawer = await openCart(page);

  const professionalStatus = cartDrawer.getByRole('status');
  await expect(professionalStatus).toHaveText('尚差 NT$2,020 可達最低訂購門檻。');
  await expect(professionalStatus).toHaveCSS('border-left-width', '1px');
  await expect(professionalStatus).toHaveCSS('border-left-style', 'solid');
  await expect(cartDrawer.getByRole('button', { name: '前往結帳' })).toBeDisabled();

  const increaseQuantity = cartDrawer.getByRole('button', { name: '+' });
  await increaseQuantity.click();
  await expect(professionalStatus).toHaveText('再消費 NT$9,040 即享免運');
  await expect(professionalStatus).toHaveCSS('border-left-width', '4px');
  await expect(cartDrawer.getByText('NT$ 120', { exact: true })).toBeVisible();

  await increaseQuantity.click();
  await increaseQuantity.click();
  await increaseQuantity.click();
  await increaseQuantity.click();
  await expect(cartDrawer.getByRole('status')).toHaveText('✓ 已享免運優惠。');
  await expect(cartDrawer.getByText('免運', { exact: true })).toBeVisible();
  await expect(cartDrawer.getByRole('button', { name: '前往結帳' })).toBeEnabled();
});

test('DB 的 is_pro_only=true 會讓原本公開商品變院線限定', async ({ page }) => {
  // 模擬 DB 回傳 is_pro_only: true，前端應依權威商品資料限制非專業會員。
  await mockEcladoApis(page, {
    products: mockProducts.map(p => p.id === 2 ? { ...p, is_pro_only: true } : p),
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await expect(page.getByText('院線專業商品')).toBeVisible();
  const descriptionTop = await page.getByText('商品描述', { exact: true }).evaluate(element => element.getBoundingClientRect().top);
  const featureTop = await page.getByText('商品特色', { exact: true }).evaluate(element => element.getBoundingClientRect().top);
  expect(descriptionTop).toBeLessThan(featureTop);
  await expect(page.getByText('多重胜肽複合修護')).toBeVisible();
  await expect(page.getByRole('button', { name: /加入購物車/ })).toHaveCount(0);
});

test('DB 的 price 覆蓋寫死的售價', async ({ page }) => {
  // 商品價格完全依 DB 回傳值顯示。
  await mockEcladoApis(page, {
    products: mockProducts.map(p => p.id === 2 ? { ...p, price: 2999 } : p),
    promotions: [],
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await expect(page.getByText('NT$ 2,999').first()).toBeVisible();
});

test('Storage 商品圖片優先於舊欄位，並套用首圖、排序與停用規則', async ({ page }) => {
  await mockEcladoApis(page, {
    productImages: [
      {
        id: 'image-secondary',
        product_id: 2,
        storage_path: 'products/asset-2/detail.webp',
        alt_text: '胜肽修護精華液細節圖',
        sort_order: 0,
        is_primary: false,
        active: true,
      },
      {
        id: 'image-primary',
        product_id: 2,
        storage_path: 'products/asset-2/hero.webp',
        alt_text: '胜肽修護精華液主圖',
        sort_order: 1,
        is_primary: true,
        active: true,
      },
      {
        id: 'image-inactive',
        product_id: 2,
        storage_path: 'products/asset-2/inactive.webp',
        alt_text: '停用圖片',
        sort_order: 2,
        is_primary: false,
        active: false,
      },
    ],
    promotions: [],
  });

  await page.goto('/shop');
  const cardImage = page.getByAltText('胜肽修護精華液').first();
  await expect(cardImage).toHaveAttribute(
    'src',
    /\/storage\/v1\/object\/public\/product-images\/products\/asset-2\/hero\.webp$/,
  );

  await page.getByText('胜肽修護精華液').first().click();
  await expect(page.getByRole('button', { name: '查看商品圖片 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看商品圖片 2' })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看商品圖片 3' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '查看商品圖片 1' }).locator('img')).toHaveAttribute(
    'src',
    /\/storage\/v1\/object\/public\/product-images\/products\/asset-2\/hero\.webp$/,
  );
});

test('商品多容量規格可切換價格並分開加入購物車', async ({ page }) => {
  await mockEcladoApis(page, {
    products: mockProducts.map(product => product.id === 2 ? {
      ...product,
      variants: [
        { id: 'legacy-json', size: '舊 JSON 規格', price: 9999, proPrice: 8888, stock: 99, isDefault: true },
      ],
    } : product),
    productVariants: [
      { id: 201, product_id: 2, size: '30ml', price: 3980, pro_price: 2980, stock: 2, is_default: true, sort_order: 1, active: true },
      { id: 202, product_id: 2, size: '60ml', price: 6880, pro_price: 5200, stock: 4, is_default: false, sort_order: 2, active: true },
      { id: 203, product_id: 2, size: '停用規格', price: 1, pro_price: 1, stock: 1, is_default: false, sort_order: 3, active: false },
    ],
    promotions: [],
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await expect(page.getByText('容量規格')).toBeVisible();
  await expect(page.getByRole('button', { name: '30ml' })).toBeVisible();
  await expect(page.getByRole('button', { name: '舊 JSON 規格' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '停用規格' })).toHaveCount(0);
  await page.getByRole('button', { name: '60ml' }).click();
  await expect(page.getByText('Peptide Repair Serum · 60ml')).toBeVisible();
  await expect(page.getByText('NT$ 6,880').first()).toBeVisible();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  const cartDrawer = await openCart(page);
  await expect(cartDrawer.getByText('胜肽修護精華液', { exact: false })).toBeVisible();
  await expect(cartDrawer.getByText('60ml', { exact: false })).toBeVisible();
  await expect(cartDrawer.getByText('NT$ 6,880').first()).toBeVisible();
});

test('DB 新增的商品會顯示在商城', async ({ page }) => {
  await mockEcladoApis(page, {
    products: [
      ...mockProducts,
      {
        id: 10,
        name: 'New Hydration Cream',
        name_zh: '新款保濕乳霜',
        category: '面霜',
        size: '50ml',
        price: 1880,
        pro_price: 1380,
        stock: 12,
        min_stock: 3,
        is_pro_only: false,
        image_url: 'https://example.com/new-product.jpg',
        description: '新增商品測試',
        skin_type: '全膚質',
        ingredients: '玻尿酸',
        features: ['保濕'],
        active: true,
      },
    ],
    promotions: [],
  });

  await page.goto('/shop');
  await expect(page.getByText('新款保濕乳霜')).toBeVisible();
  await page.getByText('新款保濕乳霜').click();
  await expect(page.getByText('新增商品測試')).toBeVisible();
  await expect(page.getByText('NT$ 1,880').first()).toBeVisible();
});

test('DB 下架的商品不會顯示在商城', async ({ page }) => {
  await mockEcladoApis(page, {
    products: mockProducts.map(product => product.id === 2 ? { ...product, active: false } : product),
    promotions: [],
  });

  await page.goto('/shop');
  await expect(page.getByText('胜肽修護精華液')).toHaveCount(0);
});

test('購物車中的商品收到下架更新後會被移除', async ({ page }) => {
  let products = [...mockProducts];
  await mockEcladoApis(page, {
    products: () => products,
    promotions: [],
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  const cartDrawer = await openCart(page);
  await expect(cartDrawer.getByText('胜肽修護精華液', { exact: false })).toBeVisible();

  products = products.map(product => product.id === 2 ? { ...product, active: false } : product);
  await triggerProductsRealtime(page);

  await expect(cartDrawer.getByText('購物車是空的')).toBeVisible();
});

test('購物車中的商品價格變更後會以最新價格重算', async ({ page }) => {
  let products = [...mockProducts];
  await mockEcladoApis(page, {
    products: () => products,
    promotions: [],
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await openCart(page);
  await expect(page.getByText('NT$ 3,980').first()).toBeVisible();

  products = products.map(product => product.id === 2 ? { ...product, price: 2999 } : product);
  await triggerProductsRealtime(page);

  await expect(page.getByText('NT$ 2,999').first()).toBeVisible();
});

test('購物車中的商品變成院線限定後一般會員不可繼續結帳', async ({ page }) => {
  let products = [...mockProducts];
  await mockEcladoApis(page, {
    products: () => products,
    promotions: [],
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await openCart(page);

  products = products.map(product => product.id === 2 ? { ...product, is_pro_only: true } : product);
  await triggerProductsRealtime(page);

  await expect(page.getByText('購物車是空的')).toBeVisible();
  await expect(page.getByRole('button', { name: /前往結帳/ })).toHaveCount(0);
});

test('購物車中的商品庫存變成零時會同步顯示預購', async ({ page }) => {
  let products = [...mockProducts];
  await mockEcladoApis(page, {
    products: () => products,
    promotions: [],
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await openCart(page);
  await expect(page.getByText(/現貨商品/).first()).toBeVisible();

  products = products.map(product => product.id === 2 ? { ...product, stock: 0 } : product);
  await triggerProductsRealtime(page);

  await expect(page.getByText(/預購商品/).first()).toBeVisible();
});

test('現貨、預購、活動折扣與購物車操作', async ({ page }) => {
  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await expect(page.getByText(/現貨商品/).first()).toBeVisible();
  await expect(page.getByText('限時優惠')).toBeVisible();
  await page.getByRole('button', { name: /加入購物車/ }).click();

  await openCart(page);
  const cartDrawer = page.getByRole('dialog', { name: '購物車' });
  await expect(cartDrawer.getByText('E2E 測試活動')).toBeVisible();
  await expect(cartDrawer.getByText('NT$ 3,702')).toBeVisible();

  await cartDrawer.getByRole('button', { name: '+' }).first().click();
  await expect(cartDrawer.getByText('NT$ 7,284')).toBeVisible();

  await cartDrawer.getByRole('button', { name: /移除/ }).click();
  await expect(cartDrawer.getByText('購物車是空的')).toBeVisible();
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

  const cartDrawer = await openCart(page);
  await expect(cartDrawer.getByText('先減再折測試活動')).toBeVisible();
  await expect(cartDrawer.getByText('NT$ 3,224')).toBeVisible();
});

test('active=false 的停用活動不會顯示或套用折扣', async ({ page }) => {
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
  await expect(page.getByText('限時優惠')).toHaveCount(0);
  await expect(page.getByText('NT$ 3,980').first()).toBeVisible();
});

test('多個活動符合時套用折抵金額最高的一個', async ({ page }) => {
  await mockEcladoApis(page, {
    promotions: [
      { ...activePromotion, id: 'promo-rate', name: '九折活動', discount_rate: 0.9, discount_amount: 0 },
      { ...activePromotion, id: 'promo-amount', name: '折五百活動', discount_rate: 1, discount_amount: 500 },
    ],
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await expect(page.getByText('NT$ 3,480')).toBeVisible();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await openCart(page);
  await expect(page.getByText('折五百活動')).toBeVisible();
  await expect(page.getByText('NT$ 3,600')).toBeVisible();
});

test('異常折扣率與負折抵活動會被忽略', async ({ page }) => {
  await mockEcladoApis(page, {
    promotions: [{
      ...activePromotion,
      name: '異常折扣活動',
      discount_rate: -1,
      discount_amount: -100,
    }],
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await expect(page.getByText('限時優惠')).toHaveCount(0);
  await expect(page.getByText('NT$ 3,980').first()).toBeVisible();
});

test('尚未開始與已結束的活動不會套用折扣', async ({ page }) => {
  for (const promotion of [
    { ...activePromotion, name: '尚未開始活動', start_at: '2099-01-01T00:00:00.000Z', end_at: null },
    { ...activePromotion, name: '已結束活動', start_at: null, end_at: '2020-01-01T00:00:00.000Z' },
  ]) {
    await mockEcladoApis(page, { promotions: [promotion] });
    await page.goto('/shop');
    await page.getByText('胜肽修護精華液').first().click();
    await expect(page.getByText('限時優惠')).toHaveCount(0);
    await expect(page.getByText('NT$ 3,980').first()).toBeVisible();
  }
});

test('活動開始與結束時間邊界依排程精確生效', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__ecladoTestNow = Date.parse('2030-05-01T10:00:00.000Z');
    Date.now = () => (window as any).__ecladoTestNow;
  });
  await mockEcladoApis(page, {
    promotions: [{
      ...activePromotion,
      start_at: '2030-05-01T10:00:00.000Z',
      end_at: '2030-05-01T10:01:00.000Z',
    }],
  });
  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await expect(page.getByText('限時優惠')).toBeVisible();

  await page.evaluate(() => {
    (window as any).__ecladoTestNow = Date.parse('2030-05-01T10:01:00.001Z');
  });
  await page.getByRole('button', { name: '返回商品列表' }).click();
  await page.getByText('胜肽修護精華液').first().click();
  await expect(page.getByText('限時優惠')).toHaveCount(0);
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
  const cartDrawer = await openCart(page);
  await expect(cartDrawer.getByText('胜肽修護精華液', { exact: false })).toBeVisible();
});

test('購物車重新整理後仍保留，且 localStorage 不保存價格資料', async ({ page }) => {
  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();

  const storedCart = await page.evaluate(() => JSON.parse(
    window.localStorage.getItem('eclado_cart_v1') || '[]',
  ));
  expect(storedCart).toEqual([{
    id: 2,
    variantId: '',
    qty: 1,
  }]);
  expect(storedCart[0]).not.toHaveProperty('price');
  expect(storedCart[0]).not.toHaveProperty('proPrice');

  await page.evaluate(() => {
    const items = JSON.parse(window.localStorage.getItem('eclado_cart_v1') || '[]');
    items[0].price = 1;
    items[0].nameZh = '被竄改的商品';
    window.localStorage.setItem('eclado_cart_v1', JSON.stringify(items));
  });
  await page.reload();
  await openCart(page);
  const cartDrawer = page.getByRole('dialog', { name: '購物車' });
  await expect(cartDrawer.getByText('胜肽修護精華液', { exact: false })).toBeVisible();
  await expect(cartDrawer.getByText('NT$ 3,980').first()).toBeVisible();
});

test('數字型規格 ID 經 localStorage 還原後仍保留商品與正確價格', async ({ page }) => {
  await mockEcladoApis(page, {
    productVariants: [
      { id: 201, product_id: 2, size: '30ml', price: 3980, pro_price: 2980, stock: 2, is_default: true, sort_order: 1, active: true },
      { id: 202, product_id: 2, size: '60ml', price: 6880, pro_price: 5200, stock: 4, is_default: false, sort_order: 2, active: true },
    ],
    promotions: [],
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: '60ml' }).click();
  await page.getByRole('button', { name: /加入購物車/ }).click();

  await expect.poll(() => page.evaluate(() => (
    JSON.parse(window.localStorage.getItem('eclado_cart_v1') || '[]')[0]?.variantId
  ))).toBe('202');

  await page.reload();
  const cartDrawer = await openCart(page);
  await expect(cartDrawer.getByText('胜肽修護精華液', { exact: false })).toBeVisible();
  await expect(cartDrawer.getByText('胜肽修護精華液 · 60ml')).toBeVisible();
  await expect(cartDrawer.getByText('NT$ 6,880').first()).toBeVisible();
  await expect(cartDrawer.getByText('NT$ 非數值')).toHaveCount(0);
});

test('結帳建立付款單但不寫入真實訂單或真金流', async ({ page }) => {
  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await openCart(page);
  await proceedToCheckout(page);

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

  await expect(page.getByRole('heading', { name: '付款單已建立' })).toBeVisible();
  await expect(page.getByText('807 永豐銀行')).toBeVisible();
  await expect(page.getByText('8071234567890123')).toBeVisible();
  await expect(page.getByText('2026/08/19 23:59 前')).toBeVisible();
  await expect(page.getByText('請於期限前完成轉帳，逾期後訂單將自動取消。')).toBeVisible();
});

test('付款單訂單明細優先顯示 product_images 的 Storage 首圖', async ({ page }) => {
  const storagePath = 'products/product-2/storage-primary.webp';
  await mockEcladoApis(page, {
    products: mockProducts.map(product => Number(product.id) === 2
      ? { ...product, image_url: 'https://legacy.example.com/product-2.jpg' }
      : product),
    productImages: [{
      id: 'product-2-primary', product_id: 2, storage_path: storagePath,
      is_primary: true, sort_order: 0, active: true,
    }],
  });

  await createCheckoutPayment(page, /虛擬帳號匯款/);

  const orderImage = page.getByRole('img', { name: '胜肽修護精華液' });
  await expect(orderImage).toHaveAttribute('src', new RegExp(`/storage/v1/object/public/product-images/${storagePath}$`));
  await expect(orderImage).not.toHaveAttribute('src', 'https://legacy.example.com/product-2.jpg');
});

for (const scenario of [
  { name: 'ATM', method: /虛擬帳號匯款/, restoredAction: '8071234567890123' },
  { name: '信用卡', method: /信用卡/, restoredAction: '前往付款頁' },
  { name: 'Apple Pay', method: /Apple Pay/, restoredAction: '前往付款頁' },
  { name: 'Google Pay', method: /Google Pay/, restoredAction: '前往付款頁' },
]) {
  test(`${scenario.name} 付款單在重新整理後恢復原付款資訊`, async ({ page }) => {
    await mockEcladoApis(page, { paymentQueryStatus: 'pending' });
    await createCheckoutPayment(page, scenario.method);

    const saved = await page.evaluate(() => JSON.parse(
      sessionStorage.getItem('eclado_pending_payment') || 'null',
    ));
    expect(saved?.version).toBe(2);
    expect(saved?.orderNo).toMatch(/^ECL-/);
    expect(saved?.paymentToken).toBeTruthy();
    expect(saved?.summary?.items).toHaveLength(1);

    await page.reload();
    await expect(page.getByRole('heading', { name: '付款單已建立' })).toBeVisible();
    if (scenario.name === 'ATM') {
      await expect(page.getByText(scenario.restoredAction)).toBeVisible();
      await expect(page.getByRole('button', { name: '複製虛擬帳號' })).toBeVisible();
    } else {
      await expect(page.getByRole('button', { name: scenario.restoredAction })).toBeVisible();
    }
  });
}

test('舊付款單已付款時清除恢復紀錄，新的購物車可建立新付款單', async ({ page }) => {
  const paymentRequests: Record<string, unknown>[] = [];
  await mockEcladoApis(page, {
    paymentQueryStatus: 'paid',
    onPaymentRequest: request => paymentRequests.push(request),
  });
  await createCheckoutPayment(page, /虛擬帳號匯款/);
  expect(paymentRequests).toHaveLength(1);

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await openCart(page);
  await proceedToCheckout(page);

  await expect(page.getByRole('button', { name: /繼續確認付款/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: '付款單已建立' })).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('eclado_pending_payment'))).toBeNull();

  const checkoutInputs = page.locator('form input');
  await checkoutInputs.nth(0).fill('第二筆付款測試');
  await checkoutInputs.nth(1).fill('0912345678');
  await checkoutInputs.nth(2).fill('second-payment@example.com');
  await page.getByPlaceholder('縣市').fill('台北市');
  await page.getByPlaceholder('區域').fill('中山區');
  await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('新訂單路 2 號');
  await page.getByRole('button', { name: /繼續確認付款/ }).click();
  await page.getByRole('button', { name: /^建立付款單$/ }).click();
  await expect(page.getByRole('heading', { name: '付款單已建立' })).toBeVisible();
  expect(paymentRequests).toHaveLength(2);
});

test('逾期付款單重新整理後停用付款入口且不建立第二張付款單', async ({ page }) => {
  const paymentRequests: Record<string, unknown>[] = [];
  await mockEcladoApis(page, {
    paymentQueryStatus: 'expired',
    onPaymentRequest: request => paymentRequests.push(request),
  });
  await createCheckoutPayment(page, /信用卡/);
  expect(paymentRequests).toHaveLength(1);

  await page.reload();
  await expect(page.getByText('付款期限已過，此訂單已取消，無法重新付款。')).toBeVisible();
  await expect(page.getByRole('button', { name: '前往付款頁' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '複製付款連結' })).toHaveCount(0);
  expect(paymentRequests).toHaveLength(1);
  expect(await page.evaluate(() => sessionStorage.getItem('eclado_pending_payment'))).toBeNull();

  await page.reload();
  await expect(page.getByText('付款期限已過，此訂單已取消，無法重新付款。')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /繼續確認付款/ })).toBeVisible();
  expect(paymentRequests).toHaveLength(1);
});

test('後端成交價與預覽不同時直接採用權威金額建立付款單', async ({ page }) => {
  const paymentRequests: Record<string, unknown>[] = [];
  await mockEcladoApis(page, {
    authoritativePriceDelta: 100,
    onPaymentRequest: request => paymentRequests.push(request),
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await openCart(page);
  await proceedToCheckout(page);

  const checkoutInputs = page.locator('form input');
  await checkoutInputs.nth(0).fill('價差確認測試');
  await checkoutInputs.nth(1).fill('0912345678');
  await checkoutInputs.nth(2).fill('price-change@example.com');
  await page.getByPlaceholder('縣市').fill('台北市');
  await page.getByPlaceholder('區域').fill('大安區');
  await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('價差路 1 號');
  await page.getByRole('button', { name: /繼續確認付款/ }).click();

  await page.getByRole('button', { name: /^建立付款單$/ }).click();
  await expect(page.getByText('付款單已建立')).toBeVisible();
  await expect(page.getByText('成交金額已由後端更新')).toHaveCount(0);
  expect(paymentRequests).toHaveLength(1);
  expect(paymentRequests[0].amount).toBe(3792);
});

test('登入會員結帳會寫入訂單 payload 與 user_id，付款前不扣庫存', async ({ page }) => {
  let capturedOrder: Record<string, unknown> | null = null;
  const orderEmails: Record<string, unknown>[] = [];

  await mockEcladoApis(page, {
    authUser: authUser('buyer@example.com'),
    profiles: [profile('consumer', 'buyer@example.com')],
    onOrderInsert: order => { capturedOrder = order; },
    onOrderEmail: body => orderEmails.push(body),
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await openCart(page);
  await proceedToCheckout(page);

  const checkoutInputs = page.locator('form input');
  await checkoutInputs.nth(0).fill('登入買家');
  await checkoutInputs.nth(1).fill('0911111111');
  await checkoutInputs.nth(2).fill('buyer@example.com');
  await page.getByPlaceholder('縣市').fill('台北市');
  await page.getByPlaceholder('區域').fill('信義區');
  await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('測試路 99 號');
  await page.getByRole('button', { name: '×' }).click();
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
  expect(capturedOrder?.fulfillment_method).toBe('delivery');
  expect(capturedOrder?.total).toBe(3702);
  expect(capturedOrder?.promotion_name).toBe('E2E 測試活動');
  const items = capturedOrder?.items as Array<Record<string, unknown>>;
  expect(items[0].stock_at_order).toBe(2);
  expect(items[0].is_custom_order).toBe(false);
  expect(orderEmails).toEqual([]);
});

test('全部為客訂規格時可選現場自取且後端訂單運費為零', async ({ page }) => {
  let capturedOrder: Record<string, unknown> | null = null;
  await mockEcladoApis(page, {
    productVariants: [{
      id: 2001, product_id: 2, sku: 'CUSTOM-2', size: '客訂規格',
      price: 3980, pro_price: 2980, stock: 2, is_default: true,
      is_custom_order: true, sort_order: 0, active: true,
    }],
    onOrderInsert: order => { capturedOrder = order; },
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await openCart(page);
  await proceedToCheckout(page);

  await expect(page.getByRole('button', { name: /現場自取/ })).toBeVisible();
  await page.getByRole('button', { name: /現場自取/ }).click();
  await expect(page.getByPlaceholder('縣市')).toHaveCount(0);
  const inputs = page.locator('form input[type="text"], form input[type="tel"], form input[type="email"]');
  await inputs.nth(0).fill('客訂買家');
  await inputs.nth(1).fill('0912345678');
  await inputs.nth(2).fill('pickup@example.com');
  await page.getByRole('button', { name: /繼續確認付款/ }).click();
  await expect(page.getByText('現場自取（客訂商品）')).toBeVisible();
  await page.getByRole('button', { name: /^建立付款單$/ }).click();

  await expect(page.getByText('付款單已建立')).toBeVisible();
  expect(capturedOrder?.fulfillment_method).toBe('onsite_pickup');
  expect(capturedOrder?.address).toBe('');
  expect(capturedOrder?.total).toBe(3582);
});

test('一般商品與混合購物車都只能宅配', async ({ page }) => {
  await mockEcladoApis(page, {
    productVariants: [{
      id: 2001, product_id: 2, sku: 'CUSTOM-2', size: '客訂規格',
      price: 3980, pro_price: 2980, stock: 2, is_default: true,
      is_custom_order: true, sort_order: 0, active: true,
    }],
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await page.goto('/shop');
  await page.getByText('深層清潔泡沫洗面乳').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await openCart(page);
  await proceedToCheckout(page);

  await expect(page.getByRole('button', { name: /現場自取/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /宅配到府/ })).toBeVisible();
  await expect(page.getByPlaceholder('縣市')).toBeVisible();
  await expect(page.getByText('（宅配到府）')).toBeVisible();
});

test('竄改混合購物車為現場自取會被後端拒絕', async ({ page }) => {
  await mockEcladoApis(page, {
    productVariants: [{
      id: 2001, product_id: 2, sku: 'CUSTOM-2', size: '客訂規格',
      price: 3980, pro_price: 2980, stock: 2, is_default: true,
      is_custom_order: true, sort_order: 0, active: true,
    }],
  });
  await page.goto('/');

  const response = await page.evaluate(async () => {
    const result = await fetch('https://ilvdvlkdpntwmaijncaz.supabase.co/rest/v1/rpc/create_order_with_pricing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_items: [
          { product_id: 2, variant_id: '2001', qty: 1 },
          { product_id: 1, variant_id: null, qty: 1 },
        ],
        p_member: '竄改測試', p_address: '', p_phone: '0912345678',
        p_email: 'tamper@example.com', p_note: '', p_payment_method: 'atm',
        p_fulfillment_method: 'onsite_pickup',
      }),
    });
    return { status: result.status, body: await result.json() };
  });

  expect(response.status).toBe(403);
  expect(String(response.body.message)).toContain('custom-order variants');
});

test('訪客付款單顯示短查詢碼與訂單成立信寄送結果', async ({ page }) => {
  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await openCart(page);
  await proceedToCheckout(page);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('訪客買家');
  await inputs.nth(1).fill('0912345678');
  await inputs.nth(2).fill('guest@example.com');
  await page.getByPlaceholder('縣市').fill('台北市');
  await page.getByPlaceholder('區域').fill('大安區');
  await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('訪客路 1 號');
  await page.getByRole('button', { name: /繼續確認付款/ }).click();
  await page.getByRole('button', { name: /^建立付款單$/ }).click();
  await expect(page.getByText('ABCDE-12345')).toBeVisible();
  await expect(page.getByText(/訂單成立信已寄出/)).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('eclado_pending_payment') || 'null'));
  expect(saved.lookupCode).toBe('ABCDE-12345');
  expect(saved.orderEmailSent).toBe(true);
});

test('訪客可用短查詢碼與結帳手機查看訂單，並在待付款時返回付款單', async ({ page }) => {
  const lookupRequests: Array<{ lookupCode: string; phone: string }> = [];
  await mockEcladoApis(page, {
    paymentQueryStatus: 'pending',
    onGuestLookupRequest: request => lookupRequests.push(request),
    orders: [{
      id: 'ECL-GUEST-LOOKUP-001', user_id: null, member: '訪客買家', phone: '0912345678',
      public_lookup_code: 'ABCDE-12345', status: 'awaiting_confirm', payment_method: 'atm',
      subtotal: 3980, discount: 0, shipping: 120, total: 4100,
      items: [{ id: 2, product_id: 2, name: '胜肽修護精華液', qty: 1, price: 3980 }],
      payment_due_at: '2099-01-01T00:00:00.000Z',
    }],
  });
  await page.goto('/order-lookup?lookup=ABCDE-12345');
  await expect(page.getByLabel('訪客查詢碼')).toHaveValue('ABCDE-12345');
  await page.getByLabel('結帳手機號碼').fill('0912-345-678');
  await page.getByRole('button', { name: '查看訂單' }).click();
  await expect(page).toHaveURL(/\/order-lookup/);
  await expect(page.getByRole('heading', { name: '訪客訂單明細' })).toBeVisible();
  await expect(page.getByText('ECL-GUEST-LOOKUP-001')).toBeVisible();
  await expect(page.getByText('胜肽修護精華液')).toBeVisible();
  await expect(page.getByText('等待付款').first()).toBeVisible();
  await expect(page.getByText('目前尚未建立物流資料。')).toBeVisible();
  const guestSession = await page.evaluate(() => JSON.parse(sessionStorage.getItem('eclado_guest_order_session') || 'null'));
  expect(guestSession.orderNo).toBe('ECL-GUEST-LOOKUP-001');
  expect(guestSession.guestAccessToken).toBe('guest-access-token-e2e');
  expect(JSON.stringify(guestSession)).not.toContain('0912345678');

  await page.getByRole('button', { name: '查看付款資訊／繼續付款' }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByRole('heading', { name: '付款單已建立' })).toBeVisible();
  await expect(page.getByText('8071122334455667')).toBeVisible();
  expect(lookupRequests).toEqual([{ lookupCode: 'ABCDE-12345', phone: '0912-345-678' }]);
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('eclado_pending_payment') || 'null'));
  expect(saved.accessType).toBe('guest');
  expect(saved.guestAccessToken).toBe('guest-access-token-e2e');
  expect(JSON.stringify(saved)).not.toContain('0912345678');
});

test('訪客訂單查詢在重新整理後以短效憑證恢復，不需再次輸入手機', async ({ page }) => {
  const detailsRequests: Array<{ orderNo: string; guestAccessToken: string }> = [];
  await mockEcladoApis(page, {
    onGuestDetailsRequest: request => detailsRequests.push(request),
    orders: [{
      id: 'ECL-GUEST-RESTORE-001', user_id: null, member: '訪客買家', phone: '0912345678',
      public_lookup_code: 'ABCDE-12345', status: 'preparing', payment_method: 'card',
      subtotal: 3980, discount: 0, shipping: 0, total: 3980,
      items: [{ id: 2, product_id: 2, name: '胜肽修護精華液', qty: 1, price: 3980 }],
      created_at: '2026-08-17T01:00:00.000Z',
    }],
  });
  await page.goto('/order-lookup');
  await page.getByLabel('訪客查詢碼').fill('ABCDE-12345');
  await page.getByLabel('結帳手機號碼').fill('0912345678');
  await page.getByRole('button', { name: '查看訂單' }).click();
  await expect(page.getByText('備貨中')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: '訪客訂單明細' })).toBeVisible();
  await expect(page.getByText('備貨中')).toBeVisible();
  await expect(page.getByText('訂單正在備貨，出貨後將於此顯示托運單號。')).toBeVisible();
  expect(detailsRequests).toContainEqual({
    orderNo: 'ECL-GUEST-RESTORE-001',
    guestAccessToken: 'guest-access-token-e2e',
  });
  const guestSession = await page.evaluate(() => JSON.parse(sessionStorage.getItem('eclado_guest_order_session') || 'null'));
  expect(JSON.stringify(guestSession)).not.toContain('0912345678');
});

test('訪客重新驗證查詢碼與手機後可從訂單明細重新付款', async ({ page }) => {
  const retryRequests: Array<{ authorization:string; body:Record<string, unknown> }> = [];
  await mockEcladoApis(page, {
    paymentQueryStatus:'failed',
    onPaymentRetryRequest:request => retryRequests.push(request),
    orders:[{
      id:'ECL-GUEST-FAILED-001', user_id:null, member:'訪客買家', phone:'0912345678',
      public_lookup_code:'ABCDE-12345', status:'unpaid', payment_method:'card',
      subtotal:3980, discount:0, shipping:120, total:4100,
      items:[{ id:2, product_id:2, name:'胜肽修護精華液', qty:1, price:3980 }],
      payment_due_at:'2099-01-01T00:00:00.000Z',
    }],
  });
  await page.route('https://sandbox.sinopac.test/retry-pay', route => route.fulfill({ status:200, contentType:'text/html', body:'<h1>Retry</h1>' }));

  await page.goto('/order-lookup?lookup=ABCDE-12345');
  await page.getByLabel('結帳手機號碼').fill('0912345678');
  await page.getByRole('button', { name:'查看訂單' }).click();
  await expect(page.getByText('付款失敗').first()).toBeVisible();
  await expect(page.getByRole('button', { name:'重新付款' })).toBeVisible();
  await page.getByRole('button', { name:'重新付款' }).click();
  await expect(page).toHaveURL('https://sandbox.sinopac.test/retry-pay');
  expect(retryRequests).toEqual([{
    authorization:'',
    body:{ orderNo:'ECL-GUEST-FAILED-001', guestAccessToken:'guest-access-token-e2e' },
  }]);
  await page.goto('/');
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('eclado_pending_payment') || 'null'));
  expect(saved).toMatchObject({
    orderNo:'ECL-GUEST-FAILED-001', accessType:'guest', guestAccessToken:'guest-access-token-e2e', resultAccessToken:'retry-result-access-token',
  });
});

test('訪客可查看已出貨訂單與順豐托運資訊，已付款後不顯示付款入口', async ({ page }) => {
  await mockEcladoApis(page, {
    orders: [{
      id: 'ECL-GUEST-SHIPPED-001', user_id: null, member: '訪客買家', phone: '0912345678',
      public_lookup_code: 'ABCDE-12345', status: 'shipped', payment_method: 'card',
      subtotal: 3980, discount: 0, shipping: 120, total: 4100,
      items: [{ id: 2, product_id: 2, name: '胜肽修護精華液', qty: 1, price: 3980 }],
      tracking: 'SF1234567890', shipping_carrier: 'sf-express', shipped_at: '2026-08-17T03:00:00.000Z',
    }],
  });
  await page.goto('/order-lookup');
  await page.getByLabel('訪客查詢碼').fill('ABCDE-12345');
  await page.getByLabel('結帳手機號碼').fill('0912345678');
  await page.getByRole('button', { name: '查看訂單' }).click();

  await expect(page.getByText('已出貨')).toBeVisible();
  await expect(page.getByText('付款成功').first()).toBeVisible();
  await expect(page.getByText('托運單號：SF1234567890')).toBeVisible();
  await expect(page.getByRole('link', { name: '前往順豐查件' })).toHaveAttribute('href', /sf-express/);
  await expect(page.getByRole('button', { name: '查看付款資訊／繼續付款' })).toHaveCount(0);
});

test('訪客逾期或已取消訂單不可重新付款或建立第二張付款單', async ({ page }) => {
  await mockEcladoApis(page, {
    paymentQueryStatus: 'cancelled',
    orders: [{
      id: 'ECL-GUEST-CANCELLED-001', user_id: null, member: '訪客買家', phone: '0912345678',
      public_lookup_code: 'ABCDE-12345', status: 'cancelled', payment_method: 'atm',
      subtotal: 3980, discount: 0, shipping: 120, total: 4100,
      items: [{ id: 2, product_id: 2, name: '胜肽修護精華液', qty: 1, price: 3980 }],
      payment_due_at: '2020-01-01T00:00:00.000Z',
    }],
  });
  await page.goto('/order-lookup');
  await page.getByLabel('訪客查詢碼').fill('ABCDE-12345');
  await page.getByLabel('結帳手機號碼').fill('0912345678');
  await page.getByRole('button', { name: '查看訂單' }).click();

  await expect(page.locator('span').filter({ hasText: /^已取消$/ })).toBeVisible();
  await expect(page.getByText('付款期限已過，無法重新付款或建立第二張付款單。')).toBeVisible();
  await expect(page.getByRole('button', { name: '查看付款資訊／繼續付款' })).toHaveCount(0);
});

test('信用卡、Apple Pay、Google Pay 會送出對應金流 payType', async ({ page }) => {
  const paymentRequests: Record<string, unknown>[] = [];
  const orderInserts: Record<string, unknown>[] = [];
  await mockEcladoApis(page, {
    onPaymentRequest: request => paymentRequests.push(request),
    onOrderInsert: order => orderInserts.push(order),
  });

  for (const method of [
    { button: /信用卡/, payType: 'C' },
    { button: /Apple Pay/, payType: 'M' },
    { button: /Google Pay/, payType: 'M' },
  ]) {
    await page.goto('/shop');
    await page.getByText('胜肽修護精華液').first().click();
    await page.getByRole('heading', { name: '胜肽修護精華液' })
      .locator('xpath=ancestor::div[1]')
      .getByRole('button', { name: /加入購物車/ })
      .click();
    await openCart(page);
    await proceedToCheckout(page);

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
    expect(paymentRequests.at(-1)?.Param1).toBe(orderInserts.at(-1)?.id);
    expect(paymentRequests.at(-1)?.backendUrl).toContain(`orderNo=${encodeURIComponent(String(orderInserts.at(-1)?.id))}`);
    expect(paymentRequests.at(-1)?.amount).toBe(orderInserts.at(-1)?.total);
    expect(orderInserts.at(-1)?.status).toBe('unpaid');
    await page.evaluate(() => {
      sessionStorage.removeItem('eclado_pending_payment');
      localStorage.removeItem('eclado_cart_v1');
    });
  }
});

test('信用卡付款使用同分頁按鈕，並在付款結果頁權威確認成功', async ({ page }) => {
  await mockEcladoApis(page, { paymentQueryStatus: 'paid' });
  await page.route('https://sandbox.sinopac.test/pay', route => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<title>永豐 Sandbox</title><h1>Sandbox payment page</h1>',
  }));
  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await openCart(page);
  await proceedToCheckout(page);

  const checkoutInputs = page.locator('form input');
  await checkoutInputs.nth(0).fill('付款返回測試');
  await checkoutInputs.nth(1).fill('0912345678');
  await checkoutInputs.nth(2).fill('return@example.com');
  await page.getByPlaceholder('縣市').fill('台北市');
  await page.getByPlaceholder('區域').fill('大安區');
  await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('付款路 1 號');
  await page.getByRole('button', { name: /繼續確認付款/ }).click();
  await page.getByRole('button', { name: /信用卡/ }).click();
  await page.getByRole('button', { name: /建立付款單/ }).click();

  const goToPayment = page.getByRole('button', { name: '前往付款頁' });
  await expect(goToPayment).toBeVisible();
  await expect(page.getByRole('link', { name: '前往付款頁' })).toHaveCount(0);

  const orderNo = await page.getByText(/^ECL-/).first().textContent();
  await goToPayment.click();
  await expect(page).toHaveURL('https://sandbox.sinopac.test/pay');
  // Simulate Sinopac's same-tab ReturnURL redirect. Going back to checkout first
  // would let its recovery flow confirm payment and clear the one-time token
  // before the result page can perform its own authoritative query.
  await page.goto(`/payment-result?orderNo=${encodeURIComponent(orderNo?.trim() || '')}&result=paid`);
  await expect(page.getByRole('heading', { name: '付款成功' })).toBeVisible();
  await expect(page.getByText('付款金額：')).toContainText('NT$ 3,702');
  expect(await page.evaluate(() => sessionStorage.getItem('eclado_pending_payment'))).toBeNull();
});

test('付款回站即使沒有原分頁 session，仍可用限時結果憑證確認成功', async ({ page }) => {
  await mockEcladoApis(page, { paymentQueryStatus: 'paid' });
  let queryBody: Record<string, unknown> | null = null;
  await page.route('https://pay.ecladotaiwan.com/api/sinopac/query-payment', async route => {
    queryBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok:true, paymentState:'paid', order:{ id:'ECL-CROSS-TAB-001', status:'paid', total:3980 }, response:{ OrderList:[{ PayStatus:'1C400' }] } }),
    });
  });

  await page.goto('/payment-result?orderNo=ECL-CROSS-TAB-001&result=paid&resultToken=signed-result-token');
  await expect(page.getByRole('heading', { name:'付款成功' })).toBeVisible();
  expect(queryBody).toMatchObject({ orderNo:'ECL-CROSS-TAB-001', resultAccessToken:'signed-result-token' });
});

test('付款回站遇到通知時間差會自動重查直到成功', async ({ page }) => {
  await mockEcladoApis(page, { paymentQueryStatus: 'pending' });
  let queryCount = 0;
  await page.route('https://pay.ecladotaiwan.com/api/sinopac/query-payment', async route => {
    queryCount += 1;
    const paid = queryCount >= 3;
    await route.fulfill({
      status:200,
      contentType:'application/json',
      body:JSON.stringify({ ok:true, paymentState:paid ? 'paid' : 'pending', order:{ id:'ECL-POLL-001', status:paid ? 'paid' : 'unpaid', total:3980 }, response:{ OrderList:[{ PayStatus:paid ? '1C400' : '1C200' }] } }),
    });
  });

  await page.goto('/payment-result?orderNo=ECL-POLL-001&result=pending&resultToken=poll-result-token');
  await expect(page.getByRole('heading', { name:'正在確認付款結果' })).toBeVisible();
  await expect(page.getByRole('heading', { name:'付款成功' })).toBeVisible({ timeout:8000 });
  expect(queryCount).toBe(3);
});

test('付款失敗頁保留原訂單並建立新的付款嘗試', async ({ page }) => {
  await mockEcladoApis(page, { paymentQueryStatus: 'failed' });
  await page.route('https://sandbox.sinopac.test/retry-pay', route => route.fulfill({
    status:200,
    contentType:'text/html',
    body:'<title>永豐重新付款</title><h1>Retry payment page</h1>',
  }));
  await page.goto('/');
  await expect(page.getByText('胜肽修護精華液').first()).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('eclado_pending_payment', JSON.stringify({
    version:2,
    orderNo:'ECL-FAILED-001',
    paymentToken:'failed-payment-token',
    amount:3980,
    method:'card',
    methodLabel:'信用卡',
    summary:{
      subtotal:3980,
      discount:0,
      finalSubtotal:3980,
      shipping:0,
      total:3980,
      fulfillmentMethod:'delivery',
      items:[{ id:2, product_id:2, variant_id:'', qty:1 }],
    },
  })));

  await page.goto('/payment-result?orderNo=ECL-FAILED-001&result=failed');
  await expect(page.getByRole('heading', { name:'付款未完成' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('原訂單不會被視為已付款，也不會扣款出貨');
  await expect(page.getByRole('alert')).toContainText('保留原訂單並重新建立付款單');
  await page.getByRole('button', { name:'重新付款' }).click();
  await expect(page).toHaveURL('https://sandbox.sinopac.test/retry-pay');
  await page.goto('/');
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('eclado_pending_payment') || 'null'));
  expect(saved).toMatchObject({
    orderNo:'ECL-FAILED-001',
    paymentToken:'',
    resultAccessToken:'retry-result-access-token',
    paymentLink:'https://sandbox.sinopac.test/retry-pay',
  });
});

test('金流建單失敗時顯示錯誤且不進入付款完成畫面', async ({ page }) => {
  await mockEcladoApis(page, {
    promotions: [],
    paymentError: '測試金流暫時不可用',
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await openCart(page);
  await proceedToCheckout(page);

  const checkoutInputs = page.locator('form input');
  await checkoutInputs.nth(0).fill('金流失敗測試');
  await checkoutInputs.nth(1).fill('0912345678');
  await checkoutInputs.nth(2).fill('failed@example.com');
  await page.getByPlaceholder('縣市').fill('台北市');
  await page.getByPlaceholder('區域').fill('大安區');
  await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('測試路 1 號');
  await page.getByRole('button', { name: /繼續確認付款/ }).click();
  await page.getByRole('button', { name: /建立付款單/ }).click();

  await expect(page.getByText(/付款單建立失敗.*測試金流暫時不可用/)).toBeVisible();
  await expect(page.getByText('付款單已建立')).toHaveCount(0);
});

test('快速重複點擊建立付款單只會送出一次金流請求', async ({ page }) => {
  const paymentRequests: Record<string, unknown>[] = [];
  await mockEcladoApis(page, {
    promotions: [],
    paymentResponseDelayMs: 250,
    onPaymentRequest: request => paymentRequests.push(request),
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await openCart(page);
  await proceedToCheckout(page);

  const checkoutInputs = page.locator('form input');
  await checkoutInputs.nth(0).fill('防重複付款測試');
  await checkoutInputs.nth(1).fill('0912345678');
  await checkoutInputs.nth(2).fill('idempotency@example.com');
  await page.getByPlaceholder('縣市').fill('台北市');
  await page.getByPlaceholder('區域').fill('大安區');
  await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('防重複路 1 號');
  await page.getByRole('button', { name: /繼續確認付款/ }).click();

  const createPayment = page.getByRole('button', { name: /^建立付款單$/ });
  await createPayment.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
    button.click();
  });

  await expect(page.getByRole('heading', { name: '付款單已建立' })).toBeVisible();
  expect(paymentRequests).toHaveLength(1);
});

test('權威訂單建立失敗時不建立付款單', async ({ page }) => {
  const paymentRequests: Record<string, unknown>[] = [];
  await mockEcladoApis(page, {
    promotions: [],
    orderWriteError: '測試訂單寫入失敗',
    onPaymentRequest: request => paymentRequests.push(request),
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await openCart(page);
  await proceedToCheckout(page);

  const checkoutInputs = page.locator('form input');
  await checkoutInputs.nth(0).fill('訂單寫入失敗測試');
  await checkoutInputs.nth(1).fill('0912345678');
  await checkoutInputs.nth(2).fill('order-failed@example.com');
  await page.getByPlaceholder('縣市').fill('台北市');
  await page.getByPlaceholder('區域').fill('大安區');
  await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('測試路 1 號');
  await page.getByRole('button', { name: /繼續確認付款/ }).click();
  await page.getByRole('button', { name: /虛擬帳號匯款/ }).click();
  await page.getByRole('button', { name: /建立付款單/ }).click();

  await expect(page.getByText(/付款單建立失敗.*測試訂單寫入失敗/)).toBeVisible();
  await expect(page.getByRole('heading', { name: '付款單已建立' })).toHaveCount(0);
  expect(paymentRequests).toHaveLength(0);
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
  await expect(page.getByText('付款成功')).toBeVisible();
  await expect(page.getByText('已出貨')).toBeVisible();
  await expect(page.getByText('托運單號：SF123456789')).toBeVisible();
  await expect(page.getByRole('link', { name: '前往順豐查件' })).toHaveAttribute(
    'href',
    'https://htm.sf-express.com/tw/tc/',
  );
});

test('從首頁捲動位置進入長訂單會員專區時回到頁首', async ({ page }) => {
  const orders = Array.from({ length: 24 }, (_, index) => ({
    id: `ACCOUNT-SCROLL-${String(index + 1).padStart(2, '0')}`,
    user_id: TEST_USER_ID,
    member: 'E2E 會員',
    items: [{ name: '胜肽修護精華液', qty: 1, price: 3980 }],
    total: 3980,
    status: 'paid',
    created_at: `2026-08-${String((index % 16) + 1).padStart(2, '0')}T00:00:00.000Z`,
  }));
  await mockEcladoApis(page, {
    authUser: authUser('member@example.com'),
    profiles: [profile('consumer')],
    orders,
  });

  await page.goto('/');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.locator('nav').getByRole('button', { name: '會員專區' }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: '會員專區' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByText('24 筆')).toBeVisible();
});

test('會員可從我的訂單安全返回尚未付款的原付款單', async ({ page }) => {
  const instructionRequests: Array<{ authorization: string; orderNo: string }> = [];
  await mockEcladoApis(page, {
    authUser: authUser('member@example.com'),
    profiles: [profile('consumer')],
    paymentQueryStatus: 'pending',
    onPaymentInstructionRequest: request => instructionRequests.push(request),
    orders: [
      {
        id: 'ECL-MEMBER-PENDING-001',
        user_id: TEST_USER_ID,
        member: 'E2E 會員',
        items: [{ id: 2, product_id: 2, name: '胜肽修護精華液', nameZh: '胜肽修護精華液', qty: 1, price: 3980, unit_price: 3980 }],
        subtotal: 3980,
        discount: 0,
        shipping: 120,
        total: 4100,
        status: 'awaiting_confirm',
        payment_method: 'atm',
        payment_due_at: '2099-01-01T00:00:00.000Z',
        created_at: '2026-08-17T00:00:00.000Z',
      },
    ],
  });

  await page.goto('/account');
  await page.getByRole('button', { name: '查看付款資訊' }).click();

  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByRole('heading', { name: '付款單已建立' })).toBeVisible();
  await expect(page.getByText('8079988776655443')).toBeVisible();
  await expect(page.getByRole('button', { name: '複製虛擬帳號' })).toBeVisible();
  expect(instructionRequests).toEqual([{
    authorization: 'Bearer mock-access-token',
    orderNo: 'ECL-MEMBER-PENDING-001',
  }]);
  const saved = await page.evaluate(() => JSON.parse(
    sessionStorage.getItem('eclado_pending_payment') || 'null',
  ));
  expect(saved?.accessType).toBe('member');
  expect(saved?.paymentToken).toBe('');
});

test('會員可從我的訂單以本人登入憑證重新付款且保留原訂單', async ({ page }) => {
  const retryRequests: Array<{ authorization:string; body:Record<string, unknown> }> = [];
  const summaryAuth: string[] = [];
  await mockEcladoApis(page, {
    authUser:authUser('member@example.com'),
    profiles:[profile('consumer')],
    paymentQueryStatus:'failed',
    onPaymentRetryRequest:request => retryRequests.push(request),
    onPaymentSummaryRequest:authorization => summaryAuth.push(authorization),
    orders:[{
      id:'ECL-MEMBER-FAILED-001', user_id:TEST_USER_ID, member:'E2E 會員',
      items:[{ id:2, product_id:2, name:'胜肽修護精華液', qty:1, price:3980 }],
      subtotal:3980, discount:0, shipping:120, total:4100,
      status:'unpaid', payment_method:'card', payment_due_at:'2099-01-01T00:00:00.000Z',
      created_at:'2026-08-17T00:00:00.000Z',
    }],
  });
  await page.route('https://sandbox.sinopac.test/retry-pay', route => route.fulfill({ status:200, contentType:'text/html', body:'<h1>Retry</h1>' }));

  await page.goto('/account');
  await expect(page.getByText('付款失敗')).toBeVisible();
  await expect(page.getByRole('button', { name:'重新付款' })).toBeVisible();
  await page.getByRole('button', { name:'重新付款' }).click();
  await expect(page).toHaveURL('https://sandbox.sinopac.test/retry-pay');
  expect(summaryAuth).toContain('Bearer mock-access-token');
  expect(retryRequests).toEqual([{
    authorization:'Bearer mock-access-token',
    body:{ orderNo:'ECL-MEMBER-FAILED-001' },
  }]);
  await page.goto('/');
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('eclado_pending_payment') || 'null'));
  expect(saved).toMatchObject({ orderNo:'ECL-MEMBER-FAILED-001', accessType:'member', resultAccessToken:'retry-result-access-token' });
});

test('會員訂單付款期限已過時不顯示付款入口', async ({ page }) => {
  await mockEcladoApis(page, {
    authUser: authUser('member@example.com'),
    profiles: [profile('consumer')],
    orders: [
      {
        id: 'ECL-MEMBER-EXPIRED-001',
        user_id: TEST_USER_ID,
        member: 'E2E 會員',
        items: [{ name: '胜肽修護精華液', qty: 1, price: 3980 }],
        total: 3980,
        status: 'unpaid',
        payment_method: 'card',
        payment_due_at: '2020-01-01T00:00:00.000Z',
        created_at: '2026-08-15T00:00:00.000Z',
      },
    ],
  });

  await page.goto('/account');
  await expect(page.getByText('付款期限已過')).toBeVisible();
  await expect(page.getByRole('button', { name: '查看付款資訊' })).toHaveCount(0);
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
  await proceedToCheckout(page);

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
