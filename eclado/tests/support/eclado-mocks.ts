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
  onProductWithVariantsSave?: (request: Record<string, unknown>) => void;
  onProductImagesSave?: (request: Record<string, unknown>) => void;
  onProductImageUpload?: (path: string) => void;
  onProfileUpdate?: (update: Record<string, unknown>, url: string) => void;
  onMemberDelete?: (memberId: string) => void;
  onPromotionInsert?: (promotion: Record<string, unknown>) => void;
  onPromotionUpdate?: (update: Record<string, unknown>, url: string) => void;
  onPromotionDelete?: (url: string) => void;
  onApplicationUpdate?: (update: Record<string, unknown>, url: string) => void;
  onApplicationInsert?: (application: Record<string, unknown>) => void;
  onLinePush?: (body: Record<string, unknown>) => void;
  onOrderEmail?: (body: Record<string, unknown>) => void;
  onPaymentRequest?: (body: Record<string, unknown>) => void;
  paymentQueryStatus?: 'paid' | 'pending' | 'failed';
  productWriteError?: string;
  orderWriteError?: string;
  promotionWriteError?: string;
  linePushError?: string;
  paymentError?: string;
  paymentResponseDelayMs?: number;
  productResponseDelayMs?: number;
  authoritativePriceDelta?: number;
  authUser?: MockAuthUser | null;
  signInUser?: MockAuthUser;
  signInError?: string;
  adminAccess?: boolean;
  products?: Record<string, unknown>[] | (() => Record<string, unknown>[]);
  productVariants?: Record<string, unknown>[] | (() => Record<string, unknown>[]);
  productImages?: Record<string, unknown>[] | (() => Record<string, unknown>[]);
  promotions?: Record<string, unknown>[];
  orders?: Record<string, unknown>[];
  profiles?: Record<string, unknown>[];
  applications?: Record<string, unknown>[];
  auditLogs?: Record<string, unknown>[];
};

