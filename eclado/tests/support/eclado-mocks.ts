import type { Page, Route } from '@playwright/test';

export const mockProducts = [
  { id: 1, stock: 48,  is_pro_only: false, price: 1280, pro_price: 960,  active: true },
  { id: 2, stock: 2,   is_pro_only: false, price: 3980, pro_price: 2980, active: true },
  { id: 3, stock: 15,  is_pro_only: false, price: 4800, pro_price: 3600, active: true },
  { id: 4, stock: 1,   is_pro_only: false, price: 2200, pro_price: 1650, active: true },
  { id: 5, stock: 22,  is_pro_only: false, price: 2800, pro_price: 2100, active: true },
  { id: 6, stock: 8,   is_pro_only: false, price: 3600, pro_price: 2700, active: true },
  { id: 7, stock: 0,   is_pro_only: true,  price: 8800, pro_price: 6600, active: true },
  { id: 8, stock: 31,  is_pro_only: false, price: 1980, pro_price: 1485, active: true },
  { id: 9, stock: 100, is_pro_only: false, price: 5,    pro_price: 5,    active: true },
];

export const activePromotion = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'E2E 測試活動',
  description: 'Playwright mock promotion',
  product_ids: [2],
  discount_rate: 0.9,
  discount_amount: 0,
  discount_order: 'rate_then_amount',
  active: true,
  created_at: '2026-05-20T00:00:00.000Z',
};

export const adminProductRows = [
  { id: 1, name: 'Deep Cleansing Foam', name_zh: '深層清潔泡沫洗面乳', category: '清潔', size: '200ml', price: 1280, pro_price: 960, stock: 48, min_stock: 3, is_pro_only: false, active: true },
  { id: 2, name: 'Peptide Repair Serum', name_zh: '胜肽修護精華液', category: '精華液', size: '30ml', price: 3980, pro_price: 2980, stock: 2, min_stock: 3, is_pro_only: false, active: true },
  { id: 7, name: 'NK Cell Activator', name_zh: 'NK細胞活化安瓶', category: '急救安瓶', size: '3.5ml×10', price: 8800, pro_price: 6600, stock: 0, min_stock: 3, is_pro_only: true, active: true },
];

export const adminOrderRows = [
  {
    id: 'E2E-ORDER-001',
    member: '測試會員',
    type: 'consumer',
    items: [{ name: '胜肽修護精華液', qty: 1, price: 3980 }],
    total: 3980,
    status: 'awaiting_confirm',
    date: '2026-05-21',
    address: '台北市測試路 1 號',
    phone: '0912345678',
    email: 'member@example.com',
    transfer_last5: '12345',
    tracking: '',
    user_id: 'user-consumer-1',
    created_at: '2026-05-21T01:00:00.000Z',
  },
  {
    id: 'E2E-ORDER-002',
    member: 'LINE 會員',
    type: 'pro',
    items: [{ name: 'NK細胞活化安瓶', qty: 1, price: 6600 }],
    total: 6600,
    status: 'paid',
    date: '2026-05-21',
    address: '新北市測試路 2 號',
    phone: '0922222222',
    email: 'line-member@example.com',
    transfer_last5: '',
    tracking: '',
    user_id: 'user-line-1',
    created_at: '2026-05-21T02:00:00.000Z',
  },
];

export const adminProfileRows = [
  { id: 'user-consumer-1', email: 'member@example.com', name: '測試會員', phone: '0912345678', role: 'consumer', created_at: '2026-05-01T00:00:00.000Z' },
  { id: 'user-line-1', email: 'line-member@example.com', name: 'LINE 會員', phone: '0922222222', role: 'pro', line_user_id: 'U1234567890', created_at: '2026-05-02T00:00:00.000Z' },
  { id: 'user-pending-1', email: 'pending@example.com', name: '審核中會員', phone: '0933333333', role: 'pending', created_at: '2026-05-03T00:00:00.000Z' },
];

