import { expect, test, type Page } from '@playwright/test';
import {
  activePromotion,
  adminApplicationRows,
  adminOrderRows,
  adminProductRows,
  adminProfileRows,
  mockEcladoApis,
  type MockAuthUser,
} from './support/eclado-mocks';

function adminUser(): MockAuthUser {
  return {
    id: 'admin-user-1',
    email: 'baby90522@gmail.com',
    user_metadata: { name: '管理員' },
    app_metadata: { provider: 'email' },
    aud: 'authenticated',
    role: 'authenticated',
    created_at: '2026-05-01T00:00:00.000Z',
  };
}

function normalUser(): MockAuthUser {
  return {
    id: 'normal-user-1',
    email: 'not-admin@example.com',
    user_metadata: { name: '非管理員' },
    app_metadata: { provider: 'email' },
    aud: 'authenticated',
    role: 'authenticated',
    created_at: '2026-05-01T00:00:00.000Z',
  };
}

async function mockAdminApis(
  page: Page,
  hooks: Parameters<typeof mockEcladoApis>[1] = {},
) {
  await mockEcladoApis(page, {
    authUser: adminUser(),
    products: adminProductRows,
    orders: adminOrderRows,
    profiles: adminProfileRows,
    applications: adminApplicationRows,
    promotions: [activePromotion],
    ...hooks,
  });
}

async function openAdminSection(page: Page, name: RegExp) {
  const mobileMenu = page.getByRole('button', { name: '開啟選單' });
  if ((page.viewportSize()?.width || 0) <= 900) {
    await expect(mobileMenu).toBeVisible();
    await mobileMenu.click();
    await expect(page.locator('.app-sidebar')).toHaveClass(/\bopen\b/);
  }
  await page.getByRole('button', { name }).click();
}

const adminProductVariants = [
  { id: 101, product_id: 1, sku: 'FOAM-200', size: '200ml', price: 1280, pro_price: 960, stock: 48, is_default: true, sort_order: 0, active: true },
  { id: 201, product_id: 2, sku: 'SERUM-30', size: '30ml', price: 3980, pro_price: 2980, stock: 2, is_default: true, sort_order: 0, active: true },
  { id: 701, product_id: 7, sku: 'NK-10', size: '3.5ml×10', price: 8800, pro_price: 6600, stock: 0, is_default: true, sort_order: 0, active: true },
];

test('後台登入權限：非管理員擋下，管理員可進入', async ({ page }) => {
  await mockEcladoApis(page, {
    signInUser: normalUser(),
    products: adminProductRows,
    orders: adminOrderRows,
    profiles: adminProfileRows,
    applications: adminApplicationRows,
  });

  await page.goto('/admin');
  await expect(page.getByText('管理後台 · 請登入')).toBeVisible();
  await page.locator('input[type="email"]').fill('not-admin@example.com');
  await page.locator('input[type="password"]').fill('password123');
  await page.getByRole('button', { name: '進入後台' }).click();
  await expect(page.getByText('此帳號無管理員權限')).toBeVisible();

  await page.close();
});

test('後台登入權限：管理員 session 可進入儀表板', async ({ page }) => {
  await mockAdminApis(page);

  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '儀表板' })).toBeVisible();
  await expect(page.getByText('baby90522@gmail.com')).toBeVisible();
});

test('後台權限以資料庫 allow-list 為準，不再只相信管理員 Email', async ({ page }) => {
  await mockAdminApis(page, {
    authUser: adminUser(),
    adminAccess: false,
  });

  await page.goto('/admin');
  await expect(page.getByText('管理後台 · 請登入')).toBeVisible();
  await expect(page.getByRole('heading', { name: '儀表板' })).toHaveCount(0);
});

