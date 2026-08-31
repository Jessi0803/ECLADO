import { expect, test } from '@playwright/test';
import { mockEcladoApis } from './support/eclado-mocks';

// ─── 忘記密碼 ────────────────────────────────────────────────────────────────

test.describe('忘記密碼', () => {
  test.beforeEach(async ({ page }) => {
    await mockEcladoApis(page);
  });

  test('點「忘記密碼？」切換到忘記密碼表單，登入/註冊 tab 消失', async ({ page }) => {
    await page.goto('/login');
    const visualBefore = (page.viewportSize()?.width || 0) > 900
      ? await page.locator('.login-visual').boundingBox()
      : null;
    await page.getByRole('button', { name: '忘記密碼？' }).click();
    await expect(page.getByRole('button', { name: '發送重設密碼信' })).toBeVisible();
    await expect(page.getByRole('button', { name: '登入', exact: true })).not.toBeVisible();
    await expect(page.getByRole('button', { name: '註冊', exact: true })).not.toBeVisible();
    await expect(page.getByRole('button', { name: '← 返回登入' })).toBeVisible();
    if (visualBefore) {
      const visualAfter = await page.locator('.login-visual').boundingBox();
      expect(visualAfter).toEqual(visualBefore);
    }
    await page.getByRole('button', { name: '← 返回登入' }).click();
    await expect(page.getByRole('button', { name: '登入', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: '註冊', exact: true })).toBeVisible();
  });

  test('送出後顯示「密碼重設信已發送」成功訊息', async ({ page }) => {
    await page.route('**/auth/v1/recover', async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    });

    await page.goto('/login');
    await page.getByRole('button', { name: '忘記密碼？' }).click();
    await page.locator('form input[type="email"]').fill('user@example.com');
    await page.getByRole('button', { name: '發送重設密碼信' }).click();

    await expect(page.getByText(/密碼重設信已發送/)).toBeVisible();
  });

	  test('Supabase 回傳錯誤時顯示錯誤訊息', async ({ page }) => {
	    await page.route('**/*', async route => {
	      if (!route.request().url().includes('/auth/v1/recover')) return route.fallback();
	      await route.fulfill({
	        status: 422,
	        contentType: 'application/json',
	        body: JSON.stringify({ error: 'invalid_request', error_description: 'Email not found' }),
	      });
    });

    await page.goto('/login');
    await page.getByRole('button', { name: '忘記密碼？' }).click();
    await page.locator('form input[type="email"]').fill('notexist@example.com');
    await page.getByRole('button', { name: '發送重設密碼信' }).click();

	    await expect(page.getByText(/Email not found|錯誤|失敗|找不到|不正確/)).toBeVisible();
  });
});

// ─── 重設密碼頁 (/reset-password) ────────────────────────────────────────────

