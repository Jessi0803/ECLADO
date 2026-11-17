import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { mockEcladoApis } from './support/eclado-mocks';

test('管理員可以新增、編輯、上下架課程，公開頁面可直接開啟詳情', async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
  await mockEcladoApis(page, {
    adminAccess: true,
    backofficeAccess: { role: 'admin', permissions: ['orders.read', 'courses.manage'] },
    signInUser: {
      id: 'course-admin', email: 'course-admin@example.test', user_metadata: { name: '管理員' },
      app_metadata: { provider: 'email' }, aud: 'authenticated', role: 'authenticated',
      created_at: '2026-05-01T00:00:00.000Z',
    },
  });
  const id = 'c0ea0000-0000-4000-8000-000000000001';
  const secret = 'https://eclado.zoom.us/j/123456789?pwd=private';
  const image = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#9e847a' } }).png().toBuffer();
  let uploadedPath = '';
  let saved: {
    id: string; version: number; name: string; description: string; image_path: string;
    starts_at: string; ends_at: string; price_twd: number; published: boolean; zoom_url: string;
    instructor_name: string; overview: string;
  } | undefined;
  await page.route('**/storage/v1/object/course-images/*', route => {
    if (route.request().method() === 'GET') return route.fulfill({ body: image, contentType: 'image/png' });
    uploadedPath = route.request().url().split('/').pop() || '';
    expect(uploadedPath).toMatch(/\.webp$/);
    expect(route.request().method()).toBe('POST');
    return route.fulfill({ json: { Key: 'course-images/' + uploadedPath } });
  });
  await page.route('**/rest/v1/rpc/get_admin_courses', route => route.fulfill({ json: saved ? [saved] : [] }));
  await page.route('**/rest/v1/rpc/save_course', route => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({
      p_id: saved?.id ?? null, p_version: saved?.version ?? null, p_image_path: uploadedPath,
      p_starts_at: '2030-11-11T02:00:00.000Z', p_ends_at: '2030-11-11T04:00:00.000Z',
      p_price_twd: 1200, p_zoom_url: secret,
    });
    saved = {
      id, version: (saved?.version ?? 0) + 1, name: body.p_name, description: body.p_description,
      image_path: body.p_image_path, starts_at: body.p_starts_at, ends_at: body.p_ends_at,
      price_twd: body.p_price_twd, published: body.p_published, zoom_url: body.p_zoom_url,
      instructor_name: body.p_instructor_name, overview: body.p_overview,
    };
    return route.fulfill({ json: saved });
  });


  await page.goto('/admin');
  await page.locator('input[type="email"]').fill('course-admin@example.test');
  await page.locator('input[type="password"]').fill('local-test-password');
  await page.getByRole('button', { name: '進入後台' }).click();
  if ((page.viewportSize()?.width || 0) <= 900) await page.getByRole('button', { name: '開啟選單' }).click();
  await page.locator('.app-sidebar button:not(.sidebar-star)').filter({ hasText: /^課程管理$/ }).click();
  await page.getByRole('button', { name: '新增課程' }).click();
  await page.getByLabel('課程名稱').fill('專業護膚課程');
  if ((page.viewportSize()?.width || 0) <= 900) {
    const panel = page.getByRole('dialog', { name: '新增課程' });
    const zoom = panel.getByLabel('Zoom 會議連結');
    await zoom.focus();
    // Playwright's mobile profile does not open a native software keyboard.
    await page.evaluate(() => {
      const viewport = window.visualViewport!;
      Object.defineProperty(viewport, 'height', { configurable: true, value: 390 });
      Object.defineProperty(viewport, 'offsetTop', { configurable: true, value: 80 });
      viewport.dispatchEvent(new Event('resize'));
    });
    await expect(zoom).toBeFocused();
    await expect.poll(async () => zoom.evaluate(field => {
      const bounds = field.getBoundingClientRect();
      const drawer = field.closest('[role="dialog"]')!.getBoundingClientRect();
      return drawer.top === 80 && drawer.bottom === 470 &&
        bounds.top >= drawer.top && bounds.bottom <= drawer.bottom;
    })).toBe(true);
    await expect(panel.getByLabel('課程名稱')).toHaveValue('專業護膚課程');
    await page.evaluate(() => {
      const viewport = window.visualViewport!;
      Reflect.deleteProperty(viewport, 'height');
      Reflect.deleteProperty(viewport, 'offsetTop');
      viewport.dispatchEvent(new Event('resize'));
    });
  }
  await page.getByLabel('授課講師').selectOption('April');
  await page.getByLabel('課程概述').fill('練習護膚手技');
  await page.getByRole('textbox', { name: '課程介紹', exact: true }).fill('實作演練與課後問答。');
  await page.getByLabel('開始時間（台北時間）').fill('2030-11-11T10:00');
  await page.getByLabel('結束時間（台北時間）').fill('2030-11-11T12:00');
  await page.getByLabel('課程費用（NT$）').fill('1200');
  await page.getByLabel('Zoom 會議連結').fill(secret);
  await page.getByLabel('課程圖片').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByRole('img', { name: '課程圖片預覽' })).toBeVisible();
  await page.getByRole('button', { name: '儲存課程' }).click();
  await expect(page.getByText('已下架', { exact: true })).toBeVisible();

  const storefront = await page.context().newPage();
  // Keep this storefront tab isolated from external services.
  await storefront.route('https://**/*', route => route.abort());
  await storefront.route('**/rest/v1/rpc/get_published_courses', route => {
    if (!saved?.published) return route.fulfill({ json: [] });
    const { id, name, description, image_path, starts_at, ends_at, price_twd, instructor_name, overview } = saved;
    return route.fulfill({ json: [{ id, name, description, image_path, starts_at, ends_at, price_twd, instructor_name, overview }] });
  });
  await storefront.route('**/storage/v1/object/course-images/*', route => route.fulfill({ body: image, contentType: 'image/png' }));
  await storefront.goto('/');
  if ((storefront.viewportSize()?.width || 0) <= 900) {
    await storefront.getByRole('button', { name: '開啟選單' }).click();
  }
  await storefront.getByRole('link', { name: '專業教育', exact: true }).click();
  await expect(storefront).toHaveURL(/\/courses$/);
  await expect(storefront).toHaveTitle('專業教育 | ECLADO');
  await expect(storefront.getByText('新課程正在規劃中，敬請期待。')).toBeVisible();

  await page.getByRole('button', { name: '編輯 專業護膚課程' }).click();
  await expect(page.getByLabel('Zoom 會議連結')).toHaveValue(secret);
  await expect(page.getByLabel('授課講師')).toHaveValue('April');
  await expect(page.getByLabel('課程概述')).toHaveValue('練習護膚手技');
  await page.getByLabel('授課講師').selectOption('custom');
  await page.getByLabel('講師姓名').fill('客座講師');
  await page.getByRole('textbox', { name: '課程介紹', exact: true }).fill('實作演練與課後問答。\n請備妥護膚用品。');
  await page.getByLabel('上架課程').check();
  await page.getByRole('button', { name: '儲存課程' }).click();
  await expect(page.getByText('已上架', { exact: true })).toBeVisible();

  await storefront.reload();
  const card = storefront.getByRole('link', { name: /專業護膚課程/ });
  await expect(card).toContainText('客座講師');
  await expect(card).toContainText('練習護膚手技');
  await expect(card).not.toContainText('請備妥護膚用品');
  await card.click();
  await expect(storefront).toHaveURL(new RegExp('/courses/' + id));
  await expect(storefront.getByRole('heading', { name: '專業護膚課程' })).toBeVisible();
  await storefront.goBack();
  await expect(storefront).toHaveURL(/\/courses$/);
  await storefront.goto('/courses/' + id);
  await expect(storefront.getByText(/請備妥護膚用品/)).toBeVisible();
  const cover = storefront.getByRole('img', { name: '專業護膚課程' });
  await expect(cover).toBeVisible();
  await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(32);
  expect(await storefront.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(storefront.viewportSize()!.width);
  await expect(storefront.getByText('NT$ 1,200', { exact: true })).toBeVisible();
  await expect(storefront.locator('a[href*="zoom.us"]')).toHaveCount(0);
  await expect(storefront.getByText(secret)).toHaveCount(0);

  await page.getByRole('button', { name: '編輯 專業護膚課程' }).click();
  await expect(page.getByLabel('講師姓名')).toHaveValue('客座講師');
  await page.getByLabel('上架課程').uncheck();
  await page.getByRole('button', { name: '儲存課程' }).click();
  await expect(page.getByText('已下架', { exact: true })).toBeVisible();
  await storefront.reload();
  await expect(storefront.getByText('找不到此課程，或課程已下架。')).toBeVisible();
});