test('商品、訂單與會員列表響應式切換，詳情使用抽屜且不撐寬頁面', async ({ page }) => {
  await mockAdminApis(page, { productVariants: adminProductVariants });
  await page.goto('/admin');

  const assertDrawer = async (label: string) => {
    const drawer = page.getByRole('dialog', { name: label });
    await expect(drawer).toBeVisible();
    const layout = await drawer.evaluate(element => ({
      position: getComputedStyle(element).position,
      width: element.getBoundingClientRect().width,
      viewportWidth: window.innerWidth,
      pageWidth: document.documentElement.scrollWidth,
    }));
    expect(layout.position).toBe('fixed');
    expect(layout.width).toBeLessThanOrEqual(layout.viewportWidth + 0.5);
    expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth + 0.5);
  };

  const assertResponsiveList = async () => {
    const table = page.locator('.responsive-admin-table').first();
    const layout = await table.evaluate(element => ({
      viewportWidth: window.innerWidth,
      headDisplay: getComputedStyle(element.querySelector('thead')!).display,
      rowDisplay: getComputedStyle(element.querySelector('tbody tr')!).display,
      pageWidth: document.documentElement.scrollWidth,
    }));
    expect(layout.pageWidth).toBeLessThanOrEqual(layout.viewportWidth + 0.5);
    if (layout.viewportWidth <= 1180) {
      expect(layout.headDisplay).toBe('none');
      expect(layout.rowDisplay).toBe('grid');
    } else {
      expect(layout.headDisplay).not.toBe('none');
      expect(layout.rowDisplay).toBe('table-row');
    }
  };

  await openAdminSection(page, /商品 & 庫存/);
  await assertResponsiveList();
  await page.getByText('胜肽修護精華液').locator('xpath=ancestor::tr').getByRole('button', { name: '編輯' }).click();
  await assertDrawer('編輯商品');
  await page.getByRole('dialog', { name: '編輯商品' }).getByRole('button', { name: '關閉商品編輯' }).click();
  await expect(page.getByRole('dialog', { name: '編輯商品' })).toHaveCount(0);

  await openAdminSection(page, /訂單管理/);
  await assertResponsiveList();
  await page.getByText('E2E-ORDER-001').first().click();
  await assertDrawer('訂單詳情');
  await page.getByRole('dialog', { name: '訂單詳情' }).getByRole('button', { name: '關閉訂單詳情' }).click();

  await openAdminSection(page, /會員管理/);
  await assertResponsiveList();
  await page.getByRole('cell', { name: '測試會員' }).click();
  await assertDrawer('會員詳情');
  await page.getByRole('dialog', { name: '會員詳情' }).getByRole('button', { name: '關閉會員詳情' }).click();
});

test('儀表板顯示待處理資訊，點待審核申請可前往會員審核列表', async ({ page }) => {
  await mockAdminApis(page);

  await page.goto('/admin');
  await expect(page.getByText('可安排後續出貨')).toBeVisible();
  await expect(page.getByText('點擊前往會員管理審核')).toBeVisible();
  await expect(page.getByText('胜肽修護精華液').first()).toBeVisible();

  await page.getByText('點擊前往會員管理審核').click();
  await expect(page.getByRole('heading', { name: '會員管理' })).toBeVisible();
  await expect(page.getByText('審核中會員')).toBeVisible();
});

test('儀表板營業額與庫存警示固定上下排列，庫存內容獨立水平捲動', async ({ page }) => {
  const lowStockProducts = Array.from({ length: 10 }, (_, index) => ({
    ...adminProductRows[index % adminProductRows.length],
    id: 100 + index,
    name_zh: `低庫存測試商品 ${index + 1}`,
    stock: 0,
    min_stock: 3,
  }));
  await mockAdminApis(page, { products: lowStockProducts });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/admin');

  const revenuePanel = page.getByTestId('dashboard-revenue-panel');
  const stockPanel = page.getByTestId('dashboard-low-stock-panel');
  const stockScroll = page.getByTestId('dashboard-low-stock-scroll');
  const revenueBox = await revenuePanel.boundingBox();
  const stockBox = await stockPanel.boundingBox();

  expect(revenueBox).not.toBeNull();
  expect(stockBox).not.toBeNull();
  expect(stockBox!.y).toBeGreaterThan(revenueBox!.y + revenueBox!.height);
  expect(Math.abs(stockBox!.x - revenueBox!.x)).toBeLessThan(2);
  expect(Math.abs(stockBox!.width - revenueBox!.width)).toBeLessThan(2);

  const overflow = await stockScroll.evaluate(element => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    pageClientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);
  expect(overflow.pageScrollWidth).toBeLessThanOrEqual(overflow.pageClientWidth);
});

test('訂單管理可查看明細並更新狀態', async ({ page }) => {
  const orderUpdates: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    onOrderUpdate: update => orderUpdates.push(update),
  });

  await page.goto('/admin');
  await openAdminSection(page, /訂單管理/);
  await expect(page.getByText('E2E-ORDER-001').first()).toBeVisible();
  await page.getByText('E2E-ORDER-001').click();
  await expect(page.getByText('訂單詳情')).toBeVisible();

  await page.locator('.detail-panel select').selectOption('paid');

  await expect.poll(() => orderUpdates.some(update => update.status === 'paid')).toBe(true);
  expect(await page.getByRole('button', { name: '已付款' }).evaluate(button => button.style.background)).toBe('var(--dark)');
  await expect(page.getByRole('cell', { name: 'E2E-ORDER-001' })).toBeVisible();
  await expect(page.getByText('已付款').first()).toBeVisible();
});

