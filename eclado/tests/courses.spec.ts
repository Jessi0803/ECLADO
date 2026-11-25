import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { mockEcladoApis } from './support/eclado-mocks';

for (const jpegFallback of [false, true]) {
test(`管理員可以新增、編輯、上下架課程，公開頁面可直接開啟詳情（${jpegFallback ? 'JPG 備援' : 'WebP'}）`, async ({ page }) => {
  if (jpegFallback) await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
      if (type === 'image/webp') return callback(null);
      return original.call(this, callback, type, quality);
    };
  });
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
  const uploadedPaths: string[] = [];
  let expectedSchedule: { publishAt: string | null; opensAt: string | null } = { publishAt:null, opensAt:null };
  let saved: {
    id: string; version: number; name: string; description: string; image_path: string;
    starts_at: string; ends_at: string; price_twd: number; published: boolean; zoom_url: string;
    instructor_name: string; overview: string; publish_at: string | null; registration_opens_at: string | null;
  } | undefined;
  await page.route('**/storage/v1/object/course-images/*', route => {
    if (route.request().method() === 'GET') return route.fulfill({ body: image, contentType: 'image/png' });
    uploadedPath = route.request().url().split('/').pop() || '';
    expect(uploadedPath).toMatch(jpegFallback ? /\.jpg$/ : /\.webp$/);
    expect(route.request().postDataBuffer()?.toString('latin1')).toContain(`Content-Type: ${jpegFallback ? 'image/jpeg' : 'image/webp'}`);
    uploadedPaths.push(uploadedPath);
    expect(route.request().method()).toBe('POST');
    return route.fulfill({ json: { Key: 'course-images/' + uploadedPath } });
  });
  await page.route('**/rest/v1/rpc/get_admin_courses', route => route.fulfill({ json: saved ? [saved] : [] }));
  await page.route('**/rest/v1/rpc/save_course_with_slug', route => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({
      p_id: saved?.id ?? null, p_version: saved?.version ?? null, p_image_path: uploadedPath,
      p_starts_at: '2030-11-11T02:00:00.000Z', p_ends_at: '2030-11-11T04:00:00.000Z',
      p_price_twd: 1200, p_zoom_url: secret, p_publish_at: expectedSchedule.publishAt, p_registration_opens_at: expectedSchedule.opensAt, p_slug: null,
    });
    saved = {
      id, version: (saved?.version ?? 0) + 1, name: body.p_name, description: body.p_description,
      image_path: body.p_image_path, starts_at: body.p_starts_at, ends_at: body.p_ends_at,
      price_twd: body.p_price_twd, published: body.p_published, zoom_url: body.p_zoom_url,
      instructor_name: body.p_instructor_name, overview: body.p_overview,
      publish_at:body.p_publish_at, registration_opens_at:body.p_registration_opens_at,
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
  await expect(page.getByLabel('課程網址代稱（選填）')).toHaveValue('');
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
  await page.getByLabel('上課開始時間（台北時間）').fill('2030-11-11T10:00');
  await page.getByLabel('上課結束時間（台北時間）').fill('2030-11-11T12:00');
  await page.getByLabel('上架時間（台北時間）').fill('2030-11-01T10:00');
  await expect(page.getByLabel('開放報名時間（台北時間）')).toHaveValue('2030-11-01T10:00');
  await page.getByLabel('開放報名時間（台北時間）').fill('2030-11-02T10:00');
  await page.getByLabel('上架時間（台北時間）').fill('2030-11-01T12:00');
  await expect(page.getByLabel('開放報名時間（台北時間）')).toHaveValue('2030-11-02T10:00');
  await expect(page.getByLabel('上課開始時間（台北時間）')).toHaveAttribute('min','2030-11-02T10:00');
  await page.getByLabel('上架時間（台北時間）').fill('');
  await page.getByLabel('開放報名時間（台北時間）').fill('');
  await page.getByLabel('課程費用（NT$）').fill('1200');
  await page.getByLabel('Zoom 會議連結').fill(secret);
  page.once('dialog', dialog => dialog.accept('課程介紹插圖'));
  await page.locator('.admin-course-rich input[type="file"]').setInputFiles({ name:'inline.png', mimeType:'image/png', buffer:image });
  await expect.poll(() => uploadedPaths.length).toBe(1);
  await expect(page.getByRole('textbox', { name:'課程介紹', exact:true }).locator('img')).toHaveAttribute('data-course-image', uploadedPaths[0]);
  await page.getByLabel('課程圖片').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByRole('img', { name: '課程圖片預覽' })).toBeVisible();
  await page.getByRole('button', { name: '儲存課程' }).click();
  await expect(page.getByText('已下架', { exact: true })).toBeVisible();
  expect(uploadedPaths).toHaveLength(2);
  expect(saved?.description).toContain(uploadedPaths[0]);
  expect(saved?.image_path).toBe(uploadedPaths[1]);

  const storefront = await page.context().newPage();
  // Keep this storefront tab isolated from external services.
  await storefront.route('https://**/*', route => route.abort());
  await storefront.route('**/rest/v1/rpc/get_published_courses', route => {
    if (!saved?.published || (saved.publish_at && Date.parse(saved.publish_at) > Date.now())) return route.fulfill({ json: [] });
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
  await expect(page.getByRole('textbox', { name:'課程介紹', exact:true }).locator('img')).toHaveAttribute('data-course-image', uploadedPaths[0]);
  await page.getByLabel('授課講師').selectOption('custom');
  await page.getByLabel('講師姓名').fill('客座講師');
  const descriptionEditor = page.getByRole('textbox', { name:'課程介紹', exact:true });
  await descriptionEditor.press('ControlOrMeta+End');
  await descriptionEditor.press('Enter');
  await descriptionEditor.pressSequentially('請備妥護膚用品。');
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
  await expect(storefront.getByRole('img', { name:'課程介紹插圖', exact:true })).toBeVisible();
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

  await page.getByRole('button', { name: '編輯 專業護膚課程' }).click();
  await page.getByLabel('上架時間（台北時間）').fill('2030-11-01T10:00');
  await page.getByLabel('開放報名時間（台北時間）').fill('2030-11-02T10:00');
  expectedSchedule = {publishAt:'2030-11-01T02:00:00.000Z',opensAt:'2030-11-02T02:00:00.000Z'};
  await page.getByRole('checkbox',{name:'上架課程',exact:true}).check();
  await page.getByRole('button',{name:'儲存課程'}).click();
  await expect(page.getByText('排程上架',{exact:true})).toBeVisible();
  await page.getByRole('button', { name: '編輯 專業護膚課程' }).click();
  await expect(page.getByLabel('上架時間（台北時間）')).toHaveValue('2030-11-01T10:00');
  await expect(page.getByLabel('開放報名時間（台北時間）')).toHaveValue('2030-11-02T10:00');
  await storefront.reload();
  await expect(storefront.getByText('找不到此課程，或課程已下架。')).toBeVisible();

});


}