test.describe('重設密碼頁', () => {
  test.beforeEach(async ({ page }) => {
	    await mockEcladoApis(page, {
	      authUser: {
	        id: 'test-uid',
	        email: 'user@example.com',
	        user_metadata: { name: '測試會員' },
	        app_metadata: { provider: 'email' },
	        aud: 'authenticated',
	        role: 'authenticated',
	        created_at: '2026-01-01T00:00:00.000Z',
	      },
	    });
    // updateUser 與 signOut 的 Supabase auth 呼叫
    await page.route('**/auth/v1/user', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'test-uid', email: 'user@example.com' }),
      });
    });
    await page.route('**/auth/v1/logout', async route => {
      await route.fulfill({ status: 204, body: '' });
    });
  });

  test('進入 /reset-password 顯示重設密碼表單', async ({ page }) => {
    await page.goto('/reset-password');
    await expect(page.getByText('重設密碼')).toBeVisible();
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
  });

  test('密碼少於 6 字元顯示錯誤，不送出 API', async ({ page }) => {
    let updateUserCalled = false;
    await page.route('**/auth/v1/user', async route => {
      updateUserCalled = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    });

	    await page.goto('/reset-password');
	    const inputs = page.locator('form input[type="password"]');
	    await inputs.nth(0).fill('12345');   // 5 字，太短
	    await inputs.nth(1).fill('12345');
	    await page.getByRole('button', { name: '更新密碼' }).click();

    await expect.poll(() => inputs.nth(0).evaluate(input => (input as HTMLInputElement).validity.tooShort)).toBe(true);
	    expect(updateUserCalled).toBe(false);
  });

  test('兩次密碼不一致顯示錯誤，不送出 API', async ({ page }) => {
    let updateUserCalled = false;
    await page.route('**/auth/v1/user', async route => {
      updateUserCalled = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    });

    await page.goto('/reset-password');
    const inputs = page.locator('form input[type="password"]');
    await inputs.nth(0).fill('password123');
    await inputs.nth(1).fill('different456');
    await page.getByRole('button', { name: '更新密碼' }).click();

    await expect(page.getByText('兩次密碼不一致')).toBeVisible();
    expect(updateUserCalled).toBe(false);
  });

  test('密碼符合條件，成功更新後顯示「密碼已更新」', async ({ page }) => {
    await page.goto('/reset-password');
    const inputs = page.locator('form input[type="password"]');
    await inputs.nth(0).fill('newpass123');
    await inputs.nth(1).fill('newpass123');
    await page.getByRole('button', { name: '更新密碼' }).click();

    await expect(page.getByText(/密碼已更新/)).toBeVisible();
  });

  test('Supabase 回傳錯誤（連結失效）顯示錯誤訊息', async ({ page }) => {
    await page.route('**/auth/v1/user', async route => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invalid_token', error_description: 'Token expired' }),
      });
    });

    await page.goto('/reset-password');
    const inputs = page.locator('form input[type="password"]');
    await inputs.nth(0).fill('newpass123');
    await inputs.nth(1).fill('newpass123');
    await page.getByRole('button', { name: '更新密碼' }).click();

    await expect(page.getByText(/Token expired|失效|錯誤|重新申請/)).toBeVisible();
  });
});

// ─── Email 驗證成功通知 ───────────────────────────────────────────────────────

test('Email 驗證後重導回登入頁，顯示「Email 已驗證成功」訊息', async ({ page }) => {
  await mockEcladoApis(page);

  // 模擬 Supabase auth callback 在 sessionStorage 留下的驗證成功標記
  await page.addInitScript(() => {
    sessionStorage.setItem('eclado_auth_notice', 'email_verified');
  });

  await page.goto('/login');
  await expect(page.getByText(/Email 已驗證成功/)).toBeVisible();
});

// ─── 登入錯誤 ────────────────────────────────────────────────────────────────

test('密碼登入成功後進入首頁且不顯示網路異常', async ({ page }) => {
  await mockEcladoApis(page);

  await page.goto('/login');
  await page.locator('form input[type="email"]').fill('member@example.com');
  await page.locator('form input[type="password"]').fill('password123');
  await page.locator('form').getByRole('button', { name: '登入' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('網路異常，請確認連線')).not.toBeVisible();
});

test('密碼錯誤時顯示正確錯誤提示且不建立資料', async ({ page }) => {
  await mockEcladoApis(page);
  await page.route('**/auth/v1/token**', async route => {
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'invalid_grant',
        error_description: 'Invalid login credentials',
      }),
    });
  });

  let profileWriteCalled = false;
  await page.route('**/rest/v1/profiles**', async route => {
    if (route.request().method() !== 'GET') profileWriteCalled = true;
    await route.fallback();
  });

  await page.goto('/login');
  await page.locator('form input[type="email"]').fill('wrong@example.com');
  await page.locator('form input[type="password"]').fill('bad-password');
  await page.locator('form').getByRole('button', { name: '登入' }).click();

  await expect(page.getByText('Email 或密碼錯誤')).toBeVisible();
  expect(profileWriteCalled).toBe(false);
});

test('Email 未驗證時顯示驗證提示且不建立資料', async ({ page }) => {
  await mockEcladoApis(page);
  await page.route('**/auth/v1/token**', async route => {
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'email_not_confirmed',
        error_description: 'Email not confirmed',
      }),
    });
  });

  let orderWriteCalled = false;
  await page.route('**/rest/v1/orders**', async route => {
    if (route.request().method() !== 'GET') orderWriteCalled = true;
    await route.fallback();
  });

  await page.goto('/login');
  await page.locator('form input[type="email"]').fill('unverified@example.com');
  await page.locator('form input[type="password"]').fill('password123');
  await page.locator('form').getByRole('button', { name: '登入' }).click();

  await expect(page.getByText(/請先驗證您的電子郵件|Email 尚未驗證|驗證信|信箱/)).toBeVisible();
  expect(orderWriteCalled).toBe(false);
});
