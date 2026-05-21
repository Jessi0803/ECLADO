import { expect, test } from '@playwright/test';
import { mockEcladoApis } from './support/eclado-mocks';

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

// ─── 美容師欄位顯示 / 隱藏 ───────────────────────────────────────────────────

test.describe('美容師欄位顯示', () => {
  test.beforeEach(async ({ page }) => {
    await mockEcladoApis(page);
    await page.route('**/auth/v1/**', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fakeAuthUser('consumer', 'test@example.com')) });
    });
    await page.goto('/login');
    await page.getByRole('button', { name: '註冊' }).click();
  });

  test('預設為一般會員，美容師欄位不顯示', async ({ page }) => {
    await expect(page.getByText('皮膚管理院 / 工作室名稱')).not.toBeVisible();
    await expect(page.getByText('IG 或 Facebook 帳號')).not.toBeVisible();
    await expect(page.getByText('美容相關證書')).not.toBeVisible();
  });

  test('切換至美容師會員後額外欄位出現', async ({ page }) => {
    await page.getByRole('button', { name: '美容師會員' }).click();
    await expect(page.getByText('皮膚管理院 / 工作室名稱')).toBeVisible();
    await expect(page.getByText('IG 或 Facebook 帳號')).toBeVisible();
    await expect(page.getByText('美容相關證書')).toBeVisible();
  });

  test('切回一般會員後美容師欄位隱藏', async ({ page }) => {
    await page.getByRole('button', { name: '美容師會員' }).click();
    await expect(page.getByText('皮膚管理院 / 工作室名稱')).toBeVisible();
    await page.getByRole('button', { name: '一般會員' }).click();
    await expect(page.getByText('皮膚管理院 / 工作室名稱')).not.toBeVisible();
  });
});

// ─── 美容師成功註冊 ─────────────────────────────────────────────────────────

test('美容師成功註冊：signUp metadata 攜帶 role=pending，申請資料正確寫入', async ({ page }) => {
  let capturedSignupBody: Record<string, unknown> | null = null;
  let capturedApplicationBody: Record<string, unknown> | null = null;

  await mockEcladoApis(page);

  await page.route('**/auth/v1/signup', async route => {
    capturedSignupBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fakeAuthUser('pending', 'test-pro@example.com')),
    });
  });

  await page.route('**/rest/v1/professional_applications**', async route => {
    if (route.request().method() === 'POST') {
      capturedApplicationBody = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'test-app-id', status: 'pending' }]),
      });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    }
  });

  await page.goto('/login');
  await page.getByRole('button', { name: '註冊' }).click();
  await page.getByRole('button', { name: '美容師會員' }).click();

  const inputs = page.locator('form input');
  await inputs.nth(0).fill('測試美容師');
  await inputs.nth(1).fill('0912345678');
  await inputs.nth(2).fill('test-pro@example.com');
  await inputs.nth(3).fill('testpass123');
  await inputs.nth(4).fill('testpass123');
  await inputs.nth(5).fill('測試美容工作室');
  await inputs.nth(6).fill('台北市大安區測試路1號');
  await inputs.nth(7).fill('@test_beauty');
  await page.locator('form textarea').fill('美容丙級技術士證照');
  await page.getByRole('button', { name: '建立帳號' }).click();

  await expect(page.getByText(/美容師申請|審核後開通/)).toBeVisible();

  // signUp metadata 必須帶 role: 'pending'（修正的核心）
  const signup = capturedSignupBody as { data?: { role?: string } } | null;
  expect(signup?.data?.role).toBe('pending');

  // professional_applications 必須有寫入且資料正確
  expect(capturedApplicationBody).not.toBeNull();
  const app = capturedApplicationBody as Record<string, unknown>;
  expect(app.studio_name).toBe('測試美容工作室');
  expect(app.contact_name).toBe('測試美容師');
  expect(app.phone).toBe('0912345678');
  expect(app.address).toBe('台北市大安區測試路1號');
  expect(app.social_media).toBe('@test_beauty');
  expect(app.certificate).toBe('美容丙級技術士證照');
  expect(app.status).toBe('pending');
  expect(app.source).toBe('registration');
});

// ─── 一般會員不觸發申請 ────────────────────────────────────────────────────

test('一般會員註冊：signUp metadata 攜帶 role=consumer，不觸發 professional_applications POST', async ({ page }) => {
  let capturedSignupBody: Record<string, unknown> | null = null;
  let appInsertCalled = false;

  await mockEcladoApis(page);

  await page.route('**/auth/v1/signup', async route => {
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

  const signup = capturedSignupBody as { data?: { role?: string } } | null;
  expect(signup?.data?.role).toBe('consumer');
  expect(appInsertCalled).toBe(false);
});

// ─── professional-apply.html 獨立申請表單 ──────────────────────────────────

test('美容師申請頁（professional-apply）：送出後 professional_applications POST 帶正確資料', async ({ page }) => {
  let capturedApplicationBody: Record<string, unknown> | null = null;

  await mockEcladoApis(page);

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
