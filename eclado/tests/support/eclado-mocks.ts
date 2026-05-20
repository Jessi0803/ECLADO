import type { Page, Route } from '@playwright/test';

const products = [
  { id: 1, stock: 48 },
  { id: 2, stock: 2 },
  { id: 3, stock: 15 },
  { id: 4, stock: 1 },
  { id: 5, stock: 22 },
  { id: 6, stock: 8 },
  { id: 7, stock: 0 },
  { id: 8, stock: 31 },
  { id: 9, stock: 100 },
];

const activePromotion = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'E2E 測試活動',
  description: 'Playwright mock promotion',
  product_ids: [2],
  discount_rate: 0.9,
  discount_amount: 0,
  active: true,
  created_at: '2026-05-20T00:00:00.000Z',
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

export async function mockEcladoApis(page: Page) {
  await page.route('**/rest/v1/products**', async route => {
    if (route.request().method() === 'GET') return json(route, products);
    return json(route, []);
  });

  await page.route('**/rest/v1/promotions**', async route => {
    if (route.request().method() === 'GET') return json(route, [activePromotion]);
    return json(route, []);
  });

  await page.route('**/rest/v1/orders**', async route => {
    if (route.request().method() === 'POST') {
      const order = route.request().postDataJSON();
      return json(route, [{ ...order, created_at: new Date().toISOString() }], 201);
    }
    return json(route, []);
  });

  await page.route('**/rest/v1/profiles**', async route => {
    const method = route.request().method();
    if (method === 'GET') return json(route, []);
    return json(route, []);
  });

  await page.route('**/rest/v1/professional_applications**', async route => {
    if (route.request().method() === 'GET') return json(route, []);
    if (route.request().method() === 'POST') {
      return json(route, [{ id: '22222222-2222-4222-8222-222222222222', status: 'pending' }], 201);
    }
    return json(route, []);
  });

  await page.route('https://pay.ecladotaiwan.com/api/sinopac/create-payment', async route => {
    const request = route.request().postDataJSON();
    return json(route, {
      ok: true,
      response: {
        Status: 'S',
        Description: '付款單建立成功',
        TSNo: `E2E${Date.now()}`,
        ATMParam: {
          AtmPayNo: '8071234567890123',
        },
        Echo: request,
      },
    });
  });

  await page.route('**/api/line-push', async route => json(route, { ok: true }));
}