test('訂單管理可依狀態與預購庫存篩選', async ({ page }) => {
  await mockAdminApis(page, {
    orders: [
      ...adminOrderRows,
      {
        ...adminOrderRows[0],
        id: 'E2E-PREORDER-003',
        items: [{ name: '預購測試商品', qty: 1, price: 1280, fulfillment_type: 'preorder' }],
      },
    ],
  });

  await page.goto('/admin');
  await openAdminSection(page, /訂單管理/);
  await page.getByRole('button', { name: '全部' }).first().click();
  await page.getByRole('button', { name: /含預購/ }).click();

  await expect(page.getByText('E2E-PREORDER-003')).toBeVisible();
  await expect(page.getByText('E2E-ORDER-002')).toHaveCount(0);
});

test('訂單管理可取消訂單並同步 cancelled 狀態', async ({ page }) => {
  const orderUpdates: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    orders: [{ ...adminOrderRows[0], status: 'paid' }],
    onOrderUpdate: update => orderUpdates.push(update),
  });

  await page.goto('/admin');
  await openAdminSection(page, /訂單管理/);
  await page.getByRole('button', { name: '已付款' }).click();
  await page.getByText('E2E-ORDER-001').click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '取消訂單' }).click();

  await expect.poll(() => orderUpdates.some(update => update.status === 'cancelled')).toBe(true);
});

test('訂單改為已付款會送出 LINE 付款通知，LINE 失敗時改寄 Email', async ({ page }) => {
  const linePushes: Record<string, unknown>[] = [];
  const orderEmails: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    orders: [{ ...adminOrderRows[1], status: 'awaiting_confirm' }],
    onLinePush: body => linePushes.push(body),
    onOrderEmail: body => orderEmails.push(body),
    linePushError: '測試推播失敗',
  });

  await page.goto('/admin');
  await openAdminSection(page, /訂單管理/);
  await page.getByText('E2E-ORDER-002').click();
  await page.locator('.detail-panel select').selectOption('paid');

  await expect.poll(() => linePushes.length).toBe(1);
  expect(linePushes[0]).toMatchObject({
    type: 'payment_paid',
    lineUserId: 'U1234567890',
    orderId: 'E2E-ORDER-002',
  });
  await expect(page.getByText('Email 付款完成通知已送出。')).toBeVisible();
  expect(orderEmails).toContainEqual(expect.objectContaining({
    type: 'payment_paid',
    orderId: 'E2E-ORDER-002',
  }));
});

test('出貨可寫入托運單號並送出 LINE 通知', async ({ page }) => {
  const orderUpdates: Record<string, unknown>[] = [];
  const linePushes: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    onOrderUpdate: update => orderUpdates.push(update),
    onLinePush: body => linePushes.push(body),
  });

  await page.goto('/admin');
  await openAdminSection(page, /訂單管理/);
  await page.getByRole('button', { name: '已付款' }).click();
  await page.getByText('E2E-ORDER-002').click();
  await page.getByPlaceholder('輸入順豐托運單號（必填）').fill('SF987654321');
  await page.getByRole('button', { name: '確認出貨' }).click();

  await expect(page.getByText('LINE 出貨通知已送出。')).toBeVisible();
  await expect(page.getByText('目前：')).toBeVisible();
  await expect(page.getByText('SF987654321')).toBeVisible();
  await expect(page.getByRole('link', { name: 'SF987654321' })).toHaveAttribute(
    'href',
    'https://htm.sf-express.com/tw/tc/',
  );
  await expect(page.getByText(/通知已發送：/)).toBeVisible();
  await expect.poll(() => orderUpdates.some(update =>
    update.status === 'shipped' && update.tracking === 'SF987654321',
  )).toBe(true);
  await expect.poll(() => orderUpdates.some(update =>
    typeof update.shipment_notification_sent_at === 'string'
      && update.shipment_notification_channel === 'line',
  )).toBe(true);
  expect(linePushes).toContainEqual(expect.objectContaining({
    type: 'shipment',
    lineUserId: 'U1234567890',
    orderId: 'E2E-ORDER-002',
    tracking: 'SF987654321',
  }));

  await page.getByRole('button', { name: '重新發送出貨通知' }).click();
  await expect.poll(() => linePushes.length).toBe(2);
});

test('未填托運單號不能確認出貨或發送通知', async ({ page }) => {
  const orderUpdates: Record<string, unknown>[] = [];
  const linePushes: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    onOrderUpdate: update => orderUpdates.push(update),
    onLinePush: body => linePushes.push(body),
  });

  await page.goto('/admin');
  await openAdminSection(page, /訂單管理/);
  await page.getByRole('button', { name: '已付款' }).click();
  await page.getByText('E2E-ORDER-002').click();
  await page.getByRole('button', { name: '確認出貨' }).click();

  await expect(page.getByText('請輸入順豐托運單號，再確認出貨。')).toBeVisible();
  expect(orderUpdates.some(update => update.status === 'shipped')).toBe(false);
  expect(linePushes).toHaveLength(0);
});

