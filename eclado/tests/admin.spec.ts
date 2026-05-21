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

test('訂單管理可查看明細並更新狀態', async ({ page }) => {
  const orderUpdates: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    onOrderUpdate: update => orderUpdates.push(update),
  });

  await page.goto('/admin');
  await page.getByRole('button', { name: /訂單管理/ }).click();
  await expect(page.getByText('E2E-ORDER-001')).toBeVisible();
  await page.getByText('E2E-ORDER-001').click();
  await expect(page.getByText('訂單詳情')).toBeVisible();

  await page.locator('.detail-panel select').selectOption('paid');

  await expect.poll(() => orderUpdates.some(update => update.status === 'paid')).toBe(true);
  await expect(page.getByText('已付款').first()).toBeVisible();
});

test('出貨可寫入托運單號並送出 LINE 通知', async ({ page }) => {
  const orderUpdates: Record<string, unknown>[] = [];
  const linePushes: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    onOrderUpdate: update => orderUpdates.push(update),
    onLinePush: body => linePushes.push(body),
  });

  await page.goto('/admin');
  await page.getByRole('button', { name: /訂單管理/ }).click();
  await page.getByRole('button', { name: '已付款' }).click();
  await page.getByText('E2E-ORDER-002').click();
  await page.getByPlaceholder('輸入順豐托運單號（選填）').fill('SF987654321');
  await page.getByRole('button', { name: '確認出貨' }).click();

  await expect(page.getByText('LINE 出貨通知已送出。')).toBeVisible();
  await expect(page.getByText('目前：')).toBeVisible();
  await expect(page.getByText('SF987654321')).toBeVisible();
  await expect.poll(() => orderUpdates.some(update =>
    update.status === 'shipped' && update.tracking === 'SF987654321',
  )).toBe(true);
  expect(linePushes).toContainEqual(expect.objectContaining({
    type: 'shipment',
    lineUserId: 'U1234567890',
    orderId: 'E2E-ORDER-002',
    tracking: 'SF987654321',
  }));
});

test('商品庫存可在後台修改並同步 products 更新', async ({ page }) => {
  const productUpdates: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    onProductUpdate: update => productUpdates.push(update),
  });

  await page.goto('/admin');
  await page.getByRole('button', { name: /商品 & 庫存/ }).click();
  await expect(page.getByText('胜肽修護精華液').first()).toBeVisible();
  await page.getByText('胜肽修護精華液').locator('xpath=ancestor::tr').getByRole('button', { name: '修改庫存' }).click();
  await page.locator('input[type="number"]').fill('12');
  await page.getByRole('button', { name: '✓' }).click();

  await expect(page.getByText('胜肽修護精華液').locator('xpath=ancestor::tr').getByText('12')).toBeVisible();
  await expect.poll(() => productUpdates.some(update => update.stock === 12)).toBe(true);
});

test('活動管理可停用、建立活動並送出正確 payload', async ({ page }) => {
  const promotionUpdates: Record<string, unknown>[] = [];
  const promotionInserts: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    onPromotionUpdate: update => promotionUpdates.push(update),
    onPromotionInsert: promo => promotionInserts.push(promo),
  });

  await page.goto('/admin');
  await page.getByRole('button', { name: /活動管理/ }).click();
  await expect(page.getByText('E2E 測試活動')).toBeVisible();
  await page.getByLabel('啟用').click({ force: true });
  await expect.poll(() => promotionUpdates.some(update => update.active === false)).toBe(true);

  await page.getByRole('button', { name: '+ 新增活動' }).click();
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

test('活動排程：建立活動時可設上架 / 下架時間並送出正確 payload', async ({ page }) => {
  const promotionInserts: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    onPromotionInsert: promo => promotionInserts.push(promo),
  });

  await page.goto('/admin');
  await page.getByRole('button', { name: /活動管理/ }).click();
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

test('活動排程：排程中活動顯示「排程中」badge，已結束顯示「已結束」', async ({ page }) => {
  await mockAdminApis(page, {
    promotions: [
      { ...activePromotion, id: 'future-promo', name: '未來活動', start_at: '2099-01-01T00:00:00.000Z', end_at: null },
      { ...activePromotion, id: 'past-promo', name: '過期活動', start_at: null, end_at: '2020-01-01T00:00:00.000Z' },
    ],
  });

  await page.goto('/admin');
  await page.getByRole('button', { name: /活動管理/ }).click();

  const futureCard = page.locator('div').filter({ hasText: '未來活動' }).first();
  await expect(futureCard.getByText('排程中')).toBeVisible();

  const pastCard = page.locator('div').filter({ hasText: '過期活動' }).first();
  await expect(pastCard.getByText('已結束')).toBeVisible();
});

test('後台核准美容師申請會同步 application status 與 profiles.role', async ({ page }) => {
  const profileUpdates: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    onProfileUpdate: update => profileUpdates.push(update),
  });

  await page.goto('/admin');
  await page.getByRole('button', { name: /會員管理/ }).click();
  await page.getByRole('button', { name: /待審核申請/ }).click();
  await page.getByText('審核中會員').click();
  await expect(page.getByText('審核中工作室')).toBeVisible();
  await page.getByRole('button', { name: '核准' }).click();

  await expect.poll(() => profileUpdates.some(update => update.role === 'pro')).toBe(true);
});
