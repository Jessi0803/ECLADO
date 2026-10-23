import { expect, test, type Page } from '@playwright/test';
import { mockEcladoApis } from './support/eclado-mocks';

test.beforeEach(async ({ page }) => {
  await page.context().route('**/*', route => {
    const host = new URL(route.request().url()).hostname;
    return ['127.0.0.1', 'localhost'].includes(host) ? route.continue() : route.abort('blockedbyclient');
  });
});

async function checkout(page: Page) {
  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button', { name: /加入購物車/ }).click();
  await page.locator('nav').getByRole('button', { name: /^購物車/ }).click();
  await page.getByRole('dialog', { name: '購物車' }).getByRole('button', { name: /前往結帳/ }).click();
  const guest = page.getByRole('button', { name: /訪客結帳/ });
  if (await guest.isVisible().catch(() => false)) await guest.click();
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('私密測試姓名');
  await inputs.nth(1).fill('0912345678');
  await inputs.nth(2).fill('private@example.com');
  await page.getByPlaceholder('縣市').fill('台北市');
  await page.getByPlaceholder('區域').fill('大安區');
  await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('私密地址');
  await page.getByRole('button', { name: /繼續確認付款/ }).click();
}

async function flush(page: Page) {
  await page.evaluate(async () => {
    const modulePath = '/src/services/checkoutEvents.js';
    await (await import(modulePath)).flushCheckoutEvents();
  });
}

test('付款連線失敗與重試以同流程、不同嘗試追蹤，保留現有提示與按鈕行為', async ({ page }) => {
  const orders: any[] = [], payments: any[] = [], events: any[] = [], headers: string[] = [];
  await mockEcladoApis(page, { promotions: [], onOrderInsert: row => orders.push(row) });
  await page.route('**/api/checkout-events', route => {
    events.push(...route.request().postDataJSON().events);
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/sinopac/create-payment', route => {
    payments.push(route.request().postDataJSON());
    return route.abort('failed');
  });
  page.on('request', request => {
    if (request.url().endsWith('/rpc/create_order_with_pricing')) headers.push(request.headers()['x-client-info']);
  });
  await checkout(page);
  expect(orders).toHaveLength(0);
  const button = page.getByRole('button', { name: /^建立付款單$/ });
  for (let i = 0; i < 2; i++) {
    await button.click();
    await expect(page.getByText(/付款單建立失敗/)).toBeVisible();
    await expect(button).toBeEnabled();
    await flush(page);
  }
  await expect.poll(() => events.filter(e => e.event_name === 'error_shown').length).toBe(2);
  expect(orders).toHaveLength(2);
  expect(orders[0].id).not.toBe(orders[1].id);
  expect(payments[0].checkoutTrace.flowId).toBe(payments[1].checkoutTrace.flowId);
  expect(payments[0].checkoutTrace.attemptId).not.toBe(payments[1].checkoutTrace.attemptId);
  expect(headers[0]).toBe(`eclado-checkout/v1;flow=${payments[0].checkoutTrace.flowId};attempt=${payments[0].checkoutTrace.attemptId}`);
  const starts = events.filter(e => e.event_name === 'submit_started');
  expect(starts[1].previous_attempt_id).toBe(starts[0].attempt_id);
  expect(events.some(e => e.event_name === 'payment_received')).toBe(false);
  expect(events.filter(e => e.event_name === 'checkout_error').every(e => e.error_kind === 'network')).toBe(true);
  expect(JSON.stringify(events)).not.toMatch(/私密|0912345678|private@example|payment-token|Failed to fetch/);
});

test('追蹤 API 故障與 sessionStorage 被封鎖都不阻擋付款建立', async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key.startsWith('eclado.checkout.')) throw new DOMException('Storage disabled', 'SecurityError');
      return get.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('eclado.checkout.')) throw new DOMException('Storage disabled', 'SecurityError');
      return set.call(this, key, value);
    };
  });
  await mockEcladoApis(page, { promotions: [] });
  await page.route('**/api/checkout-events', route => route.fulfill({ status: 503, json: { ok: false } }));
  await checkout(page);
  await page.getByRole('button', { name: /^建立付款單$/ }).click();
  await expect(page.getByRole('heading', { name: '付款單已建立' })).toBeVisible();
});

test('追蹤送出失敗後重載會補送原事件 ID，成功後清空佇列', async ({ page }) => {
  await mockEcladoApis(page);
  let fail = true;
  const received: any[] = [];
  await page.route('**/api/checkout-events', route => {
    if (fail) return route.abort('failed');
    received.push(...route.request().postDataJSON().events);
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/shop');
  await page.evaluate(async () => {
    const modulePath = '/src/services/checkoutEvents.js';
    const events = await import(modulePath);
    const attempt = events.beginCheckoutAttempt();
    attempt.record('order_requested'); attempt.finish();
    await events.flushCheckoutEvents();
  });
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('eclado.checkout.events.v1') || '[]'));
  expect(saved.length).toBe(3);
  fail = false;
  await page.reload();
  await flush(page);
  // A pagehide delivery can reach the server before its acknowledgement is
  // lost on navigation. At-least-once delivery intentionally reuses IDs.
  await expect.poll(() => new Set(received.map(e => e.event_id)).size).toBe(3);
  expect([...new Set(received.map(e => e.event_id))]).toEqual(saved.map((e: any) => e.event_id));
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('eclado.checkout.events.v1') || '[]'))).toEqual([]);
});