test('已有成功通知紀錄時不會自動重複發送', async ({ page }) => {
  const linePushes: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    orders: [{
      ...adminOrderRows[1],
      status: 'preparing',
      tracking: 'SF-DUPLICATE-GUARD',
      shipped_at: '2026-05-21T03:00:00.000Z',
      shipment_notification_sent_at: '2026-05-21T03:01:00.000Z',
      shipment_notification_channel: 'line',
    }],
    onLinePush: body => linePushes.push(body),
  });

  await page.goto('/admin');
  await openAdminSection(page, /訂單管理/);
  await page.getByRole('button', { name: '備貨中' }).click();
  await page.getByText('E2E-ORDER-002').click();
  await page.locator('.detail-panel select').selectOption('shipped');

  await expect(page.getByText(/出貨通知已於.*發送/)).toBeVisible();
  expect(linePushes).toHaveLength(0);
});

test('沒有 LINE 綁定的訂單出貨會送出 Email 通知', async ({ page }) => {
  const orderUpdates: Record<string, unknown>[] = [];
  const orderEmails: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    orders: [{ ...adminOrderRows[0], status: 'paid', tracking: '' }],
    onOrderUpdate: update => orderUpdates.push(update),
    onOrderEmail: body => orderEmails.push(body),
  });

  await page.goto('/admin');
  await openAdminSection(page, /訂單管理/);
  await page.getByRole('button', { name: '已付款' }).click();
  await page.getByText('E2E-ORDER-001').click();
  await page.getByPlaceholder('輸入順豐托運單號（必填）').fill('SF111222333');
  await page.getByRole('button', { name: '確認出貨' }).click();

  await expect(page.getByText('Email 出貨通知已送出。')).toBeVisible();
  await expect.poll(() => orderUpdates.some(update =>
    update.status === 'shipped' && update.tracking === 'SF111222333',
  )).toBe(true);
  expect(orderEmails).toContainEqual(expect.objectContaining({
    type: 'shipment',
    email: 'member@example.com',
    orderId: 'E2E-ORDER-001',
    tracking: 'SF111222333',
  }));
});

test('商品庫存可在規格表格修改並透過交易式 RPC 儲存', async ({ page }) => {
  let savedRequest: Record<string, any> | null = null;
  await mockAdminApis(page, {
    productVariants: adminProductVariants,
    onProductWithVariantsSave: request => { savedRequest = request; },
  });

  await page.goto('/admin');
  await openAdminSection(page, /商品 & 庫存/);
  await expect(page.getByText('胜肽修護精華液').first()).toBeVisible();
  await page.getByText('胜肽修護精華液').locator('xpath=ancestor::tr').getByRole('button', { name: '編輯' }).click();
  await page.getByLabel('規格 1 庫存').fill('12');
  await page.getByRole('button', { name: '儲存', exact: true }).click();

  await expect.poll(() => savedRequest).not.toBeNull();
  expect(savedRequest?.p_variants?.[0]).toMatchObject({ id: '201', stock: 12 });
});

test('商品庫存可依庫存狀態篩選', async ({ page }) => {
  await mockAdminApis(page);

  await page.goto('/admin');
  await openAdminSection(page, /商品 & 庫存/);

  const table = page.locator('.table-scroll').first();
  await expect(table.getByText('深層清潔泡沫洗面乳')).toBeVisible();
  await expect(table.getByText('胜肽修護精華液')).toBeVisible();
  await expect(table.getByText('NK細胞活化安瓶')).toBeVisible();

  await page.getByLabel('庫存狀態篩選').selectOption('low');
  await expect(table.getByText('胜肽修護精華液')).toBeVisible();
  await expect(table.getByText('深層清潔泡沫洗面乳')).toHaveCount(0);
  await expect(table.getByText('NK細胞活化安瓶')).toHaveCount(0);

  await page.getByLabel('庫存狀態篩選').selectOption('out');
  await expect(table.getByText('NK細胞活化安瓶')).toBeVisible();
  await expect(table.getByText('胜肽修護精華液')).toHaveCount(0);

  await page.getByLabel('庫存狀態篩選').selectOption('ok');
  await expect(table.getByText('深層清潔泡沫洗面乳')).toBeVisible();
  await expect(table.getByText('NK細胞活化安瓶')).toHaveCount(0);
});

