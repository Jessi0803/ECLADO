const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// 在 require server.js 前先備妥金鑰環境（豐收款 sandbox 範例值），
// getAesKey / buildCreateBody 於呼叫時才讀取，設定於此即可。
process.env.SINOPAC_A1 = process.env.SINOPAC_A1 || '65960834240E44B7';
process.env.SINOPAC_A2 = process.env.SINOPAC_A2 || '2831076A098E49E7';
process.env.SINOPAC_B1 = process.env.SINOPAC_B1 || 'CB1AFFBF915A492B';
process.env.SINOPAC_B2 = process.env.SINOPAC_B2 || '7F242C0AA612454F';
process.env.SINOPAC_SHOP_NO = process.env.SINOPAC_SHOP_NO || 'NA0636_001';
process.env.PAYMENT_PUBLIC_URL = process.env.PAYMENT_PUBLIC_URL || 'https://pay.ecladotaiwan.com';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://supabase.example.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
process.env.ORDER_CLEANUP_KEY = process.env.ORDER_CLEANUP_KEY || 'test-cleanup-key';
process.env.PAYMENT_NOTIFY_SECRET = process.env.PAYMENT_NOTIFY_SECRET || 'test-payment-notify-secret';
process.env.GUEST_LOOKUP_SECRET = process.env.GUEST_LOOKUP_SECRET || 'test-guest-lookup-secret';

const server = require('./server.js');

async function listenForTest() {
  const listener = http.createServer(server.app);
  await new Promise(resolve => {
    listener.listen(0, '127.0.0.1', resolve);
  });
  return {
    listener,
    baseUrl: `http://127.0.0.1:${listener.address().port}`,
  };
}

test('exports pure helpers without starting the server', () => {
  for (const fn of ['getAesKey', 'encryptMessage', 'decryptMessage', 'isPaidLike', 'buildCreateBody', 'signableString', 'generateSign']) {
    assert.equal(typeof server[fn], 'function', `應匯出 ${fn}`);
  }
});

test('ORDER_CLEANUP_KEY 必須設定，且清理金鑰需完全一致', () => {
  const originalKey = process.env.ORDER_CLEANUP_KEY;
  delete process.env.ORDER_CLEANUP_KEY;
  assert.throws(() => server.validateRequiredRuntimeEnv(), /Missing env: ORDER_CLEANUP_KEY/);
  assert.equal(server.hasValidCleanupKey('test-cleanup-key'), false);

  process.env.ORDER_CLEANUP_KEY = originalKey;
  assert.doesNotThrow(() => server.validateRequiredRuntimeEnv());
  assert.equal(server.hasValidCleanupKey(originalKey), true);
  assert.equal(server.hasValidCleanupKey(`${originalKey}-wrong`), false);
  assert.equal(server.hasValidCleanupKey(''), false);
});

test('PAYMENT_NOTIFY_SECRET 必須設定', () => {
  const originalSecret = process.env.PAYMENT_NOTIFY_SECRET;
  delete process.env.PAYMENT_NOTIFY_SECRET;
  assert.throws(() => server.validateRequiredRuntimeEnv(), /Missing env: PAYMENT_NOTIFY_SECRET/);

  process.env.PAYMENT_NOTIFY_SECRET = originalSecret;
  assert.doesNotThrow(() => server.validateRequiredRuntimeEnv());
});

test('訪客查詢碼、手機正規化與短效查詢憑證', () => {
  assert.equal(server.normalizeLookupCode('abcde 12345'), 'ABCDE-12345');
  assert.equal(server.normalizeLookupCode('too-short'), '');
  assert.equal(server.normalizePhone('+886 912-345-678'), '0912345678');
  const token = server.createGuestAccessToken('ECL-GUEST-001', 60_000);
  assert.equal(server.verifyGuestAccessToken(token, 'ECL-GUEST-001'), true);
  assert.equal(server.verifyGuestAccessToken(token, 'ECL-GUEST-OTHER'), false);
  assert.equal(server.verifyGuestAccessToken(server.createGuestAccessToken('ECL-GUEST-001', -1), 'ECL-GUEST-001'), false);
});

