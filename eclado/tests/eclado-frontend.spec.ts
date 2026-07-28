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
}

async function proceedToCheckout(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: /前往結帳/ }).click();
  const guestCheckout = page.getByRole('button', { name: /訪客結帳/ });
  if (await guestCheckout.isVisible({ timeout: 1000 }).catch(() => false)) {
    await guestCheckout.click();
  }
}

async function openAdminCatalog(page: import('@playwright/test').Page) {
  await page.goto('/admin');
  const openMenu = page.getByRole('button', { name: '開啟選單' });
  if (await openMenu.isVisible()) await openMenu.click();
  await page.getByRole('button', { name: /商品 & 庫存/ }).click();
}

async function triggerProductsRealtime(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const client = (window as any).supabase;
    const channel = client.getChannels().find((candidate: any) => candidate.topic.includes('products-realtime'));
    const callback = channel?.bindings?.postgres_changes?.[0]?.callback;
    if (!callback) throw new Error('products realtime callback not found');
    callback({});
  });
}

test('主要路徑可開啟且不白屏', async ({ page }) => {
  test.slow();
  for (const path of ['/', '/shop', '/products/peptide-repair-serum', '/cart', '/checkout', '/login', '/professional-apply', '/about', '/info', '/privacy', '/contact', '/admin']) {
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    const body = page.locator('body');
    await expect(body).toBeVisible();
    await expect(body).not.toBeEmpty();
  }
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
  await expect(page).toHaveURL(/\/products\/peptide-repair-serum$/);
  await expect(page.getByRole('heading', { name: '胜肽修護精華液' })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/products\/peptide-repair-serum$/);
  await expect(page.getByRole('heading', { name: '胜肽修護精華液' })).toBeVisible();

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
  });
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
  await openCart(page);

  await expect(page.getByRole('status')).toHaveText('尚差 NT$2,020 可達最低訂購門檻。');
  await expect(page.getByRole('button', { name: '前往結帳' })).toBeDisabled();

  const increaseQuantity = page.getByRole('button', { name: '+' });
  await increaseQuantity.click();
  await expect(page.getByRole('status')).toHaveText('已符合下單資格，再消費 NT$4,040 即享免運。');

  await increaseQuantity.click();
  await increaseQuantity.click();
  await expect(page.getByRole('status')).toHaveText('✓ 已享免運優惠。');
  await expect(page.getByText('免運', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '前往結帳' })).toBeEnabled();
});

test('DB 的 is_pro_only=true 會讓原本公開商品變院線限定', async ({ page }) => {
  // 商品 id=2（胜肽修護精華液）在 PRODUCTS 常數裡 isProOnly=false
  // 模擬 DB 回傳 is_pro_only: true，前端應該讀 DB 值並限制非專業會員
  await mockEcladoApis(page, {
    products: mockProducts.map(p => p.id === 2 ? { ...p, is_pro_only: true } : p),
  });

  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await expect(page.getByText('院線專業商品')).toBeVisible();
  await expect(page.getByText('多重胜肽複合修護')).toBeVisible();
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
  await openCart(page);
  await expect(page.getByText('胜肽修護精華液')).toBeVisible();
  await expect(page.getByText('60ml')).toBeVisible();
  await expect(page.getByText('NT$ 6,880').first()).toBeVisible();
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
  await openCart(page);
  await expect(page.getByText('胜肽修護精華液')).toBeVisible();

  products = products.map(product => product.id === 2 ? { ...product, active: false } : product);
  await triggerProductsRealtime(page);

  await expect(page.getByText('購物車是空的')).toBeVisible();
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
  await openCart(page);
  await expect(page.getByText('胜肽修護精華液')).toBeVisible();
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
});

test('後端成交價與預覽不同時必須再次確認才建立付款單', async ({ page }) => {
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
  await expect(page.getByRole('alert')).toContainText('成交金額已由後端更新');
  await expect(page.getByText('付款單已建立')).toHaveCount(0);
  expect(paymentRequests).toHaveLength(0);

  await page.getByRole('button', { name: /確認更新後金額並建立付款單/ }).click();
  await expect(page.getByText('付款單已建立')).toBeVisible();
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
  expect(capturedOrder?.total).toBe(3702);
  expect(capturedOrder?.promotion_name).toBe('E2E 測試活動');
  const items = capturedOrder?.items as Array<Record<string, unknown>>;
  expect(items[0].stock_at_order).toBe(2);
  expect(orderEmails).toEqual([]);
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
  await page.goBack();
  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(sessionStorage.getItem('eclado_pending_payment') || 'null');
    return {
      orderNo: stored?.orderNo,
      hasToken: !!stored?.paymentToken,
      amount: stored?.amount,
      method: stored?.method,
    };
  })).toEqual({
    orderNo: orderNo?.trim(),
    hasToken: true,
    amount: 3702,
    method: 'card',
  });

  await page.goto(`/payment-result?orderNo=${encodeURIComponent(orderNo?.trim() || '')}&result=paid`);
  await expect(page.getByRole('heading', { name: '付款成功' })).toBeVisible();
  await expect(page.getByText('付款金額：')).toContainText('NT$ 3,702');
  expect(await page.evaluate(() => sessionStorage.getItem('eclado_pending_payment'))).toBeNull();
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