test('商品管理可編輯名稱、規格價格與院線限定並透過 RPC 儲存', async ({ page }) => {
  let savedRequest: Record<string, any> | null = null;
  await mockAdminApis(page, {
    productVariants: adminProductVariants,
    onProductWithVariantsSave: request => { savedRequest = request; },
  });

  await page.goto('/admin');
  await openAdminSection(page, /商品 & 庫存/);
  const productRow = page.getByText('胜肽修護精華液').locator('xpath=ancestor::tr');
  await productRow.getByRole('button', { name: '編輯' }).click();

  const panel = page.locator('.detail-panel');
  await panel.getByLabel('中文名稱').fill('胜肽全效修護精華液');
  await panel.getByLabel('規格 1 市場價').fill('4200');
  await panel.getByLabel('規格 1 專業價').fill('3100');
  await panel.getByLabel(/院線限定/).check();
  await panel.getByRole('button', { name: '儲存' }).click();

  await expect.poll(() => savedRequest).not.toBeNull();
  expect(savedRequest?.p_product).toMatchObject({
    id: 2,
    name_zh: '胜肽全效修護精華液',
    is_pro_only: true,
  });
  expect(savedRequest?.p_variants?.[0]).toMatchObject({ price: 4200, pro_price: 3100 });
});

test('商品管理可從本機上傳圖片並以規格 RPC 建立草稿', async ({ page }) => {
  let savedRequest: Record<string, any> | null = null;
  let savedImagesRequest: Record<string, any> | null = null;
  await mockAdminApis(page, {
    productVariants: adminProductVariants,
    onProductWithVariantsSave: request => { savedRequest = request; },
    onProductImagesSave: request => { savedImagesRequest = request; },
  });

  await page.goto('/admin');
  await openAdminSection(page, /商品 & 庫存/);
  await page.getByRole('button', { name: '+ 新增商品' }).click();

  const panel = page.locator('.detail-panel');
  await panel.getByLabel('中文名稱').fill('E2E 新商品');
  await panel.getByLabel('英文名稱').fill('E2E New Product');
  await panel.getByLabel('規格 1 名稱').fill('50ml');
  await panel.getByLabel('規格 1 SKU').fill('E2E-50');
  await panel.getByLabel('規格 1 市場價').fill('1680');
  await panel.getByLabel('規格 1 專業價').fill('1280');
  await panel.getByLabel('規格 1 庫存').fill('20');
  await panel.getByLabel('低庫存警示值').fill('5');
  await panel.getByLabel('商品圖片').setInputFiles({
    name: 'e2e-product.png',
    mimeType: 'image/png',
    buffer: Buffer.from('e2e-image-data'),
  });
  await expect(panel.getByText('首圖', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '建立草稿' }).click();

  await expect.poll(() => savedRequest).not.toBeNull();
  expect(savedRequest?.p_product).toMatchObject({
    name: 'E2E New Product',
    name_zh: 'E2E 新商品',
    min_stock: 5,
    publication_status: 'draft',
  });
  expect(savedRequest?.p_variants?.[0]).toMatchObject({
    sku: 'E2E-50', size: '50ml', price: 1680, pro_price: 1280, stock: 20,
  });
  await expect.poll(() => savedImagesRequest).not.toBeNull();
  expect(savedImagesRequest?.p_images?.[0]).toMatchObject({
    original_name: 'e2e-product.png', mime_type: 'image/png', is_primary: true,
  });
});