test('訪客付款單建立後寄送含查詢碼的訂單成立信並記錄結果', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === 'https://ecladotaiwan.com/api/order-email') {
      assert.equal(options.headers['X-ECLADO-Payment-Secret'], process.env.PAYMENT_NOTIFY_SECRET);
      const body = JSON.parse(options.body);
      assert.equal(body.lookupCode, 'ABCDE-12345');
      assert.equal(body.lookupUrl, 'https://ecladotaiwan.com/order-lookup?lookup=ABCDE-12345');
      return new Response(JSON.stringify({ status: 'sent' }), { status: 200 });
    }
    if (String(url).includes('/rest/v1/order_payment_instructions?order_id=eq.')) {
      const body = JSON.parse(options.body);
      assert.ok(body.order_email_sent_at);
      assert.equal(body.order_email_error, null);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const result = await server.sendGuestOrderCreatedEmail({
      id: 'ECL-GUEST-EMAIL-001', user_id: null, member: '訪客買家', email: 'guest@example.com',
      total: 4100, public_lookup_code: 'ABCDE-12345', payment_due_at: '2099-01-01T00:00:00.000Z',
    });
    assert.equal(result.sent, true);
    assert.equal(calls.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('付款通知轉發會帶共用密鑰，且檢查 Vercel 回應', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(String(url), 'https://ecladotaiwan.com/api/sinopac/notify');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['X-ECLADO-Payment-Secret'], process.env.PAYMENT_NOTIFY_SECRET);
    assert.deepEqual(JSON.parse(options.body), { OrderNo: 'ECL-NOTIFY-001', Status: 'S' });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    assert.deepEqual(await server.forwardPaidNotification('ECL-NOTIFY-001'), { sent: true });
  } finally {
    global.fetch = originalFetch;
  }
});

test('Vercel 拒絕付款通知時，Vultr 會留下明確失敗結果', async () => {
  const originalFetch = global.fetch;
  const originalError = console.error;
  const errors = [];
  global.fetch = async () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  console.error = (...args) => errors.push(args.join(' '));

  try {
    const result = await server.forwardPaidNotification('ECL-NOTIFY-002');
    assert.equal(result.sent, false);
    assert.match(result.reason, /Vercel notify HTTP 401/);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /notify forward.*401/);
  } finally {
    global.fetch = originalFetch;
    console.error = originalError;
  }
});

test('付款 webhook 日誌摘要不包含 PayToken 值或完整 payload', () => {
  const summary = server.summarizePaymentWebhook({
    OrderNo: 'ECL-LOG-001',
    PayToken: 'SECRET-PAY-TOKEN-123',
    PayType: 'C',
    PayStatus: '1C400',
    CardNo: '4111111111111111',
  });
  assert.deepEqual(summary, {
    keys: ['CardNo', 'OrderNo', 'PayStatus', 'PayToken', 'PayType'],
    orderNo: 'ECL-LOG-001',
    payType: 'C',
    payStatus: '1C400',
    hasPayToken: true,
  });
  assert.equal(JSON.stringify(summary).includes('SECRET-PAY-TOKEN-123'), false);
  assert.equal(JSON.stringify(summary).includes('4111111111111111'), false);
});

test('已付款事件只有在通知轉發或 Supabase 至少一邊成功時才可回覆成功', () => {
  assert.equal(server.canAcknowledgePaymentWebhook({ paid: true }, { sent: false }, false), false);
  assert.equal(server.canAcknowledgePaymentWebhook({ paid: true }, { sent: true }, false), true);
  assert.equal(server.canAcknowledgePaymentWebhook({ paid: true }, { sent: false }, true), true);
  assert.equal(server.canAcknowledgePaymentWebhook({ paid: false }, { sent: false }, false), true);
});

test('付款通知補償工作只重送已到重試時間且尚未送達的訂單', async () => {
  const originalFetch = global.fetch;
  const forwarded = [];
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith(`${process.env.SUPABASE_URL}/rest/v1/orders?`)) {
      const query = new URL(target).searchParams;
      assert.equal(query.get('status'), 'in.(paid,preparing,shipped,delivered)');
      assert.equal(query.get('payment_notification_sent_at'), 'is.null');
      assert.match(query.get('or'), /payment_notification_next_retry_at/);
      return new Response(JSON.stringify([
        { id: 'ECL-RETRY-001' },
        { id: 'ECL-RETRY-002' },
      ]), { status: 200 });
    }
    if (target === 'https://ecladotaiwan.com/api/sinopac/notify') {
      const orderNo = JSON.parse(options.body).OrderNo;
      forwarded.push(orderNo);
      return orderNo === 'ECL-RETRY-001'
        ? new Response(JSON.stringify({ ok: true }), { status: 200 })
        : new Response(JSON.stringify({ error: 'temporary failure' }), { status: 503 });
    }
    throw new Error(`Unexpected fetch: ${target}`);
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await server.retryPendingPaymentNotifications({ limit: 2 });
    assert.equal(result.checked, 2);
    assert.equal(result.sent, 1);
    assert.deepEqual(forwarded, ['ECL-RETRY-001', 'ECL-RETRY-002']);
  } finally {
    global.fetch = originalFetch;
    console.error = originalError;
  }
});

