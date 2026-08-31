import type { Page, Route } from '@playwright/test';

export const mockProducts = [
  { id: 1, name: 'Deep Cleansing Foam', name_zh: '深層清潔泡沫洗面乳', category: '清潔', size: '200ml', stock: 48, is_pro_only: false, price: 1280, pro_price: 960, series: 'Deep', image_url: 'https://example.com/mock-product-1.jpg', description: '溫和清潔肌膚並維持水潤。', skin_type: '全膚質、敏感肌', ingredients: '胺基酸系界面活性劑、綠茶萃取', features: ['溫和低刺激配方', '洗後保濕不緊繃'], active: true },
  { id: 2, name: 'Peptide Repair Serum', name_zh: '胜肽修護精華液', category: '精華液', size: '30ml', stock: 2, is_pro_only: false, price: 3980, pro_price: 2980, series: 'Cell', image_url: 'https://example.com/mock-product-2.jpg', description: '多重胜肽與保濕修護配方。', skin_type: '乾燥肌、熟齡肌', ingredients: '乙醯六胜肽-8、玻尿酸鈉', features: ['多重胜肽複合修護', '深層長效補水'], active: true },
  { id: 3, name: 'SOS Ampoule Set', name_zh: '急救修護安瓶組', category: '急救安瓶', size: '5ml×6', stock: 15, is_pro_only: false, price: 4800, pro_price: 3600, image_url: 'https://example.com/mock-product-3.jpg', description: '膚況不穩定時的集中護理。', skin_type: '敏弱肌', ingredients: '積雪草萃取、玻尿酸鈉', features: ['即時鎮靜舒緩'], active: true },
  { id: 4, name: 'Intensive Hydra Mask', name_zh: '密集保濕面膜', category: '面膜', size: '35ml×10', stock: 1, is_pro_only: false, price: 2200, pro_price: 1650, image_url: 'https://example.com/mock-product-4.jpg', description: '密集補水面膜。', skin_type: '乾燥缺水肌', ingredients: '玻尿酸鈉', features: ['長效肌膚保濕'], active: true },
  { id: 5, name: 'Eye Contour Complex', name_zh: '眼周緊緻精華', category: '眼霜', size: '30ml', stock: 22, is_pro_only: false, price: 2800, pro_price: 2100, image_url: 'https://example.com/mock-product-5.jpg', description: '眼周高保濕修護精華。', skin_type: '乾燥眼周肌膚', ingredients: '植物性角鯊烷', features: ['眼周深層滋養'], active: true },
  { id: 6, name: 'Cell Recovery Cream', name_zh: '細胞修護乳霜', category: '面霜', size: '50g', stock: 8, is_pro_only: false, price: 3600, pro_price: 2700, image_url: 'https://example.com/mock-product-6.jpg', description: '滋潤型修護乳霜。', skin_type: '熟齡肌、乾燥肌', ingredients: '維他命E、腺苷', features: ['強化肌膚保水屏障'], active: true },
  { id: 7, name: 'NK Cell Activator', name_zh: 'NK細胞活化安瓶', category: '急救安瓶', size: '3.5ml×10', stock: 0, is_pro_only: true, price: 8800, pro_price: 6600, series: 'Air jet', image_url: 'https://example.com/mock-product-7.jpg', description: '針對彈性不足膚況設計的安瓶。', skin_type: '彈性不足肌', ingredients: '植物培養萃取', features: ['院線專業集中護理'], active: true },
  { id: 8, name: 'AHA/BHA Peeling Gel', name_zh: 'AHA·BHA·PHA 煥膚凝膠', category: '清潔', size: '120ml', stock: 31, is_pro_only: false, price: 1980, pro_price: 1485, image_url: 'https://example.com/mock-product-8.jpg', description: '三酸溫和煥膚凝膠。', skin_type: '混合肌', ingredients: '乳酸、葡萄糖酸內酯', features: ['三酸溫和煥膚'], active: true },
  { id: 9, name: 'Payment Test Product', name_zh: '金流測試商品', category: '清潔', size: '測試用', stock: 100, is_pro_only: false, price: 5, pro_price: 5, image_url: 'https://example.com/mock-product-9.jpg', description: '僅供自動化金流測試。', skin_type: '測試用途', ingredients: '測試品項', features: ['低金額測試'], active: true },
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
  { id: 1, name: 'Deep Cleansing Foam', name_zh: '深層清潔泡沫洗面乳', category: '清潔', series: 'Deep', size: '200ml', price: 1280, pro_price: 960, stock: 48, min_stock: 3, is_pro_only: false, active: true },
  { id: 2, name: 'Peptide Repair Serum', name_zh: '胜肽修護精華液', category: '精華液', series: 'Cell', size: '30ml', price: 3980, pro_price: 2980, stock: 2, min_stock: 3, is_pro_only: false, active: true },
  { id: 7, name: 'NK Cell Activator', name_zh: 'NK細胞活化安瓶', category: '急救安瓶', series: 'Air jet', size: '3.5ml×10', price: 8800, pro_price: 6600, stock: 0, min_stock: 3, is_pro_only: true, active: true },
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
    payment_method: 'atm',
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
    payment_method: 'card',
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

export const procurementProductVariants = [
  { id: 1, product_id: 11, sku: 'E-96A', name_zh: '氧氣泡泡', name_en: 'Oxygen Bubble Cleanser', specification: '120g', unit_cost: 8.52, cost_configured: true, available_stock: 11 },
  { id: 2, product_id: 12, sku: 'F-588C', name_zh: '金箔片', name_en: 'Gold Foil Sheet', specification: '1pc', unit_cost: 12.4, cost_configured: true, available_stock: 0 },
  { id: 3, product_id: 13, sku: 'F-63', name_zh: 'VONO煥膚組', name_en: 'VONO Peeling Set', specification: '1set', unit_cost: 21.85, cost_configured: true, available_stock: 4 },
  { id: 4, product_id: 14, sku: '239', name_zh: '精萃防曬乳', name_en: 'Exo Clinica UV Suncream', specification: '50g', unit_cost: null, cost_configured: false, available_stock: 7 },
];

export const procurementAddresses = [
  { id: 1, address_text: '이름:우리무역\n주소:04569\n서울특별시 중구 흥인동 125 써니빌딩 505호 (ZC8)\n전화:010-5851-0702', is_default: true, active: true, usage_count: 2 },
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
  onApplicationNotice?: (request: Record<string, unknown>) => void;
  onPurchaseOrderSave?: (request: Record<string, unknown>) => void;
  onPurchaseOrderDelete?: (orderId: number) => void;
  onLinePush?: (body: Record<string, unknown>) => void;
  onOrderEmail?: (body: Record<string, unknown>) => void;
  onPaymentRequest?: (body: Record<string, unknown>) => void;
  onPaymentRetryRequest?: (request: { authorization: string; body: Record<string, unknown> }) => void;
  onPaymentSummaryRequest?: (authorization: string) => void;
  onPaymentInstructionRequest?: (request: { authorization: string; orderNo: string }) => void;
  onGuestLookupRequest?: (request: { lookupCode: string; phone: string }) => void;
  onGuestDetailsRequest?: (request: { orderNo: string; guestAccessToken: string }) => void;
  paymentQueryStatus?: 'paid' | 'pending' | 'failed' | 'expired' | 'cancelled';
  productWriteError?: string;
  orderWriteError?: string;
  promotionWriteError?: string;
  linePushError?: string;
  paymentError?: string;
  paymentInstructionError?: string;
  guestLookupError?: string;
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
  procurementOrders?: Record<string, unknown>[];
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
  const applications = (options.applications || []).map(application => ({ ...application }));
  const auditLogs = options.auditLogs || [];
  const authUser = options.authUser;
  const procurement = {
    product_variants: procurementProductVariants.map(item => ({ ...item })) as Record<string, unknown>[],
    addresses: procurementAddresses.map(address => ({ ...address })) as Record<string, unknown>[],
    orders: (options.procurementOrders || []).map(order => ({ ...order })) as Record<string, unknown>[],
  };

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

  await page.route('**/rest/v1/rpc/get_storefront_catalog', async route => {
    if (options.productResponseDelayMs) {
      await new Promise(resolve => setTimeout(resolve, options.productResponseDelayMs));
    }
    const role = String(
      profiles.find(profile => String(profile.id) === String(authUser?.id))?.role || 'consumer',
    );
    const canViewProfessionalPrice = ['pro', 'instructor', 'distributor'].includes(role);
    const publicProducts = products()
      .filter(product => product.active !== false && (product.publication_status || 'active') === 'active')
      .map(product => ({
        ...product,
        min_stock: undefined,
        variants: undefined,
        pro_price: canViewProfessionalPrice ? product.pro_price : null,
        stock: Number(product.stock) > 0 ? 1 : 0,
      }));
    const publicVariants = productVariants()
      .filter(variant => variant.active !== false)
      .map(variant => ({
        ...variant,
        sku: undefined,
        pro_price: canViewProfessionalPrice ? variant.pro_price : null,
        stock: Number(variant.stock) > 0 ? 1 : 0,
      }));
    return json(route, {
      products: publicProducts,
      variants: publicVariants,
      images: productImages().filter(image => image.active !== false),
    });
  });

  await page.route('**/rest/v1/rpc/get_admin_catalog', async route => json(route, {
    products: products(),
    variants: productVariants(),
    images: productImages().filter(image => image.active !== false),
  }));

  await page.route('**/rest/v1/rpc/get_admin_order_payment_methods', async route => json(route,
    orders
      .filter(order => order.payment_method)
      .map(order => ({ order_id: order.id, payment_method: order.payment_method })),
  ));

  await page.route('**/rest/v1/rpc/get_procurement_management_data', async route => json(route, procurement));

  await page.route('**/rest/v1/rpc/save_procurement_address', async route => {
    const request = route.request().postDataJSON();
    const incoming = request.p_address || {};
    const id = Number(incoming.id || Math.max(0, ...procurement.addresses.map(address => Number(address.id))) + 1);
    const saved = { ...incoming, id, active: true, usage_count: Number(incoming.usage_count || 0) };
    const index = procurement.addresses.findIndex(address => Number(address.id) === id);
    if (index >= 0) procurement.addresses[index] = saved;
    else procurement.addresses.unshift(saved);
    return json(route, saved);
  });

  await page.route('**/rest/v1/rpc/archive_procurement_address', async route => {
    const id = Number(route.request().postDataJSON()?.p_address_id);
    procurement.addresses = procurement.addresses.filter(address => Number(address.id) !== id);
    return json(route, null);
  });

  await page.route('**/rest/v1/rpc/save_purchase_order', async route => {
    const request = route.request().postDataJSON();
    options.onPurchaseOrderSave?.(request);
    const incoming = request.p_order || {};
    const incomingItems = Array.isArray(request.p_items) ? request.p_items : [];
    const id = Number(incoming.id || procurement.orders.length + 1);
    const totalUsd = incomingItems.reduce((sum: number, item: Record<string, unknown>) => (
      sum + Number(item.quantity || 0) * Number(item.unit_cost || 0)
    ), 0);
    const savedItems = incomingItems.map((item: Record<string, unknown>, index: number) => {
      const source = procurement.product_variants.find(candidate => Number(candidate.id) === Number(item.product_variant_id));
      return {
        ...item,
        id: index + 1,
        purchase_order_id: id,
        product_sku: source?.sku,
        name_zh: source?.name_zh,
        name_en: source?.name_en,
        specification: source?.specification,
        subtotal_usd: Number(item.quantity || 0) * Number(item.unit_cost || 0),
        sort_order: index,
      };
    });
    const saved = {
      ...incoming,
      id,
      po_number: incoming.po_number || `PO-20260827-${String(id).padStart(4, '0')}`,
      supplier_name: 'ECLADO',
      supplier_code: 'ECLADO',
      total_usd: totalUsd,
      total_twd: totalUsd * Number(incoming.exchange_rate || 0),
      created_at: incoming.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      items: savedItems,
    };
    const index = procurement.orders.findIndex(order => Number(order.id) === id);
    if (index >= 0) procurement.orders[index] = saved;
    else procurement.orders.unshift(saved);
    return json(route, saved);
  });

  await page.route('**/rest/v1/rpc/update_purchase_order_status', async route => {
    const request = route.request().postDataJSON();
    const order = procurement.orders.find(item => Number(item.id) === Number(request.p_order_id));
    if (!['draft', 'pending', 'ordered', 'shipping', 'received'].includes(String(request.p_status))) {
      return json(route, { message: 'Invalid purchase order status' }, 400);
    }
    if (order && ['ordered', 'shipping', 'received'].includes(String(order.status)) && ['draft', 'pending'].includes(String(request.p_status))) {
      return json(route, { message: 'Processed purchase orders cannot return to draft or pending' }, 400);
    }
    if (order) order.status = request.p_status;
    return json(route, order || null);
  });

  await page.route('**/rest/v1/rpc/delete_purchase_order', async route => {
    const orderId = Number(route.request().postDataJSON()?.p_order_id);
    const index = procurement.orders.findIndex(item => Number(item.id) === orderId);
    if (index < 0) return json(route, { message: 'Purchase order not found' }, 404);
    if (!['draft', 'pending'].includes(String(procurement.orders[index].status))) {
      return json(route, { message: 'Only draft or pending purchase orders can be deleted' }, 400);
    }
    procurement.orders.splice(index, 1);
    options.onPurchaseOrderDelete?.(orderId);
    return json(route, null);
  });

  await page.route('**/rest/v1/rpc/set_product_publication_status', async route => {
    const request = route.request().postDataJSON();
    options.onProductUpdate?.(
      { publication_status: request.p_publication_status },
      `id=eq.${request.p_product_id}`,
    );
    if (options.productWriteError) return json(route, { message: options.productWriteError }, 400);
    return json(route, null);
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
      const primaryImage = productImages()
        .filter(row => Number(row.product_id) === Number(product.id) && row.active !== false)
        .sort((a, b) => Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary))
          || Number(a.sort_order || 0) - Number(b.sort_order || 0))[0];
      return {
        id: Number(product.id),
        product_id: Number(product.id),
        variant_id: requested.variant_id || null,
        name: Number(product.id) === 2 ? '胜肽修護精華液' : `商品 ${product.id}`,
        nameZh: Number(product.id) === 2 ? '胜肽修護精華液' : `商品 ${product.id}`,
        size: String(variant?.size || ''),
        image_storage_path: primaryImage?.storage_path || null,
        img: '',
        qty,
        list_price: listPrice,
        professional_price: professionalPrice,
        member_role: role,
        price: unitPrice,
        unit_price: unitPrice,
        line_total: unitPrice * qty,
        stock_at_order: Math.max(0, stock),
        is_custom_order: variant?.is_custom_order === true,
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
    const fulfillmentMethod = String(request.p_fulfillment_method || 'delivery');
    if (!['delivery', 'onsite_pickup'].includes(fulfillmentMethod)) {
      return json(route, { message: 'Invalid fulfillment method' }, 400);
    }
    if (fulfillmentMethod === 'onsite_pickup' && !authoritativeItems.every(item => item.is_custom_order)) {
      return json(route, { message: 'Onsite pickup is available only for custom-order variants' }, 403);
    }
    const professionalRole = ['pro', 'instructor', 'distributor'].includes(role);
    const shipping = fulfillmentMethod === 'onsite_pickup'
      ? 0
      : professionalRole && discountedSubtotal >= 15000
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
      fulfillment_method: fulfillmentMethod,
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
      fulfillment_method: fulfillmentMethod,
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

  await page.route('**/rest/v1/rpc/get_public_sales_stats', async route => {
    const totals = new Map<number, number>();
    orders
      .filter(order => ['paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered'].includes(String(order.status)))
      .forEach(order => (order.items || []).forEach((item: Record<string, unknown>) => {
        if (item.is_custom_order === true || item.isCustomOrder === true) return;
        const productId = Number(item.product_id);
        if (Number.isFinite(productId) && productId > 0) {
          totals.set(productId, (totals.get(productId) || 0) + Math.max(1, Number(item.qty) || 1));
        }
      }));
    return json(route, [...totals.entries()].map(([product_id, sold_qty]) => ({ product_id, sold_qty })));
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

  await page.route('**/api/professional-application-notice', async route => {
    const body = route.request().postDataJSON();
    options.onApplicationNotice?.(body);
    return json(route, { ok: true, channel: 'line', status: 'approved' });
  });

  await page.route('**/rest/v1/professional_applications**', async route => {
    if (route.request().method() === 'GET') return json(route, filterRows(applications, route.request().url()));
    if (route.request().method() === 'POST') {
      return json(route, [{ id: '22222222-2222-4222-8222-222222222222', status: 'pending' }], 201);
    }
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      options.onApplicationUpdate?.(body, route.request().url());
      const id = queryValue(route.request().url(), 'id').replace(/^eq\./, '');
      const application = applications.find(row => String(row.id) === id);
      if (application) Object.assign(application, body);
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
        recoveryStored: true,
        guestLookupCode: authUser ? '' : 'ABCDE-12345',
        orderEmailSent: !authUser,
        order: {
          id: request.orderNo,
          status: request.payType === 'A' ? 'awaiting_confirm' : 'unpaid',
          total: request.amount,
          payment_due_at: '2026-08-19T15:59:00.000Z',
        },
        request: {
          PayType: request.payType,
          ATMParam: request.payType === 'A'
            ? { ExpireDate: '20260819', ExpireTime: '2359' }
            : undefined,
        },
        response: {
          Status: 'S',
          Description: '付款單建立成功',
          TSNo: `E2E${Date.now()}`,
          PayToken: request.payType === 'C' ? undefined : payToken,
          CardParam: request.payType === 'C'
            ? { PayToken: payToken, CardPayURL: 'https://sandbox.sinopac.test/pay' }
            : undefined,
          MobileParam: request.payType === 'M'
            ? { PayToken: payToken, MobilePayURL: 'https://sandbox.sinopac.test/mobile-pay' }
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
      const payStatus = status === 'paid' ? '1C400' : status === 'pending' || status === 'expired' || status === 'cancelled' ? '1C200' : '1C250';
      const orderStatus = status === 'paid' ? 'paid' : status === 'cancelled' || status === 'expired' ? 'cancelled' : 'unpaid';
      return json(route, {
        ok: true,
        paymentState: status,
        order: {
          id: route.request().postDataJSON()?.orderNo,
          status: orderStatus,
          total: 3702,
          payment_due_at: status === 'expired' ? '2020-01-01T00:00:00.000Z' : '2026-08-19T15:59:00.000Z',
        },
        response: {
          Status: 'S',
          OrderList: [{ OrderNo: route.request().postDataJSON()?.orderNo, PayStatus: payStatus }],
        },
      });
    });
    await page.route('https://pay.ecladotaiwan.com/api/sinopac/retry-payment', async route => {
      const request = route.request().postDataJSON();
      options.onPaymentRetryRequest?.({
        authorization:route.request().headers().authorization || '',
        body:request,
      });
      return json(route, {
        ok: true,
        order: { id: request.orderNo, status: 'unpaid', total: 3980 },
        response: {
          Status: 'S',
          Description: '重新付款單建立成功',
          CardParam: { CardPayURL: 'https://sandbox.sinopac.test/retry-pay' },
        },
        paymentLink: 'https://sandbox.sinopac.test/retry-pay',
        resultAccessToken: 'retry-result-access-token',
        attemptNo: 2,
      });
    });
    await page.route('https://pay.ecladotaiwan.com/api/orders/member-payment-summaries', async route => {
      const authorization = route.request().headers().authorization || '';
      options.onPaymentSummaryRequest?.(authorization);
      if (!authorization) return json(route, { ok:false, error:'請先登入會員' }, 401);
      const summaries = orders
        .filter(order => order.user_id && ['awaiting_confirm', 'unpaid'].includes(String(order.status)))
        .map(order => ({
          order_id:order.id,
          payment_method:order.payment_method || 'atm',
          payment_state:options.paymentQueryStatus || 'pending',
          payment_due_at:order.payment_due_at || '2099-01-01T00:00:00.000Z',
          can_retry:(options.paymentQueryStatus === 'failed')
            && order.status === 'unpaid'
            && ['card', 'apple', 'google'].includes(String(order.payment_method || '').toLowerCase()),
        }));
      return json(route, { ok:true, summaries });
    });
    await page.route('https://pay.ecladotaiwan.com/api/orders/payment-instructions', async route => {
      if (options.paymentInstructionError) {
        return json(route, { ok: false, error: options.paymentInstructionError }, 400);
      }
      const orderNo = String(route.request().postDataJSON()?.orderNo || '');
      options.onPaymentInstructionRequest?.({
        authorization: route.request().headers().authorization || '',
        orderNo,
      });
      const order = orders.find(candidate => String(candidate.id) === orderNo);
      if (!order) return json(route, { ok: false, error: 'Payment instruction not found' }, 404);
      return json(route, {
        ok: true,
        paymentState: options.paymentQueryStatus || 'pending',
        order,
        instruction: {
          order_id: orderNo,
          payment_method: order.payment_method || 'atm',
          payment_state: options.paymentQueryStatus || 'pending',
          provider_transaction_no: 'MEMBER-E2E-TSNO',
          provider_status: 'S',
          provider_description: '付款單建立成功',
          atm_bank_code: order.payment_method === 'atm' ? '807' : null,
          atm_account: order.payment_method === 'atm' ? '8079988776655443' : null,
          payment_url: order.payment_method === 'atm' ? null : 'https://sandbox.sinopac.test/member-pay',
          payment_due_at: order.payment_due_at || '2099-01-01T00:00:00.000Z',
        },
      });
    });
    await page.route('https://pay.ecladotaiwan.com/api/orders/guest-lookup', async route => {
      const request = route.request().postDataJSON() || {};
      options.onGuestLookupRequest?.({
        lookupCode: String(request.lookupCode || ''),
        phone: String(request.phone || ''),
      });
      if (options.guestLookupError) {
        return json(route, { ok: false, error: options.guestLookupError }, 400);
      }
      const compactCode = String(request.lookupCode || '').toUpperCase().replace(/[^0-9A-F]/g, '');
      const normalizedPhone = String(request.phone || '').replace(/\D/g, '');
      const order = orders.find(candidate => (
        String(candidate.public_lookup_code || '').replace(/[^0-9A-F]/gi, '').toUpperCase() === compactCode
        && String(candidate.phone || '').replace(/\D/g, '') === normalizedPhone
        && !candidate.user_id
      ));
      if (!order) return json(route, { ok: false, error: '查詢資料不正確，請確認查詢碼與手機號碼。' }, 400);
      const paymentState = options.paymentQueryStatus
        || (['paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered'].includes(String(order.status)) ? 'paid'
          : order.status === 'cancelled' ? 'cancelled' : 'pending');
      const pending = paymentState === 'pending';
      return json(route, {
        ok: true,
        paymentState,
        order,
        guestAccessToken: 'guest-access-token-e2e',
        instruction: {
          order_id: order.id,
          payment_method: order.payment_method || 'atm',
          payment_state: paymentState,
          provider_transaction_no: 'GUEST-E2E-TSNO',
          provider_status: 'S',
          provider_description: '付款單建立成功',
          atm_bank_code: pending && order.payment_method === 'atm' ? '807' : null,
          atm_account: pending && order.payment_method === 'atm' ? '8071122334455667' : null,
          payment_url: pending && order.payment_method !== 'atm' ? 'https://sandbox.sinopac.test/guest-pay' : null,
          payment_due_at: order.payment_due_at || '2099-01-01T00:00:00.000Z',
        },
      });
    });
    await page.route('https://pay.ecladotaiwan.com/api/orders/guest-details', async route => {
      const request = route.request().postDataJSON() || {};
      const orderNo = String(request.orderNo || '');
      const guestAccessToken = String(request.guestAccessToken || '');
      options.onGuestDetailsRequest?.({ orderNo, guestAccessToken });
      if (options.guestLookupError || guestAccessToken !== 'guest-access-token-e2e') {
        return json(route, { ok: false, error: '訪客訂單查詢授權已過期，請重新輸入查詢碼與手機號碼。' }, 401);
      }
      const order = orders.find(candidate => String(candidate.id) === orderNo && !candidate.user_id);
      if (!order) return json(route, { ok: false, error: '訪客訂單查詢授權已過期，請重新輸入查詢碼與手機號碼。' }, 401);
      const paymentState = options.paymentQueryStatus
        || (['paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered'].includes(String(order.status)) ? 'paid'
          : order.status === 'cancelled' ? 'cancelled' : 'pending');
      const pending = paymentState === 'pending';
      return json(route, {
        ok: true,
        paymentState,
        order,
        guestAccessToken,
        instruction: {
          order_id: order.id,
          payment_method: order.payment_method || 'atm',
          payment_state: paymentState,
          provider_status: 'S',
          provider_description: '付款單建立成功',
          atm_bank_code: pending && order.payment_method === 'atm' ? '807' : null,
          atm_account: pending && order.payment_method === 'atm' ? '8071122334455667' : null,
          payment_url: pending && order.payment_method !== 'atm' ? 'https://sandbox.sinopac.test/guest-pay' : null,
          payment_due_at: order.payment_due_at || '2099-01-01T00:00:00.000Z',
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