test('商品圖片上傳會阻止未選圖片、非圖片與超過 5 MB 的檔案', async ({ page }) => {
  let savedRequest: Record<string, any> | null = null;
  await mockAdminApis(page, {
    productVariants: adminProductVariants,
    onProductWithVariantsSave: request => { savedRequest = request; },
  });

  await page.goto('/admin');
  await openAdminSection(page, /商品 & 庫存/);
  await page.getByRole('button', { name: '+ 新增商品' }).click();
  const panel = page.locator('.detail-panel');
  await panel.getByLabel('中文名稱').fill('無圖商品');
  await panel.getByLabel('英文名稱').fill('Missing Image Product');

  await panel.getByRole('button', { name: '建立草稿' }).click();
  await expect(page.getByText('請選擇至少一張商品圖片')).toBeVisible();

  await panel.getByLabel('商品圖片').setInputFiles({
    name: 'not-an-image.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not an image'),
  });
  await expect(page.getByText('不支援 not-an-image.txt，請使用 JPG、PNG 或 WebP')).toBeVisible();

  await panel.getByLabel('商品圖片').setInputFiles({
    name: 'too-large.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(page.getByText('too-large.png 超過 5 MB')).toBeVisible();
  expect(savedRequest).toBeNull();
});

test('新增商品寫入失敗時顯示錯誤且不加入商品清單', async ({ page }) => {
  await mockAdminApis(page, {
    productVariants: adminProductVariants,
    productWriteError: '測試商品新增失敗',
  });

  await page.goto('/admin');
  await openAdminSection(page, /商品 & 庫存/);
  await page.getByRole('button', { name: '+ 新增商品' }).click();
  const panel = page.locator('.detail-panel');
  await panel.getByLabel('中文名稱').fill('失敗商品');
  await panel.getByLabel('英文名稱').fill('Failed Product');
  await panel.getByLabel('規格 1 名稱').fill('50ml');
  await panel.getByLabel('規格 1 SKU').fill('FAILED-50');
  await panel.getByLabel('規格 1 市場價').fill('1000');
  await panel.getByLabel('規格 1 專業價').fill('800');
  await panel.getByLabel('商品圖片').setInputFiles({
    name: 'product.png',
    mimeType: 'image/png',
    buffer: Buffer.from('image'),
  });
  await panel.getByRole('button', { name: '建立草稿' }).click();

  await expect(page.getByText(/儲存商品失敗：測試商品新增失敗/)).toBeVisible();
  await expect(page.getByRole('table').getByText('失敗商品')).toHaveCount(0);
});

test('商品管理可下架、於已下架清單查看並重新上架商品', async ({ page }) => {
  const productUpdates: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    onProductUpdate: update => productUpdates.push(update),
  });

  await page.goto('/admin');
  await openAdminSection(page, /商品 & 庫存/);
  const productRow = page.getByText('胜肽修護精華液').locator('xpath=ancestor::tr');
  page.once('dialog', dialog => dialog.accept());
  await productRow.getByRole('button', { name: '下架' }).click();

  await expect.poll(() => productUpdates.some(update => update.publication_status === 'archived')).toBe(true);
  await expect(page.getByText('胜肽修護精華液')).toHaveCount(0);
  await page.getByRole('button', { name: /已下架/ }).click();
  const archivedRow = page.getByText('胜肽修護精華液').locator('xpath=ancestor::tr');
  await expect(archivedRow.getByText('已下架')).toBeVisible();
  await archivedRow.getByRole('button', { name: '重新上架' }).click();
  await expect.poll(() => productUpdates.some(update => update.publication_status === 'active')).toBe(true);
  await page.getByRole('button', { name: /上架中/ }).click();
  await expect(page.getByRole('table').getByText('胜肽修護精華液')).toBeVisible();
});

test('商品下架與重新上架寫入失敗時維持原清單狀態', async ({ page }) => {
  await mockAdminApis(page, {
    productWriteError: '測試狀態更新失敗',
    products: [
      ...adminProductRows,
      { ...adminProductRows[0], id: 88, name: 'Archived Item', name_zh: '已下架測試商品', active: false },
    ],
  });

  await page.goto('/admin');
  await openAdminSection(page, /商品 & 庫存/);
  const activeRow = page.getByText('胜肽修護精華液').locator('xpath=ancestor::tr');
  page.once('dialog', dialog => dialog.accept());
  await activeRow.getByRole('button', { name: '下架' }).click();
  await expect(page.getByText(/下架商品失敗：測試狀態更新失敗/)).toBeVisible();
  await expect(page.getByRole('table').getByText('胜肽修護精華液')).toBeVisible();

  await page.getByRole('button', { name: /已下架/ }).click();
  const archivedRow = page.getByText('已下架測試商品').locator('xpath=ancestor::tr');
  await archivedRow.getByRole('button', { name: '重新上架' }).click();
  await expect(page.getByText(/重新上架失敗：測試狀態更新失敗/)).toBeVisible();
  await expect(page.getByRole('table').getByText('已下架測試商品')).toBeVisible();
});

test('活動管理可建立活動並送出正確 payload', async ({ page }) => {
  const promotionInserts: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    onPromotionInsert: promo => promotionInserts.push(promo),
  });

  await page.goto('/admin');
  await openAdminSection(page, /活動管理/);
  await expect(page.getByText('E2E 測試活動')).toBeVisible();
  await expect(page.getByLabel('啟用')).toHaveCount(0);
  await expect(page.getByText('啟用此活動')).toHaveCount(0);

  await page.getByRole('button', { name: '+ 新增活動' }).click();
  await expect(page.getByText('啟用此活動')).toHaveCount(0);
  await page.locator('input[placeholder="例：五月慶 95折再折千"]').fill('E2E 新活動');
  await page.locator('textarea[placeholder="顯示給顧客看的說明文字"]').fill('活動測試');
  await page.locator('input[type="number"]').nth(0).fill('0.8');
  await page.locator('input[type="number"]').nth(1).fill('50');
  await page.getByLabel('折扣計算順序').selectOption('amount_then_rate');
  await expect(page.getByText(/活動商品小計 −/)).toBeVisible();
  await page.getByRole('button', { name: '清除' }).click();
  await page.getByText('胜肽修護精華液').click();
  await page.getByRole('button', { name: '建立活動' }).click();

  await expect.poll(() => promotionInserts.length).toBe(1);
  expect(promotionInserts[0]).toMatchObject({
    name: 'E2E 新活動',
    description: '活動測試',
    discount_rate: 0.8,
    discount_amount: 50,
    discount_order: 'amount_then_rate',
    active: true,
  });
  expect(promotionInserts[0].product_ids).toEqual([2]);
});