export const adminApplicationRows = [
  {
    id: 'app-pending-1',
    user_id: 'user-pending-1',
    user_email: 'pending@example.com',
    studio_name: '審核中工作室',
    contact_name: '審核中會員',
    phone: '0933333333',
    address: '台中市測試路 3 號',
    social_media: '@pending',
    certificate: '美容證書',
    status: 'pending',
    source: 'registration',
    created_at: '2026-05-20T00:00:00.000Z',
  },
];

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function hasObjectAccept(route: Route) {
  return route.request().headers().accept?.includes('vnd.pgrst.object+json');
}

function queryValue(url: string, key: string) {
  return new URL(url).searchParams.get(key) || '';
}

function filterRows<T extends Record<string, unknown>>(rows: T[], url: string) {
  const idEq = queryValue(url, 'id');
  if (idEq.startsWith('eq.')) {
    const id = idEq.slice(3);
    return rows.filter(row => String(row.id) === id);
  }

  const emailEq = queryValue(url, 'email');
  if (emailEq.startsWith('eq.')) {
    const email = decodeURIComponent(emailEq.slice(3));
    return rows.filter(row => String(row.email || row.user_email || '').toLowerCase() === email.toLowerCase());
  }

  const userIdEq = queryValue(url, 'user_id');
  if (userIdEq.startsWith('eq.')) {
    const userId = userIdEq.slice(3);
    return rows.filter(row => String(row.user_id) === userId);
  }

  const lineIdEq = queryValue(url, 'line_user_id');
  if (lineIdEq.startsWith('eq.')) {
    const lineUserId = lineIdEq.slice(3);
    return rows.filter(row => String(row.line_user_id || '') === lineUserId);
  }

  const activeEq = queryValue(url, 'active');
  if (activeEq === 'eq.true') {
    return rows.filter(row => row.active !== false);
  }

  return rows;
}

function authSessionPayload(user: MockAuthUser) {
  return {
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user,
  };
}

export type MockAuthUser = {
  id: string;
  email: string;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
  aud?: string;
  role?: string;
  created_at?: string;
};

export type MockEcladoApiOptions = {
  paymentMode?: 'mock' | 'live';
  onOrderInsert?: (order: Record<string, unknown>) => void;
  onOrderUpdate?: (update: Record<string, unknown>, url: string) => void;
  onProductInsert?: (product: Record<string, unknown>) => void;
  onProductUpdate?: (update: Record<string, unknown>, url: string) => void;
  onProfileUpdate?: (update: Record<string, unknown>, url: string) => void;
  onPromotionInsert?: (promotion: Record<string, unknown>) => void;
  onPromotionUpdate?: (update: Record<string, unknown>, url: string) => void;
  onPromotionDelete?: (url: string) => void;
  onApplicationUpdate?: (update: Record<string, unknown>, url: string) => void;
  onLinePush?: (body: Record<string, unknown>) => void;
  onPaymentRequest?: (body: Record<string, unknown>) => void;
  promotionWriteError?: string;
  linePushError?: string;
  authUser?: MockAuthUser | null;
  signInUser?: MockAuthUser;
  signInError?: string;
  products?: Record<string, unknown>[];
  promotions?: Record<string, unknown>[];
  orders?: Record<string, unknown>[];
  profiles?: Record<string, unknown>[];
  applications?: Record<string, unknown>[];
};

