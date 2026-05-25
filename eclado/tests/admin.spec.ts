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
  if (await mobileMenu.isVisible()) await mobileMenu.click();
  await page.getByRole('button', { name }).click();
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

test('訂單管理可查看明細並更新狀態', async ({ page }) => {
  const orderUpdates: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    onOrderUpdate: update => orderUpdates.push(update),
  });

  await page.goto('/admin');
  await openAdminSection(page, /訂單管理/);
  await expect(page.getByText('E2E-ORDER-001')).toBeVisible();
  await page.getByText('E2E-ORDER-001').click();
  await expect(page.getByText('訂單詳情')).toBeVisible();

  await page.locator('.detail-panel select').selectOption('paid');

  await expect.poll(() => orderUpdates.some(update => update.status === 'paid')).toBe(true);
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
    onOrderUpdate: update => orderUpdates.push(update),
  });

  await page.goto('/admin');
  await openAdminSection(page, /訂單管理/);
  await page.getByText('E2E-ORDER-001').click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '取消訂單' }).click();

  await expect.poll(() => orderUpdates.some(update => update.status === 'cancelled')).toBe(true);
});

test('訂單改為已付款會送出 LINE 付款通知，LINE 失敗時顯示訊息', async ({ page }) => {
  const linePushes: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    orders: [{ ...adminOrderRows[1], status: 'awaiting_confirm' }],
    onLinePush: body => linePushes.push(body),
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
  await expect(page.getByText('LINE 通知送出失敗：測試推播失敗')).toBeVisible();
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
  await openAdminSection(page, /商品 & 庫存/);
  await expect(page.getByText('胜肽修護精華液').first()).toBeVisible();
  await page.getByText('胜肽修護精華液').locator('xpath=ancestor::tr').getByRole('button', { name: '修改庫存' }).click();
  await page.locator('input[type="number"]').fill('12');
  await page.getByRole('button', { name: '✓' }).click();

  await expect(page.getByText('胜肽修護精華液').locator('xpath=ancestor::tr').getByText('12')).toBeVisible();
  await expect.poll(() => productUpdates.some(update => update.stock === 12)).toBe(true);
});

test('商品管理可編輯名稱、價格與院線限定並同步 products 更新', async ({ page }) => {
  const productUpdates: Record<string, unknown>[] = [];
  await mockAdminApis(page, {
    onProductUpdate: update => productUpdates.push(update),
  });

  await page.goto('/admin');
  await openAdminSection(page, /商品 & 庫存/);
  const productRow = page.getByText('胜肽修護精華液').locator('xpath=ancestor::tr');
  await productRow.getByRole('button', { name: '編輯' }).click();

  const panel = page.locator('.detail-panel');
  await panel.locator('input').nth(0).fill('胜肽全效修護精華液');
  await panel.locator('input[type="number"]').nth(0).fill('4200');
  await panel.locator('input[type="number"]').nth(1).fill('3100');
  await panel.getByLabel(/院線限定/).check();
  await panel.getByRole('button', { name: '儲存' }).click();

  await expect.poll(() => productUpdates.some(update =>
    update.name_zh === '胜肽全效修護精華液' &&
    update.price === 4200 &&
    update.pro_price === 3100 &&
    update.is_pro_only === true,
  )).toBe(true);
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