test('isPaidLike: 授權/請款/付款完成算已付款；待付款/逾期不算', () => {
  // 已付款（規格書 §10.2）
  assert.equal(server.isPaidLike('1C300'), true, '1C300 已授權未請款');
  assert.equal(server.isPaidLike('1C400'), true, '1C400 請款完成');
  assert.equal(server.isPaidLike('1A400'), true, '1A400 ATM付款完成');
  assert.equal(server.isPaidLike('1M400'), true, '1M400 行動支付付款完成');
  assert.equal(server.isPaidLike('S'), true);
  assert.equal(server.isPaidLike('Y'), true);
  // 不算已付款
  assert.equal(server.isPaidLike('1C200'), false, '1C200 待付款不算');
  assert.equal(server.isPaidLike('1C250'), false, '1C250 刷卡逾期不算');
  assert.equal(server.isPaidLike('1C350'), false, '1C350 授權失效不算');
  assert.equal(server.isPaidLike(''), false);
  assert.equal(server.isPaidLike(undefined), false);
});

test('isPendingLike: 待付款類', () => {
  assert.equal(server.isPendingLike('N'), true);
  assert.equal(server.isPendingLike('PENDING'), true);
  assert.equal(server.isPendingLike('1C400'), false);
});

test('AES key 為 32 bytes（AES-256），加解密可往返', () => {
  const aesKey = server.getAesKey();
  assert.equal(aesKey.length, 32, 'AES key 應為 32 字元 hex');
  assert.equal(Buffer.from(aesKey, 'ascii').length, 32, '當金鑰使用應為 32 bytes（AES-256）');

  const nonce = 'nonce-server-123';
  const plain = JSON.stringify({ ShopNo: 'NA0636_001', PayToken: 'PT-S-001' });
  const cipher = server.encryptMessage(aesKey, plain, nonce);
  assert.equal(server.decryptMessage(aesKey, cipher, nonce), plain);
});

test('signableString 排序（不分大小寫）並排除空值/物件', () => {
  assert.equal(server.signableString({ b: '2', A: '1', blank: '', nested: {}, n: null }), 'A=1&b=2');
});

test('generateSign 對相同輸入穩定、對不同 nonce 改變', () => {
  const aesKey = server.getAesKey();
  const obj = { ShopNo: 'NA0636_001', PayToken: 'PT-X' };
  const s1 = server.generateSign(obj, aesKey, 'nonceA');
  const s2 = server.generateSign(obj, aesKey, 'nonceA');
  const s3 = server.generateSign(obj, aesKey, 'nonceB');
  assert.equal(s1, s2);
  assert.notEqual(s1, s3);
  assert.match(s1, /^[0-9A-F]+$/);
});

test('buildCreateBody: 信用卡 AutoBilling=Y，且 BackendURL 強制指向本服務', () => {
  const body = server.buildCreateBody({
    orderNo: 'ECL-UNIT-001',
    amount: 100,
    payType: 'C',
    prdtName: '單元測試',
    backendUrl: 'https://www.ecladotaiwan.com/api/sinopac/notify', // 應被忽略
    returnUrl: 'https://pay.ecladotaiwan.com/return',
  });
  assert.equal(body.PayType, 'C');
  assert.equal(body.Amount, 10000, '金額需 ×100（含小數二位）');
  assert.deepEqual(body.CardParam, { AutoBilling: 'Y' });
  assert.equal(body.BackendURL, 'https://pay.ecladotaiwan.com/api/sinopac/notify', 'BackendURL 應強制走本服務，忽略傳入值');
});

test('buildCreateBody: ATM 帶 ATMParam；金額為 0 應拋錯', () => {
  const atm = server.buildCreateBody({ orderNo: 'ECL-UNIT-002', amount: 50, payType: 'A', expireDate: '20260701', expireTime: '1200' });
  assert.equal(atm.PayType, 'A');
  assert.ok(atm.ATMParam, '應帶 ATMParam');
  assert.throws(() => server.buildCreateBody({ orderNo: 'X', amount: 0, payType: 'A' }), /amount/);
});

