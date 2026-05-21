import { expect, test } from '@playwright/test';
import { mockEcladoApis, type MockAuthUser } from './support/eclado-mocks';

const FAKE_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function fakeAuthUser(role: 'pending' | 'consumer', email: string) {
  return {
    id: FAKE_USER_ID,
    email,
    user_metadata: { role },
    app_metadata: { provider: 'email' },
    aud: 'authenticated',
    role: 'authenticated',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    confirmation_sent_at: '2026-01-01T00:00:00.000Z',
  };
}

function loggedInUser(email: string): MockAuthUser {
  return {
    id: FAKE_USER_ID,
    email,
    user_metadata: { name: '測試會員' },
    app_metadata: { provider: 'email' },
    aud: 'authenticated',
    role: 'authenticated',
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function loggedInProfile(role: 'pending' | 'pro') {
  return {
    id: FAKE_USER_ID,
    email: `${role}@example.com`,
    name: role === 'pro' ? '已是美容師' : '審核中會員',
    phone: '0912345678',
    role,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function consumerProfile() {
  return {
    id: FAKE_USER_ID,
    email: 'consumer@example.com',
    name: '一般會員',
    phone: '0912345678',
    role: 'consumer',
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function signupRole(body: Record<string, unknown> | null) {
  const record = body as { data?: { role?: string }; options?: { data?: { role?: string } } } | null;
  return record?.data?.role || record?.options?.data?.role;
}

// ─── 美容師欄位顯示 / 隱藏 ───────────────────────────────────────────────────

test.describe('美容師欄位顯示', () => {
  test.beforeEach(async ({ page }) => {
    await mockEcladoApis(page);
  });

  test('一般會員註冊表單不顯示美容師申請欄位', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: '註冊' }).click();

    await expect(page.getByText('皮膚管理院 / 工作室名稱')).not.toBeVisible();
    await expect(page.getByText('IG 或 Facebook 帳號')).not.toBeVisible();
    await expect(page.getByText('美容相關證書')).not.toBeVisible();
  });

  test('登入一般會員後，美容師申請頁顯示申請欄位', async ({ page }) => {
    await mockEcladoApis(page, {
      authUser: loggedInUser('consumer@example.com'),
      profiles: [consumerProfile()],
    });

    await page.goto('/professional-apply');

    await expect(page.getByText('皮膚管理院 / 工作室名稱')).toBeVisible();
    await expect(page.getByText(/IG 或 Facebook/)).toBeVisible();
    await expect(page.getByText('美容相關證書')).toBeVisible();
  });
});

// ─── 一般會員不觸發申請 ────────────────────────────────────────────────────

test('一般會員註冊：signUp metadata 攜帶 role=consumer，不觸發 professional_applications POST', async ({ page }) => {
  let capturedSignupBody: Record<string, unknown> | null = null;
  let appInsertCalled = false;

  await mockEcladoApis(page);

  await page.route('**/*', async route => {
    if (!route.request().url().includes('/auth/v1/signup')) return route.fallback();
    capturedSignupBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fakeAuthUser('consumer', 'consumer@example.com')),
    });
  });

  await page.route('**/rest/v1/professional_applications**', async route => {
    if (route.request().method() === 'POST') appInsertCalled = true;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });

  await page.goto('/login');
  await page.getByRole('button', { name: '註冊' }).click();

  const inputs = page.locator('form input');
  await inputs.nth(0).fill('一般測試會員');
  await inputs.nth(1).fill('0987654321');
  await inputs.nth(2).fill('consumer@example.com');
  await inputs.nth(3).fill('testpass123');
  await inputs.nth(4).fill('testpass123');
  await page.getByRole('button', { name: '建立帳號' }).click();

  await expect(page.getByText(/會員已建立完成|驗證信已發送/)).toBeVisible();

  expect(signupRole(capturedSignupBody) || JSON.stringify(capturedSignupBody)).toContain('consumer');
  expect(appInsertCalled).toBe(false);
});

// ─── professional-apply.html 獨立申請表單 ──────────────────────────────────