test('已上架課程在報名時間前展示預告，到時自動顯示報名入口', async ({ page }) => {
  await page.clock.install({time:new Date('2030-11-01T00:00:00Z')});
  await page.route('https://**/*', route => route.abort());
  await mockEcladoApis(page);
  const course = {
    id:'c0ea0000-0000-4000-8000-000000000002', name:'預告課程', description:'課程介紹',
    image_path:null, instructor_name:'April', overview:'先公開課程，稍後開放報名',
    price_twd:1200, starts_at:'2030-11-11T02:00:00Z', ends_at:'2030-11-11T04:00:00Z',
    publish_at:'2030-10-31T00:00:00Z', registration_opens_at:'2030-11-01T01:00:00Z',
  };
  await page.route('**/rest/v1/rpc/get_published_courses', route => route.fulfill({json:[course]}));
  await page.goto('/courses');
  await expect(page.getByRole('heading',{name:'即將開放報名',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'可報名課程',exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:/預告課程/}).click();
  await expect(page.getByText('尚未開放報名',{exact:true})).toBeVisible();
  await expect(page.getByText('預計於 2030/11/01 09:00 開放報名（台北時間）',{exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'立即報名'})).toHaveCount(0);
  await page.clock.fastForward(3601000);
  await expect(page.getByRole('link',{name:'立即報名'})).toBeVisible();
  await expect(page.getByText('尚未開放報名',{exact:true})).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('後台僅在課程上架後顯示複製連結，排程到時自動出現並保留編輯內容', async ({ page }) => {
  await page.clock.install({time:new Date('2030-11-01T00:00:00Z')});
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{
      writeText:async (text: string) => { (window as any).__copiedCourseLink = text; },
    }});
  });
  await page.route('https://**/*', route => route.abort());
  await mockEcladoApis(page, {
    adminAccess:true,
    backofficeAccess:{role:'admin',permissions:['courses.manage']},
    signInUser:{
      id:'copy-course-admin',email:'copy-course-admin@example.test',user_metadata:{name:'管理員'},
      app_metadata:{provider:'email'},aud:'authenticated',role:'authenticated',created_at:'2026-05-01T00:00:00Z',
    },
  });
  const base = {
    version:1,description:'課程介紹',overview:'課程概述',image_path:'c0ea0000-0000-4000-8000-000000000010.webp',instructor_name:'April',
    starts_at:'2030-11-11T02:00:00Z',ends_at:'2030-11-11T04:00:00Z',price_twd:1200,
    zoom_url:'https://zoom.us/j/123',open_case_count:0,notification_exception_count:0,
  };
  const courses = [
    {...base,id:'c0ea0000-0000-4000-8000-000000000011',name:'已下架課程',published:false,publish_at:null},
    {...base,id:'c0ea0000-0000-4000-8000-000000000012',name:'排程分享課程',published:true,
      publish_at:'2030-11-01T00:01:00Z',registration_opens_at:'2030-11-01T01:00:00Z'},
    {...base,id:'c0ea0000-0000-4000-8000-000000000013',slug:'2030-gold-care',name:'公開預告課程',published:true,
      publish_at:'2030-10-31T00:00:00Z',registration_opens_at:'2030-11-01T01:00:00Z'},
    {...base,id:'c0ea0000-0000-4000-8000-000000000014',name:'未設定排程課程',published:true,publish_at:null},
  ];
  await page.route('**/rest/v1/rpc/get_admin_courses', route => route.fulfill({json:courses}));
  await page.goto('/admin');
  await page.locator('input[type="email"]').fill('copy-course-admin@example.test');
  await page.locator('input[type="password"]').fill('local-test-password');
  await page.getByRole('button',{name:'進入後台'}).click();
  if ((page.viewportSize()?.width || 0) <= 900) await page.getByRole('button',{name:'開啟選單'}).click();
  await page.locator('.app-sidebar button:not(.sidebar-star)').filter({hasText:/^課程管理$/}).click();
  await expect(page.getByRole('button',{name:'複製 已下架課程 的課程連結'})).toHaveCount(0);
  const scheduled = page.getByRole('button',{name:'複製 排程分享課程 的課程連結'});
  await expect(scheduled).toHaveCount(0);
  await expect(page.getByRole('button',{name:'複製 未設定排程課程 的課程連結'})).toBeVisible();
  await page.getByRole('button',{name:'複製 公開預告課程 的課程連結'}).click();
  await expect(page.getByRole('status').filter({hasText:'課程連結已複製。'})).toBeVisible();
  const expected = new URL('/courses/2030-gold-care',page.url()).href;
  expect(await page.evaluate(() => (window as any).__copiedCourseLink)).toBe(expected);

  await page.getByRole('button',{name:'編輯 排程分享課程'}).click();
  await expect(page.getByLabel('課程網址代稱（選填）')).toHaveValue('');
  const name = page.getByLabel('課程名稱');
  await name.fill('保留尚未儲存內容');
  const originalInput = await name.elementHandle();
  await page.clock.fastForward(61000);
  await expect(name).toHaveValue('保留尚未儲存內容');
  expect(await originalInput!.evaluate(element => element.isConnected)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(scheduled).toBeVisible();
  await expect(page.getByText('排程上架',{exact:true})).toHaveCount(0);
  await scheduled.click();
  expect(await page.evaluate(() => (window as any).__copiedCourseLink)).toBe(new URL('/courses/'+courses[1].id,page.url()).href);

  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => { throw new Error('Clipboard denied'); };
  });
  await scheduled.click();
  await expect(page.getByRole('alert')).toContainText('無法自動複製，課程連結為');
  await expect(page.getByRole('alert')).toContainText('/courses/'+courses[1].id);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.route('**/rest/v1/rpc/save_course_with_slug', route => {
    const args=route.request().postDataJSON();
    expect(args.p_id).toBe(courses[2].id);
    Object.assign(courses[2],{slug:args.p_slug,version:courses[2].version+1});
    return route.fulfill({json:courses[2]});
  });
  await page.getByRole('button',{name:'編輯 公開預告課程'}).click();
  await expect(page.getByLabel('課程網址代稱（選填）')).toHaveValue('2030-gold-care');
  await page.getByLabel('課程網址代稱（選填）').fill('bad slug');
  await page.getByRole('button',{name:'儲存課程'}).click();
  await expect(page.getByRole('alert').filter({hasText:'網址代稱須為'})).toBeVisible();
  await page.getByLabel('課程網址代稱（選填）').fill(' 2030-GOLD-UPDATED ');
  await page.getByRole('button',{name:'儲存課程'}).click();
  await page.getByRole('button',{name:'編輯 公開預告課程'}).click();
  await expect(page.getByLabel('課程網址代稱（選填）')).toHaveValue('2030-gold-updated');
  await page.getByLabel('課程網址代稱（選填）').fill('');
  await page.getByRole('button',{name:'儲存課程'}).click();
  await page.evaluate(() => {navigator.clipboard.writeText=async text=>{(window as any).__copiedCourseLink=text;};});
  await page.getByRole('button',{name:'複製 公開預告課程 的課程連結'}).click();
  expect(await page.evaluate(() => (window as any).__copiedCourseLink)).toBe(new URL('/courses/'+courses[2].id,page.url()).href);
});