test('buildAuthoritativeCreateBody: 忽略呼叫端 amount，使用資料庫訂單 total', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.match(String(url), /rpc\/claim_order_payment$/);
    assert.equal(options.headers.apikey, process.env.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal(options.headers.Authorization, `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`);
    assert.equal(options.headers['X-ECLADO-Audit-Source'], 'payment-api');
    assert.deepEqual(JSON.parse(options.body), {
      p_order_id: 'ECL-AUTH-001',
      p_payment_token: 'payment-token-test',
    });
    return new Response(JSON.stringify({
      id: 'ECL-AUTH-001',
      total: 3980,
      status: 'unpaid',
      items: [{ name: '胜肽修護精華液', qty: 1 }],
      payment_due_at: '2026-07-31T07:30:00.000Z',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const body = await server.buildAuthoritativeCreateBody({
      orderNo: 'ECL-AUTH-001',
      paymentToken: 'payment-token-test',
      amount: 1,
      payType: 'A',
    });
    assert.equal(body.Amount, 398000);
    assert.equal(body.PrdtName, '胜肽修護精華液');
    assert.equal(body.ATMParam.ExpireDate, '20260731');
    assert.equal(body.ATMParam.ExpireTime, '1530');
  } finally {
    global.fetch = originalFetch;
  }
});

test('formatSinopacDeadline: 將權威截止時間轉為台灣日期與時間', () => {
  assert.deepEqual(server.formatSinopacDeadline('2026-07-31T15:59:00.000Z'), {
    expireDate: '20260731',
    expireTime: '2359',
  });
  assert.equal(server.formatSinopacDeadline('invalid'), null);
});

test('buildAuthoritativeCreateBody: 缺少 payment token 時拒絕建單', async () => {
  await assert.rejects(
    server.buildAuthoritativeCreateBody({ orderNo: 'ECL-NO-TOKEN', amount: 100, payType: 'A' }),
    /paymentToken is required/,
  );
});

test('getSinopacPaymentError: 失敗回傳描述，成功回空字串', () => {
  assert.equal(server.getSinopacPaymentError({ Status: 'S' }), '');
  assert.match(server.getSinopacPaymentError({ Status: 'F', Description: '卡片遭拒' }), /卡片遭拒/);
});

test('付款返回網址只包含訂單與結果，不洩漏任何 token', () => {
  const url = new URL(server.buildPaymentResultUrl('ECL-RETURN-001', 'paid'));
  assert.equal(url.pathname, '/payment-result');
  assert.equal(url.searchParams.get('orderNo'), 'ECL-RETURN-001');
  assert.equal(url.searchParams.get('result'), 'paid');
  assert.equal(url.searchParams.has('payToken'), false);
  assert.equal(url.searchParams.has('paymentToken'), false);
});

test('resolvePaymentQueryState: 付款成功優先，逾期與取消不可再付款', () => {
  const futureOrder = {
    status: 'unpaid',
    payment_due_at: '2099-01-01T00:00:00.000Z',
  };
  assert.equal(server.resolvePaymentQueryState(futureOrder, {
    OrderList: [{ PayStatus: '1C400' }],
  }), 'paid');
  assert.equal(server.resolvePaymentQueryState({
    status: 'unpaid',
    payment_due_at: '2020-01-01T00:00:00.000Z',
  }, {
    OrderList: [{ PayStatus: '1C200' }],
  }), 'expired');
  assert.equal(server.resolvePaymentQueryState({
    status: 'cancelled',
    payment_due_at: '2099-01-01T00:00:00.000Z',
  }, {
    OrderList: [{ PayStatus: '1C200' }],
  }), 'cancelled');
  assert.equal(server.resolvePaymentQueryState(futureOrder, {
    OrderList: [{ PayStatus: '1C200' }],
  }), 'pending');
});

test('付款資訊持久化只選取可恢復的付款連結與付款方式', () => {
  assert.equal(server.extractServerPaymentLink({
    CardParam: { CardPayURL: 'https://bank.example/card' },
  }), 'https://bank.example/card');
  assert.equal(server.extractServerPaymentLink({
    MobileParam: { MobilePayURL: 'https://bank.example/mobile' },
  }), 'https://bank.example/mobile');
  assert.equal(server.extractServerPaymentLink({
    QRCodeURL: 'https://bank.example/QRCode-only',
  }), null);
  assert.equal(server.paymentMethodFromRequest({ payType: 'A' }), 'atm');
  assert.equal(server.paymentMethodFromRequest({ payType: 'C' }), 'card');
  assert.equal(server.paymentMethodFromRequest({ payType: 'M', choosePay: 'A' }), 'apple');
  assert.equal(server.paymentMethodFromRequest({ payType: 'M', choosePay: 'G' }), 'google');
});

test('會員付款資訊端點會驗證登入身分與訂單所有權', async () => {
  const originalFetch = global.fetch;
  const { listener, baseUrl } = await listenForTest();
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push(String(url));
    if (String(url).endsWith('/auth/v1/user')) {
      assert.equal(options.headers.Authorization, 'Bearer member-access-token');
      return new Response(JSON.stringify({ id: 'member-001' }), { status: 200 });
    }
    if (String(url).includes('/rest/v1/orders?')) {
      return new Response(JSON.stringify([{
        id: 'ECL-MEMBER-001',
        user_id: 'member-001',
        status: 'unpaid',
        total: 4100,
        subtotal: 3980,
        discount: 0,
        items: [],
        payment_due_at: '2099-01-01T00:00:00.000Z',
      }]), { status: 200 });
    }
    if (String(url).includes('/rest/v1/order_payment_instructions?')) {
      return new Response(JSON.stringify([{
        order_id: 'ECL-MEMBER-001',
        payment_method: 'atm',
        atm_bank_code: '807',
        atm_account: '8079988776655443',
        payment_due_at: '2099-01-01T00:00:00.000Z',
      }]), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = await originalFetch(`${baseUrl}/api/orders/payment-instructions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer member-access-token',
      },
      body: JSON.stringify({ orderNo: 'ECL-MEMBER-001' }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.instruction.atm_account, '8079988776655443');
    assert.equal(body.order.shipping, 120);
    assert.equal(calls.length, 3);
  } finally {
    global.fetch = originalFetch;
    await new Promise(resolve => listener.close(resolve));
  }
});

test('會員不能讀取其他會員的付款資訊', async () => {
  const originalFetch = global.fetch;
  const { listener, baseUrl } = await listenForTest();
  let instructionRead = false;
  global.fetch = async url => {
    if (String(url).endsWith('/auth/v1/user')) {
      return new Response(JSON.stringify({ id: 'member-attacker' }), { status: 200 });
    }
    if (String(url).includes('/rest/v1/orders?')) {
      return new Response(JSON.stringify([{
        id: 'ECL-OTHER-001',
        user_id: 'member-owner',
        status: 'unpaid',
        total: 100,
        subtotal: 100,
        discount: 0,
        items: [],
        payment_due_at: '2099-01-01T00:00:00.000Z',
      }]), { status: 200 });
    }
    if (String(url).includes('/rest/v1/order_payment_instructions?')) instructionRead = true;
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = await originalFetch(`${baseUrl}/api/orders/payment-instructions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer attacker-token',
      },
      body: JSON.stringify({ orderNo: 'ECL-OTHER-001' }),
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.match(body.error, /does not belong/);
    assert.equal(instructionRead, false);
  } finally {
    global.fetch = originalFetch;
    await new Promise(resolve => listener.close(resolve));
  }
});

test('訪客以短查詢碼與手機取得付款資訊，且回應不洩漏個資', async () => {
  const originalFetch = global.fetch;
  const { listener, baseUrl } = await listenForTest();
  global.fetch = async url => {
    if (String(url).includes('/rest/v1/orders?')) {
      assert.equal(new URL(String(url)).searchParams.get('public_lookup_code'), 'eq.ABCDE-12345');
      return new Response(JSON.stringify([{
        id: 'ECL-GUEST-001', user_id: null, member: '訪客', email: 'guest@example.com',
        phone: '0912-345-678', public_lookup_code: 'ABCDE-12345', status: 'unpaid',
        total: 4100, subtotal: 3980, discount: 0, items: [], payment_due_at: '2099-01-01T00:00:00.000Z',
        created_at: '2026-08-17T01:00:00.000Z', tracking: null, shipping_carrier: null, shipped_at: null,
      }]), { status: 200 });
    }
    if (String(url).includes('/rest/v1/order_payment_instructions?')) {
      return new Response(JSON.stringify([{
        order_id: 'ECL-GUEST-001', payment_method: 'atm', atm_account: '8079988776655443',
        payment_due_at: '2099-01-01T00:00:00.000Z',
      }]), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await originalFetch(`${baseUrl}/api/orders/guest-lookup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lookupCode: 'abcde12345', phone: '+886 912 345 678' }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.instruction.atm_account, '8079988776655443');
    assert.equal(body.order.email, undefined);
    assert.equal(body.order.phone, undefined);
    assert.equal(body.order.address, undefined);
    assert.equal(body.order.created_at, '2026-08-17T01:00:00.000Z');
    assert.equal(server.verifyGuestAccessToken(body.guestAccessToken, 'ECL-GUEST-001'), true);
  } finally {
    global.fetch = originalFetch;
    await new Promise(resolve => listener.close(resolve));
  }
});

test('訪客短效憑證可更新已出貨訂單，且已付款後不回傳付款入口', async () => {
  const originalFetch = global.fetch;
  const { listener, baseUrl } = await listenForTest();
  global.fetch = async url => {
    if (String(url).includes('/rest/v1/orders?')) {
      assert.equal(new URL(String(url)).searchParams.get('id'), 'eq.ECL-GUEST-SHIPPED-001');
      return new Response(JSON.stringify([{
        id: 'ECL-GUEST-SHIPPED-001', user_id: null, status: 'shipped',
        total: 4100, subtotal: 3980, discount: 0, items: [{ name: '測試商品', qty: 1 }],
        payment_due_at: '2026-08-19T00:00:00.000Z', created_at: '2026-08-17T01:00:00.000Z',
        tracking: 'SF1234567890', shipping_carrier: 'sf_express', shipped_at: '2026-08-18T03:00:00.000Z',
      }]), { status: 200 });
    }
    if (String(url).includes('/rest/v1/order_payment_instructions?')) {
      return new Response(JSON.stringify([{
        order_id: 'ECL-GUEST-SHIPPED-001', payment_method: 'atm',
        provider_transaction_no: 'PRIVATE-TSNO', atm_bank_code: '807', atm_account: '8079988776655443',
        payment_url: 'https://private-pay.example.test', payment_due_at: '2026-08-19T00:00:00.000Z',
      }]), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const token = server.createGuestAccessToken('ECL-GUEST-SHIPPED-001');
    const response = await originalFetch(`${baseUrl}/api/orders/guest-details`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderNo: 'ECL-GUEST-SHIPPED-001', guestAccessToken: token }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.order.status, 'shipped');
    assert.equal(body.order.tracking, 'SF1234567890');
    assert.equal(body.order.shipping_carrier, 'sf_express');
    assert.equal(body.paymentState, 'paid');
    assert.equal(body.instruction.payment_method, 'atm');
    assert.equal(body.instruction.atm_account, undefined);
    assert.equal(body.instruction.payment_url, undefined);
    assert.equal(body.instruction.provider_transaction_no, undefined);
  } finally {
    global.fetch = originalFetch;
    await new Promise(resolve => listener.close(resolve));
  }
});

test('訪客訂單更新端點拒絕過期或錯誤憑證', async () => {
  const originalFetch = global.fetch;
  const { listener, baseUrl } = await listenForTest();
  let dataRead = false;
  global.fetch = async () => {
    dataRead = true;
    throw new Error('should not fetch data');
  };
  try {
    const response = await originalFetch(`${baseUrl}/api/orders/guest-details`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderNo: 'ECL-GUEST-001', guestAccessToken: 'invalid-token' }),
    });
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.match(body.error, /授權已過期/);
    assert.equal(dataRead, false);
  } finally {
    global.fetch = originalFetch;
    await new Promise(resolve => listener.close(resolve));
  }
});

test('訪客手機不符時使用通用錯誤且不讀付款資訊', async () => {
  const originalFetch = global.fetch;
  const { listener, baseUrl } = await listenForTest();
  let instructionRead = false;
  global.fetch = async url => {
    if (String(url).includes('/rest/v1/orders?')) {
      return new Response(JSON.stringify([{
        id: 'ECL-GUEST-002', user_id: null, phone: '0912345678', public_lookup_code: 'FFFFF-11111',
      }]), { status: 200 });
    }
    if (String(url).includes('/rest/v1/order_payment_instructions?')) instructionRead = true;
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await originalFetch(`${baseUrl}/api/orders/guest-lookup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lookupCode: 'FFFFF-11111', phone: '0999999999' }),
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error, '查詢資料不正確，請確認查詢碼與手機號碼。');
    assert.equal(instructionRead, false);
  } finally {
    global.fetch = originalFetch;
    await new Promise(resolve => listener.close(resolve));
  }
});