test('活動管理可編輯既有活動並更新折扣公式', async ({ page }) => {
  const promotionUpdates: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    onPromotionUpdate: update => promotionUpdates.push(update),
  });

  await page.goto('/admin');
  await openAdminSection(page, /活動管理/);
  await page.getByRole('button', { name: '編輯' }).click();
  await page.locator('textarea[placeholder="顯示給顧客看的說明文字"]').fill('更新後活動說明');
  await page.locator('input[type="number"]').nth(0).fill('0.75');
  await page.locator('input[type="number"]').nth(1).fill('200');
  await page.getByLabel('折扣計算順序').selectOption('amount_then_rate');
  await page.getByRole('button', { name: '儲存變更' }).click();

  await expect.poll(() => promotionUpdates.length).toBe(1);
  expect(promotionUpdates[0]).toMatchObject({
    description: '更新後活動說明',
    discount_rate: 0.75,
    discount_amount: 200,
    discount_order: 'amount_then_rate',
  });
});

test('活動管理可刪除活動', async ({ page }) => {
  const promotionDeletes: string[] = [];
  await mockAdminApis(page, {
    onPromotionDelete: url => promotionDeletes.push(url),
  });

  await page.goto('/admin');
  await openAdminSection(page, /活動管理/);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '刪除' }).click();

  await expect.poll(() => promotionDeletes.length).toBe(1);
  expect(promotionDeletes[0]).toContain('id=eq.');
  expect(promotionDeletes[0]).toContain(activePromotion.id);
});

test('活動管理遇到 discount_order 欄位未建立時顯示 migration 提示', async ({ page }) => {
  await mockAdminApis(page, {
    promotionWriteError: "Could not find the 'discount_order' column of 'promotions' in the schema cache",
  });

  await page.goto('/admin');
  await openAdminSection(page, /活動管理/);
  await page.getByRole('button', { name: '+ 新增活動' }).click();
  await page.locator('input[placeholder="例：五月慶 95折再折千"]').fill('欄位錯誤活動');
  await page.getByRole('button', { name: '清除' }).click();
  await page.getByText('胜肽修護精華液').click();
  await page.getByRole('button', { name: '建立活動' }).click();

  await expect(page.getByText(/supabase-promotions-discount-order\.sql/)).toBeVisible();
});

test('活動排程：建立活動時可設上架 / 下架時間並送出正確 payload', async ({ page }) => {
  const promotionInserts: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    onPromotionInsert: promo => promotionInserts.push(promo),
  });

  await page.goto('/admin');
  await openAdminSection(page, /活動管理/);
  await page.getByRole('button', { name: '+ 新增活動' }).click();
  await page.locator('input[placeholder="例：五月慶 95折再折千"]').fill('排程測試活動');
  await page.locator('input[type="number"]').nth(0).fill('0.9');
  await page.locator('input[type="number"]').nth(1).fill('0');
  await page.getByRole('button', { name: '清除' }).click();
  await page.getByText('胜肽修護精華液').click();

  await page.locator('input[type="datetime-local"]').nth(0).fill('2030-01-01T10:00');
  await page.locator('input[type="datetime-local"]').nth(1).fill('2030-12-31T23:59');

  await page.getByRole('button', { name: '建立活動' }).click();

  await expect.poll(() => promotionInserts.length).toBe(1);
  expect(promotionInserts[0].name).toBe('排程測試活動');
  expect(promotionInserts[0].start_at).toBe(new Date('2030-01-01T10:00').toISOString());
  expect(promotionInserts[0].end_at).toBe(new Date('2030-12-31T23:59').toISOString());
});

test('活動排程：下架時間不晚於上架時間時阻止儲存', async ({ page }) => {
  const promotionInserts: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    onPromotionInsert: promo => promotionInserts.push(promo),
  });

  await page.goto('/admin');
  await openAdminSection(page, /活動管理/);
  await page.getByRole('button', { name: '+ 新增活動' }).click();
  await page.locator('input[placeholder="例：五月慶 95折再折千"]').fill('錯誤排程活動');
  await page.getByRole('button', { name: '清除' }).click();
  await page.getByText('胜肽修護精華液').click();
  await page.locator('input[type="datetime-local"]').nth(0).fill('2030-12-31T23:59');
  await page.locator('input[type="datetime-local"]').nth(1).fill('2030-01-01T10:00');
  await page.getByRole('button', { name: '建立活動' }).click();

  await expect(page.getByText('下架時間必須晚於上架時間')).toBeVisible();
  expect(promotionInserts).toHaveLength(0);
});