export async function mockEcladoApis(page: Page, options: MockEcladoApiOptions = {}) {
  const products = () => typeof options.products === 'function'
    ? options.products()
    : (options.products || mockProducts);
  const productVariants = () => typeof options.productVariants === 'function'
    ? options.productVariants()
    : (options.productVariants || []);
  const productImages = () => typeof options.productImages === 'function'
    ? options.productImages()
    : (options.productImages || []);
  const promotions = options.promotions || [activePromotion];
  const orders = options.orders || [];
  const profiles = [...(options.profiles || [])];
  const applications = options.applications || [];
  const auditLogs = options.auditLogs || [];
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

  await page.route('**/storage/v1/object/product-images/**', async route => {
    const marker = '/storage/v1/object/product-images/';
    const path = decodeURIComponent(route.request().url().split(marker)[1] || '');
    if (route.request().method() === 'POST') options.onProductImageUpload?.(path);
    return json(route, { Key: `product-images/${path}` });
  });

  await page.route('**/rest/v1/product_variants**', async route => {
    if (route.request().method() === 'GET') return json(route, productVariants());
    return json(route, []);
  });

  await page.route('**/rest/v1/rpc/is_eclado_admin', async route => {
    const currentUser = options.signInUser || authUser;
    const allowed = options.adminAccess ?? Boolean(currentUser?.email && [
      'baby90522@gmail.com',
      'ecladotaiwan@gmail.com',
      'k0919933386@gmail.com',
      'line.u6f71cfa36c3fb2188f54396a5cb58882@ecladotaiwan.com',
    ].includes(currentUser.email.toLowerCase()));
    return json(route, allowed);
  });

  await page.route('**/rest/v1/product_images**', async route => {
    if (route.request().method() === 'GET') return json(route, productImages());
    return json(route, []);
  });

  await page.route('**/rest/v1/products**', async route => {
    const method = route.request().method();
    if (method === 'GET') {
      if (options.productResponseDelayMs) {
        await new Promise(resolve => setTimeout(resolve, options.productResponseDelayMs));
      }
      const url = route.request().url();
      const rows = filterRows(products(), url);
      if (queryValue(url, 'order') === 'id.desc' && queryValue(url, 'limit') === '1') {
        return json(route, [...rows].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 1));
      }
      return json(route, rows);
    }
    if (method === 'POST') {
      const body = route.request().postDataJSON();
      options.onProductInsert?.(body);
      if (options.productWriteError) return json(route, { message: options.productWriteError }, 400);
      return json(route, [body], 201);
    }
    if (method === 'PATCH') {
      const body = route.request().postDataJSON();
      options.onProductUpdate?.(body, route.request().url());
      if (options.productWriteError) return json(route, { message: options.productWriteError }, 400);
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

  await page.route('**/rest/v1/rpc/save_product_with_variants', async route => {
    const request = route.request().postDataJSON();
    options.onProductWithVariantsSave?.(request);
    if (options.productWriteError) return json(route, { message: options.productWriteError }, 400);
    return json(route, {
      product_id: Number(request?.p_product?.id || 999),
      default_variant_id: Number(request?.p_variants?.[0]?.id || 9991),
      variants: request?.p_variants || [],
    });
  });

  await page.route('**/rest/v1/rpc/save_product_images', async route => {
    const request = route.request().postDataJSON();
    options.onProductImagesSave?.(request);
    if (options.productWriteError) return json(route, { message: options.productWriteError }, 400);
    return json(route, {
      product_id: Number(request?.p_product_id),
      images: request?.p_images || [],
    });
  });

  await page.route('**/rest/v1/rpc/create_order_with_pricing', async route => {
    const request = route.request().postDataJSON();
    if (options.orderWriteError) {
      return json(route, { message: options.orderWriteError }, 400);
    }

    const role = String(
      profiles.find(profile => String(profile.id) === String(authUser?.id))?.role || 'consumer',
    );
    const multiplier = role === 'pro' ? 1 : role === 'instructor' ? 0.7 : role === 'distributor' ? 0.65 : null;
    const canBuyPro = ['pro', 'instructor', 'distributor'].includes(role);
    const requestedItems = Array.isArray(request.p_items) ? request.p_items : [];
    const authoritativeItems = requestedItems.map((requested: Record<string, unknown>, index: number) => {
      const product = products().find(row => Number(row.id) === Number(requested.product_id));
      if (!product || product.active === false) throw new Error('mock product not found');
      if (product.is_pro_only && !canBuyPro) throw new Error('mock professional membership required');

      const requestedVariant = requested.variant_id == null ? '' : String(requested.variant_id);
      const variant = requestedVariant
        ? productVariants().find(row =>
          Number(row.product_id) === Number(product.id)
          && [row.id, row.sku, row.size].some(value => String(value || '') === requestedVariant))
        : null;
      const listPrice = Number(variant?.price ?? product.price ?? 0);
      const professionalPrice = Number(variant?.pro_price ?? product.pro_price ?? 0);
      const calculatedUnitPrice = multiplier == null ? listPrice : Math.round(professionalPrice * multiplier);
      const unitPrice = calculatedUnitPrice + (index === 0 ? Number(options.authoritativePriceDelta || 0) : 0);
      const qty = Number(requested.qty);
      const stock = Number(variant?.stock ?? product.stock ?? 0);
      return {
        id: Number(product.id),
        product_id: Number(product.id),
        variant_id: requested.variant_id || null,
        name: Number(product.id) === 2 ? '胜肽修護精華液' : `商品 ${product.id}`,
        nameZh: Number(product.id) === 2 ? '胜肽修護精華液' : `商品 ${product.id}`,
        size: String(variant?.size || ''),
        img: '',
        qty,
        list_price: listPrice,
        professional_price: professionalPrice,
        member_role: role,
        price: unitPrice,
        unit_price: unitPrice,
        line_total: unitPrice * qty,
        stock_at_order: Math.max(0, stock),
        fulfillment_type: stock > 0 ? 'in_stock' : 'preorder',
        fulfillment: stock > 0 ? '現貨商品' : '預購商品',
        shipping_time: stock > 0 ? '出貨時間為 5 個工作天內，每週二出貨' : '出貨時間為 7-14 個工作天',
      };
    });
    const subtotal = authoritativeItems.reduce((sum, item) => sum + item.line_total, 0);
    const promotionCandidates = promotions
      .filter(promotion => {
        const now = Date.now();
        return promotion.active !== false
          && (!promotion.start_at || new Date(String(promotion.start_at)).getTime() <= now)
          && (!promotion.end_at || new Date(String(promotion.end_at)).getTime() > now);
      })
      .map(promotion => {
        const productIds = new Set(((promotion.product_ids as number[]) || []).map(Number));
        const eligibleSubtotal = authoritativeItems
          .filter(item => productIds.has(Number(item.product_id)))
          .reduce((sum, item) => sum + item.line_total, 0);
        const rate = Number(promotion.discount_rate);
        const amount = Number(promotion.discount_amount);
        if (
          eligibleSubtotal <= 0
          || !Number.isFinite(rate) || rate < 0 || rate > 1
          || !Number.isFinite(amount) || amount < 0
        ) return null;
        const finalSubtotal = promotion.discount_order === 'amount_then_rate'
          ? Math.max(0, (eligibleSubtotal - amount) * rate)
          : Math.max(0, eligibleSubtotal * rate - amount);
        return { promotion, discount: Math.round(eligibleSubtotal - finalSubtotal) };
      })
      .filter((candidate): candidate is { promotion: Record<string, unknown>; discount: number } =>
        !!candidate && candidate.discount > 0)
      .sort((a, b) => b.discount - a.discount);
    const selectedPromotion = promotionCandidates[0] || null;
    const discount = selectedPromotion?.discount || 0;
    const discountedSubtotal = Math.max(0, subtotal - discount);
    const professionalRole = ['pro', 'instructor', 'distributor'].includes(role);
    const shipping = professionalRole && discountedSubtotal >= 10000
      ? 0
      : (authoritativeItems.every(item => item.product_id === 9) ? 0 : 120);
    const orderId = `ECL-E2E-${Date.now()}`;
    const status = request.p_payment_method === 'atm' ? 'awaiting_confirm' : 'unpaid';
    const result = {
      order_id: orderId,
      member_role: role,
      items: authoritativeItems,
      subtotal,
      discount,
      shipping,
      total: subtotal - discount + shipping,
      status,
      promotion_id: selectedPromotion?.promotion.id || null,
      promotion_name: selectedPromotion?.promotion.name || null,
      payment_token: `payment-token-${orderId}`,
    };
    options.onOrderInsert?.({
      id: orderId,
      member: request.p_member,
      type: role,
      items: authoritativeItems,
      subtotal,
      discount,
      total: subtotal - discount + shipping,
      status,
      address: request.p_address,
      phone: request.p_phone,
      email: request.p_email,
      note: request.p_note,
      user_id: authUser?.id || null,
      promotion_id: selectedPromotion?.promotion.id || null,
      promotion_name: selectedPromotion?.promotion.name || null,
    });
    return json(route, result);
  });

  await page.route('**/rest/v1/rpc/get_public_sales_orders', async route => {
    const counted = orders
      .filter(order => ['paid', 'preparing', 'shipped', 'delivered'].includes(String(order.status)))
      .slice(0, 1000)
      .map(order => ({ status: order.status, items: order.items || [] }));
    return json(route, counted);
  });

  await page.route('**/rest/v1/rpc/submit_professional_application', async route => {
    const body = route.request().postDataJSON();
    if (!authUser) return json(route, { message: 'Authentication required' }, 403);
    const application = {
      id: `app-e2e-${Date.now()}`,
      studio_name: body.p_studio_name,
      contact_name: body.p_contact_name,
      phone: body.p_phone,
      address: body.p_address,
      social_media: body.p_social_media,
      certificate: body.p_certificate,
      user_id: authUser.id,
      user_email: authUser.email,
      status: 'pending',
      source: 'standalone',
    };
    options.onApplicationInsert?.(application);
    const profile = profiles.find(row => String(row.id) === String(authUser.id));
    if (profile) profile.role = 'pending';
    return json(route, application.id);
  });

  await page.route('**/rest/v1/orders**', async route => {
    const method = route.request().method();
    if (method === 'GET') return json(route, filterRows(orders, route.request().url()));
    if (method === 'POST') {
      const order = route.request().postDataJSON();
      options.onOrderInsert?.(order);
      if (options.orderWriteError) return json(route, { message: options.orderWriteError }, 400);
      return json(route, [{ ...order, created_at: new Date().toISOString() }], 201);
    }
    if (method === 'PATCH') {
      const body = route.request().postDataJSON();
      options.onOrderUpdate?.(body, route.request().url());
      if (options.orderWriteError) return json(route, { message: options.orderWriteError }, 400);
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

  await page.route('**/rest/v1/audit_logs**', async route => {
    if (route.request().method() === 'GET') return json(route, filterRows(auditLogs, route.request().url()));
    return json(route, []);
  });

  await page.route('**/api/admin-delete-member', async route => {
    const body = route.request().postDataJSON();
    const memberId = String(body?.memberId || '');
    options.onMemberDelete?.(memberId);
    const index = profiles.findIndex(profile => String(profile.id) === memberId);
    if (index >= 0) profiles.splice(index, 1);
    return json(route, { ok: true, memberId });
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
      if (options.paymentResponseDelayMs) {
        await new Promise(resolve => setTimeout(resolve, options.paymentResponseDelayMs));
      }
      if (!request.paymentToken) {
        return json(route, { ok: false, error: 'paymentToken is required' }, 401);
      }
      if (options.paymentError) return json(route, { ok: false, error: options.paymentError }, 502);
      const payToken = `PAYTOKEN${Date.now()}`;
      return json(route, {
        ok: true,
        response: {
          Status: 'S',
          Description: '付款單建立成功',
          TSNo: `E2E${Date.now()}`,
          PayToken: request.payType === 'C' ? undefined : payToken,
          CardParam: request.payType === 'C'
            ? { PayToken: payToken, CardPayURL: 'https://sandbox.sinopac.test/pay' }
            : undefined,
          ATMParam: request.payType === 'A'
            ? { AtmPayNo: '8071234567890123' }
            : undefined,
          Echo: request,
        },
      });
    });
    await page.route('https://pay.ecladotaiwan.com/api/sinopac/query-payment', async route => {
      const status = options.paymentQueryStatus || 'paid';
      const payStatus = status === 'paid' ? '1C400' : status === 'pending' ? '1C200' : '1C250';
      return json(route, {
        ok: true,
        response: {
          Status: 'S',
          OrderList: [{ OrderNo: route.request().postDataJSON()?.orderNo, PayStatus: payStatus }],
        },
      });
    });
  }

  await page.route('**/api/line-push', async route => {
    options.onLinePush?.(route.request().postDataJSON());
    if (options.linePushError) return json(route, { error: options.linePushError }, 500);
    return json(route, { ok: true });
  });

  await page.route('**/api/order-email', async route => {
    options.onOrderEmail?.(route.request().postDataJSON());
    return json(route, { status: 'sent', id: 'email_mock' });
  });
}