test('美容師申請頁（professional-apply）：送出後 professional_applications POST 帶正確資料', async ({ page }) => {
  let capturedApplicationBody: Record<string, unknown> | null = null;

  await mockEcladoApis(page, {
    authUser: loggedInUser('consumer@example.com'),
    profiles: [consumerProfile()],
  });

  await page.route('**/rest/v1/professional_applications**', async route => {
    if (route.request().method() === 'POST') {
      capturedApplicationBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'apply-app-id', status: 'pending' }]),
      });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    }
  });

  await page.goto('/professional-apply');

  const inputs = page.locator('form input[type="text"]');
  await inputs.nth(0).fill('獨立申請工作室');          // 工作室名稱
  await inputs.nth(1).fill('申請聯絡人');              // 聯絡人姓名
  await page.locator('form input[type="tel"]').fill('0933333333');
  await inputs.nth(2).fill('台中市西區申請路2號');      // 地址
  await inputs.nth(3).fill('@apply_studio');           // IG
  await page.locator('form textarea').fill('美容師乙級證書');
  await page.getByRole('button', { name: '送出申請' }).click();

  await expect(page.getByText('申請資料已送出')).toBeVisible();

  expect(capturedApplicationBody).not.toBeNull();
  const app = capturedApplicationBody as Record<string, unknown>;
  expect(app.studio_name).toBe('獨立申請工作室');
  expect(app.status).toBe('pending');
  expect(app.source).toBe('standalone');
});

test('審核中會員不能再次送出美容師申請', async ({ page }) => {
  let appInsertCalled = false;
  await mockEcladoApis(page, {
    authUser: loggedInUser('pending@example.com'),
    profiles: [loggedInProfile('pending')],
  });
  await page.route('**/rest/v1/professional_applications**', async route => {
    if (route.request().method() === 'POST') appInsertCalled = true;
    await route.fallback();
  });

  await page.goto('/professional-apply');

  await expect(page.getByText('您的美容師申請審核中')).toBeVisible();
  await expect(page.getByRole('button', { name: '送出申請' })).toHaveCount(0);
  expect(appInsertCalled).toBe(false);
});

test('已是美容師會員不能再次送出美容師申請', async ({ page }) => {
  let appInsertCalled = false;
  await mockEcladoApis(page, {
    authUser: loggedInUser('pro@example.com'),
    profiles: [loggedInProfile('pro')],
  });
  await page.route('**/rest/v1/professional_applications**', async route => {
    if (route.request().method() === 'POST') appInsertCalled = true;
    await route.fallback();
  });

  await page.goto('/professional-apply');

  await expect(page.getByText('您已是美容師會員')).toBeVisible();
  await expect(page.getByRole('button', { name: '送出申請' })).toHaveCount(0);
  expect(appInsertCalled).toBe(false);
});

test('DB 已有 pending 申請的 consumer 會員不能再次送出（DB 層防重複）', async ({ page }) => {
  let appInsertCalled = false;

  await mockEcladoApis(page, {
    authUser: loggedInUser('consumer@example.com'),
    profiles: [consumerProfile()],
  });

  await page.route('**/rest/v1/professional_applications**', async route => {
    if (route.request().method() === 'POST') {
      appInsertCalled = true;
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify([]) });
    } else {
      // GET：回傳一筆已存在的 pending 申請，模擬 DB 已有紀錄
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'existing-app-id', status: 'pending' }]),
      });
    }
  });

  await page.goto('/professional-apply');

  const inputs = page.locator('form input[type="text"]');
  await inputs.nth(0).fill('重複申請工作室');
  await inputs.nth(1).fill('重複申請人');
  await page.locator('form input[type="tel"]').fill('0911111111');
  await inputs.nth(2).fill('台北市重複路1號');
  await inputs.nth(3).fill('@duplicate_studio');
  await page.locator('form textarea').fill('美容師乙級');
  await page.getByRole('button', { name: '送出申請' }).click();

  await expect(page.getByText('您已有一份審核中的申請，請勿重複送出。')).toBeVisible();
  expect(appInsertCalled).toBe(false);
});