test('活動排程：排程中活動顯示「排程中」badge，已結束顯示「已結束」', async ({ page }) => {
  await mockAdminApis(page, {
    promotions: [
      { ...activePromotion, id: 'future-promo', name: '未來活動', start_at: '2099-01-01T00:00:00.000Z', end_at: null },
      { ...activePromotion, id: 'past-promo', name: '過期活動', start_at: null, end_at: '2020-01-01T00:00:00.000Z' },
    ],
  });

  await page.goto('/admin');
  await openAdminSection(page, /活動管理/);

  const futureCard = page.locator('div').filter({ hasText: '未來活動' }).first();
  await expect(futureCard.getByText('排程中')).toBeVisible();

  const pastCard = page.locator('div').filter({ hasText: '過期活動' }).first();
  await expect(pastCard.getByText('已結束')).toBeVisible();
});

test('後台核准美容師申請會同步 application status 與 profiles.role', async ({ page }) => {
  const profileUpdates: Record<string, unknown>[] = [];
  const applicationUpdates: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    onProfileUpdate: update => profileUpdates.push(update),
    onApplicationUpdate: update => applicationUpdates.push(update),
  });

  await page.goto('/admin');
  await openAdminSection(page, /會員管理/);
  await page.getByRole('button', { name: /待審核申請/ }).click();
  await page.getByText('審核中會員').click();
  await expect(page.getByText('審核中工作室')).toBeVisible();
  await page.getByRole('button', { name: '核准' }).click();

  await expect.poll(() => applicationUpdates.some(update => update.status === 'approved')).toBe(true);
  await expect.poll(() => profileUpdates.some(update => update.role === 'pro')).toBe(true);
});

test('後台拒絕美容師申請會同步 rejected 與 consumer', async ({ page }) => {
  const profileUpdates: Record<string, unknown>[] = [];
  const applicationUpdates: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    onProfileUpdate: update => profileUpdates.push(update),
    onApplicationUpdate: update => applicationUpdates.push(update),
  });

  await page.goto('/admin');
  await openAdminSection(page, /會員管理/);
  await page.getByRole('button', { name: /待審核申請/ }).click();
  await page.getByText('審核中會員').click();
  await page.getByRole('button', { name: '拒絕' }).click();

  await expect.poll(() => applicationUpdates.some(update => update.status === 'rejected')).toBe(true);
  await expect.poll(() => profileUpdates.some(update => update.role === 'consumer')).toBe(true);
});

test('會員管理可手動切換會員類型並同步 profile role', async ({ page }) => {
  const profileUpdates: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    profiles: [{
      ...adminProfileRows[0],
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }],
    applications: [],
    onProfileUpdate: update => profileUpdates.push(update),
  });

  await page.goto('/admin');
  await openAdminSection(page, /會員管理/);
  await page.getByText('測試會員').click();
  await page.getByRole('button', { name: '經銷商' }).last().click();

  await expect.poll(() => profileUpdates.some(update => update.role === 'distributor')).toBe(true);
});

test('會員管理可刪除會員並同步資料庫', async ({ page }) => {
  const deletedMemberIds: string[] = [];
  await mockAdminApis(page, {
    onMemberDelete: memberId => deletedMemberIds.push(memberId),
  });
  page.on('dialog', dialog => dialog.accept());

  await page.goto('/admin');
  await openAdminSection(page, /會員管理/);
  await page.getByRole('cell', { name: '測試會員' }).click();
  await page.getByRole('button', { name: '刪除會員' }).click();

  await expect.poll(() => deletedMemberIds).toContain('user-consumer-1');
  await expect(page.getByRole('cell', { name: '測試會員' })).toHaveCount(0);
});

test('營業分析與 AI 補貨頁面可使用，AI 回應由本地 stub 提供', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).claude = {
      complete: async () => JSON.stringify([
        { name: '胜肽修護精華液', qty: 8, urgency: '緊急', reason: '庫存偏低，建議先補貨。' },
      ]),
    };
  });
  await mockAdminApis(page);

  await page.goto('/admin');
  await openAdminSection(page, /營業分析/);
  await expect(page.getByRole('heading', { name: '營業分析' })).toBeVisible();
  await expect(page.getByText('月營業額趨勢')).toBeVisible();

  await openAdminSection(page, /AI 補貨建議/);
  await expect(page.getByRole('heading', { name: 'AI 補貨建議' })).toBeVisible();
  await page.getByRole('button', { name: /開始 AI 分析/ }).first().click();
  await expect(page.getByText('AI 分析結果')).toBeVisible();
  await page.getByText('胜肽修護精華液').last().click();
  await expect(page.getByText('庫存偏低，建議先補貨。')).toBeVisible();
});