export async function mockEcladoApis(page: Page, options: MockEcladoApiOptions = {}) {
  const products = options.products || mockProducts;
  const promotions = options.promotions || [activePromotion];
  const orders = options.orders || [];
  const profiles = options.profiles || [];
  const applications = options.applications || [];
  const authUser = options.authUser;

  if (authUser) {
    await page.addInitScript(session => {
      window.localStorage.setItem('sb-ilvdvlkdpntwmaijncaz-auth-token', JSON.stringify(session));
    }, authSessionPayload(authUser));
  }

  await page.route('**/auth/v1/token**', async route => {
    if (options.signInError) {
      return json(route, { error: 'invalid_grant', error_description: options.signInError }, 400);
    }
    const user = options.signInUser || authUser || {
      id: 'mock-user-id',
      email: 'member@example.com',
      user_metadata: { name: '測試會員' },
      app_metadata: { provider: 'email' },
      aud: 'authenticated',
      role: 'authenticated',
      created_at: '2026-05-01T00:00:00.000Z',
    };
    return json(route, authSessionPayload(user));
  });

  if (authUser || options.signInUser) {
    await page.route('**/auth/v1/user', async route => {
      return json(route, authUser || options.signInUser);
    });
  }

  await page.route('**/auth/v1/logout', async route => json(route, {}, 204));

  await page.route('**/rest/v1/products**', async route => {
    const method = route.request().method();
    if (method === 'GET') {
      const url = route.request().url();
      const rows = filterRows(products, url);
      if (queryValue(url, 'order') === 'id.desc' && queryValue(url, 'limit') === '1') {
        return json(route, [...rows].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 1));
      }
      return json(route, rows);
    }
    if (method === 'POST') {
      const body = route.request().postDataJSON();
      options.onProductInsert?.(body);
      return json(route, [body], 201);
    }
    if (method === 'PATCH') {
      const body = route.request().postDataJSON();
      options.onProductUpdate?.(body, route.request().url());
      return json(route, [body]);
    }
    return json(route, []);
  });

  await page.route('**/rest/v1/promotions**', async route => {
    const method = route.request().method();
    if (method === 'GET') return json(route, filterRows(promotions, route.request().url()));
    if (method === 'POST') {
      const body = route.request().postDataJSON();
      options.onPromotionInsert?.(body);
      if (options.promotionWriteError) return json(route, { message: options.promotionWriteError }, 400);
      return json(route, [{ id: 'promo-new-1', ...body, created_at: new Date().toISOString() }], 201);
    }
    if (method === 'PATCH') {
      const body = route.request().postDataJSON();
      options.onPromotionUpdate?.(body, route.request().url());
      if (options.promotionWriteError) return json(route, { message: options.promotionWriteError }, 400);
      return json(route, [body]);
    }
    if (method === 'DELETE') {
      options.onPromotionDelete?.(route.request().url());
      return json(route, []);
    }
    return json(route, []);
  });

  await page.route('**/rest/v1/orders**', async route => {
    const method = route.request().method();
    if (method === 'GET') return json(route, filterRows(orders, route.request().url()));
    if (method === 'POST') {
      const order = route.request().postDataJSON();
      options.onOrderInsert?.(order);
      return json(route, [{ ...order, created_at: new Date().toISOString() }], 201);
    }
    if (method === 'PATCH') {
      const body = route.request().postDataJSON();
      options.onOrderUpdate?.(body, route.request().url());
      return json(route, [{ ...body }]);
    }
    return json(route, []);
  });

  await page.route('**/rest/v1/profiles**', async route => {
    const method = route.request().method();
    if (method === 'GET') {
      const rows = filterRows(profiles, route.request().url());
      return json(route, hasObjectAccept(route) ? (rows[0] || null) : rows);
    }
    if (method === 'PATCH') {
      const body = route.request().postDataJSON();
      options.onProfileUpdate?.(body, route.request().url());
      return json(route, [body]);
    }
    return json(route, []);
  });

  await page.route('**/rest/v1/professional_applications**', async route => {
    if (route.request().method() === 'GET') return json(route, filterRows(applications, route.request().url()));
    if (route.request().method() === 'POST') {
      return json(route, [{ id: '22222222-2222-4222-8222-222222222222', status: 'pending' }], 201);
    }
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      options.onApplicationUpdate?.(body, route.request().url());
      return json(route, [body]);
    }
    return json(route, []);
  });

  if (options.paymentMode !== 'live') {
    await page.route('https://pay.ecladotaiwan.com/api/sinopac/create-payment', async route => {
      const request = route.request().postDataJSON();
      options.onPaymentRequest?.(request);
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
  }

  await page.route('**/api/line-push', async route => {
    options.onLinePush?.(route.request().postDataJSON());
    if (options.linePushError) return json(route, { error: options.linePushError }, 500);
    return json(route, { ok: true });
  });
}
