const test = require('node:test');
const assert = require('node:assert/strict');
const sinopacNotifyHandler = require('../../api/sinopac/notify.js');

const SUPABASE_URL = 'https://ilvdvlkdpntwmaijncaz.supabase.co';
const PAYMENT_NOTIFY_SECRET = 'test-payment-notify-secret';
process.env.PAYMENT_NOTIFY_SECRET = PAYMENT_NOTIFY_SECRET;

function sinopacNotify(req, res) {
  return sinopacNotifyHandler({
    ...req,
    headers: {
      ...(req.headers || {}),
      'x-eclado-payment-secret': PAYMENT_NOTIFY_SECRET,
    },
  }, res);
}

test('Sinopac notify rejects missing or incorrect payment notification secret', async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error('unauthorized request must not access downstream services');
  };

  try {
    const missingRes = createRes();
    await sinopacNotifyHandler({
      method: 'POST',
      body: { OrderNo: 'ORDER-UNAUTHORIZED-001', Status: 'S' },
    }, missingRes);
    assert.equal(missingRes.statusCode, 401);
    assert.equal(missingRes.jsonBody.error, 'Unauthorized');

    const wrongRes = createRes();
    await sinopacNotifyHandler({
      method: 'POST',
      headers: { 'x-eclado-payment-secret': `${PAYMENT_NOTIFY_SECRET}-wrong` },
      body: { OrderNo: 'ORDER-UNAUTHORIZED-002', Status: 'S' },
    }, wrongRes);
    assert.equal(wrongRes.statusCode, 401);
    assert.equal(wrongRes.jsonBody.error, 'Unauthorized');
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Sinopac notify marks order paid and sends LINE payment notice', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalEnv = {
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };

  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-line-token';

  global.fetch = async (url, options = {}) => {
    const notificationRpc = paymentNotificationRpcResponse(url, options);
    if (notificationRpc) return notificationRpc;
    calls.push({ url: String(url), options });

    if (String(url).startsWith(`${SUPABASE_URL}/rest/v1/orders?id=eq.ORDER-PAID-001&select=`)) {
      assert.equal(options.method, 'GET');
      return jsonResponse(200, [{
        id: 'ORDER-PAID-001',
        status: 'awaiting_confirm',
        total: 4130,
        user_id: 'user-001',
        member: '測試會員',
      }]);
    }

    if (String(url) === `${SUPABASE_URL}/rest/v1/orders?id=eq.ORDER-PAID-001`) {
      assert.equal(options.method, 'PATCH');
      assert.equal(options.headers['X-ECLADO-Audit-Source'], 'sinopac-notify');
      assert.equal(options.headers.Prefer, 'return=representation');
      assert.deepEqual(JSON.parse(options.body), { status: 'paid' });
      return jsonResponse(200, [{
        id: 'ORDER-PAID-001',
        status: 'paid',
        total: 4130,
        user_id: 'user-001',
        member: '測試會員',
      }]);
    }

    if (String(url).startsWith(`${SUPABASE_URL}/rest/v1/profiles?id=eq.user-001&select=line_user_id`)) {
      assert.equal(options.method, 'GET');
      return jsonResponse(200, [{ line_user_id: 'U1234567890' }]);
    }

    if (String(url) === 'https://api.line.me/v2/bot/message/push') {
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer test-line-token');
      const body = JSON.parse(options.body);
      assert.equal(body.to, 'U1234567890');
      assert.match(body.messages[0].text, /訂單已付款完成/);
      assert.match(body.messages[0].text, /訂單編號：ORDER-PAID-001/);
      assert.match(body.messages[0].text, /付款金額：NT\$ 4,130/);
      return jsonResponse(200, { ok: true });
    }

    throw new Error(`Unexpected fetch: ${options.method} ${url}`);
  };

  const res = createRes();

  try {
    await sinopacNotify({
      method: 'POST',
      body: { OrderNo: 'ORDER-PAID-001', Status: 'S', Amount: 4130 },
    }, res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.ok, true);
  assert.equal(res.jsonBody.status, 'paid');
  assert.equal(res.jsonBody.lineSent, true);
  assert.equal(calls.length, 4);
});

test('Sinopac notify does not resend LINE notice for already paid orders', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalEnv = {
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  };

  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-line-token';

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith(`${SUPABASE_URL}/rest/v1/orders?id=eq.ORDER-PAID-002&select=`)) {
      return jsonResponse(200, [{
        id: 'ORDER-PAID-002',
        status: 'paid',
        total: 100,
        user_id: 'user-002',
        payment_notification_sent_at: '2026-08-17T00:00:00.000Z',
      }]);
    }
    throw new Error(`Unexpected fetch: ${options.method} ${url}`);
  };

  const res = createRes();

  try {
    await sinopacNotify({
      method: 'POST',
      body: { orderNo: 'ORDER-PAID-002', Status: 'S', Amount: 100 },
    }, res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.alreadyPaid, true);
  assert.equal(res.jsonBody.lineSent, false);
  assert.equal(calls.length, 1);
});

test('Sinopac notify accepts cent-based amount from mobile payments', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalEnv = {
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };

  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  process.env.RESEND_API_KEY = 'test-resend-key';

  global.fetch = async (url, options = {}) => {
    const notificationRpc = paymentNotificationRpcResponse(url, options);
    if (notificationRpc) return notificationRpc;
    calls.push({ url: String(url), options });

    if (String(url).startsWith(`${SUPABASE_URL}/rest/v1/orders?id=eq.APPLE-PAID-001&select=`)) {
      assert.equal(options.method, 'GET');
      return jsonResponse(200, [{
        id: 'APPLE-PAID-001',
        status: 'awaiting_confirm',
        total: 5,
        user_id: null,
        member: 'Apple Pay 測試',
        email: 'apple@example.com',
      }]);
    }

    if (String(url) === `${SUPABASE_URL}/rest/v1/orders?id=eq.APPLE-PAID-001`) {
      assert.equal(options.method, 'PATCH');
      assert.deepEqual(JSON.parse(options.body), { status: 'paid' });
      return jsonResponse(200, [{
        id: 'APPLE-PAID-001',
        status: 'paid',
        total: 5,
        user_id: null,
        member: 'Apple Pay 測試',
        email: 'apple@example.com',
      }]);
    }

    if (String(url) === 'https://api.resend.com/emails') {
      return jsonResponse(200, { id: 'email-apple-001' });
    }

    throw new Error(`Unexpected fetch: ${options.method} ${url}`);
  };

  const res = createRes();

  try {
    await sinopacNotify({
      method: 'POST',
      body: { OrderNo: 'APPLE-PAID-001', Status: 'S', PayType: 'M', Amount: 500 },
    }, res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.ok, true);
  assert.equal(res.jsonBody.status, 'paid');
  assert.equal(calls.length, 3);
});

test('Sinopac notify resolves mobile payment by PayToken when OrderNo is absent', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalEnv = {
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };

  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  process.env.RESEND_API_KEY = 'test-resend-key';

  global.fetch = async (url, options = {}) => {
    const notificationRpc = paymentNotificationRpcResponse(url, options);
    if (notificationRpc) return notificationRpc;
    calls.push({ url: String(url), options });

    if (String(url).startsWith(`${SUPABASE_URL}/rest/v1/orders?note=ilike.*pay_token%3APT-APPLE-001*`)) {
      assert.equal(options.method, 'GET');
      return jsonResponse(200, [{
        id: 'APPLE-TOKEN-001',
        status: 'unpaid',
        total: 5,
        user_id: null,
        member: 'Apple Pay Token 測試',
        email: 'apple-token@example.com',
      }]);
    }

    if (String(url) === `${SUPABASE_URL}/rest/v1/orders?id=eq.APPLE-TOKEN-001`) {
      assert.equal(options.method, 'PATCH');
      assert.deepEqual(JSON.parse(options.body), { status: 'paid' });
      return jsonResponse(200, [{
        id: 'APPLE-TOKEN-001',
        status: 'paid',
        total: 5,
        user_id: null,
        member: 'Apple Pay Token 測試',
        email: 'apple-token@example.com',
      }]);
    }

    if (String(url) === 'https://api.resend.com/emails') {
      return jsonResponse(200, { id: 'email-apple-token-001' });
    }

    throw new Error(`Unexpected fetch: ${options.method} ${url}`);
  };

  const res = createRes();

  try {
    await sinopacNotify({
      method: 'POST',
      body: { ShopNo: 'TESTSHOP', PayToken: 'PT-APPLE-001' },
    }, res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.ok, true);
  assert.equal(res.jsonBody.orderId, 'APPLE-TOKEN-001');
  assert.equal(res.jsonBody.status, 'paid');
  assert.equal(calls.length, 3);
});

test('Sinopac notify accepts OrderNo from backendUrl query for PayToken-only mobile notices', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalEnv = {
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };

  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  process.env.RESEND_API_KEY = 'test-resend-key';

  global.fetch = async (url, options = {}) => {
    const notificationRpc = paymentNotificationRpcResponse(url, options);
    if (notificationRpc) return notificationRpc;
    calls.push({ url: String(url), options });

    if (String(url).startsWith(`${SUPABASE_URL}/rest/v1/orders?id=eq.APPLE-QUERY-001&select=`)) {
      assert.equal(options.method, 'GET');
      return jsonResponse(200, [{
        id: 'APPLE-QUERY-001',
        status: 'unpaid',
        total: 5,
        user_id: null,
        member: 'Apple Pay Query 測試',
        email: 'apple-query@example.com',
      }]);
    }

    if (String(url) === `${SUPABASE_URL}/rest/v1/orders?id=eq.APPLE-QUERY-001`) {
      assert.equal(options.method, 'PATCH');
      assert.deepEqual(JSON.parse(options.body), { status: 'paid' });
      return jsonResponse(200, [{
        id: 'APPLE-QUERY-001',
        status: 'paid',
        total: 5,
        user_id: null,
        member: 'Apple Pay Query 測試',
        email: 'apple-query@example.com',
      }]);
    }

    if (String(url) === 'https://api.resend.com/emails') {
      return jsonResponse(200, { id: 'email-apple-query-001' });
    }

    throw new Error(`Unexpected fetch: ${options.method} ${url}`);
  };

  const res = createRes();

  try {
    await sinopacNotify({
      method: 'POST',
      query: { orderNo: 'APPLE-QUERY-001' },
      body: { ShopNo: 'TESTSHOP', PayToken: 'PT-APPLE-QUERY-001' },
    }, res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.ok, true);
  assert.equal(res.jsonBody.orderId, 'APPLE-QUERY-001');
  assert.equal(res.jsonBody.status, 'paid');
  assert.equal(calls.length, 3);
});

test('Sinopac notify queries OrderPayQuery for credit card PayToken-only notices', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalEnv = {
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    SINOPAC_PAYMENT_QUERY_URL: process.env.SINOPAC_PAYMENT_QUERY_URL,
  };

  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  process.env.RESEND_API_KEY = 'test-resend-key';
  process.env.SINOPAC_PAYMENT_QUERY_URL = 'https://pay.example.test/api/sinopac/order-pay-query';

  global.fetch = async (url, options = {}) => {
    const notificationRpc = paymentNotificationRpcResponse(url, options);
    if (notificationRpc) return notificationRpc;
    calls.push({ url: String(url), options });

    if (String(url) === 'https://pay.example.test/api/sinopac/order-pay-query') {
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), {
        ShopNo: 'TESTSHOP',
        PayToken: 'PT-CARD-001',
      });
      return jsonResponse(200, {
        ok: true,
        response: {
          ShopNo: 'TESTSHOP',
          PayToken: 'PT-CARD-001',
          Status: 'S',
          TSResultContent: {
            APType: 'PayOut',
            OrderNo: 'CARD-TOKEN-001',
            PayType: 'C',
            Amount: '500',
            Status: 'S',
            Description: '',
            Param1: 'CARD-TOKEN-001',
          },
        },
      });
    }

    if (String(url).startsWith(`${SUPABASE_URL}/rest/v1/orders?id=eq.CARD-TOKEN-001&select=`)) {
      assert.equal(options.method, 'GET');
      return jsonResponse(200, [{
        id: 'CARD-TOKEN-001',
        status: 'unpaid',
        total: 5,
        user_id: null,
        member: '信用卡 Token 測試',
        email: 'card-token@example.com',
      }]);
    }

    if (String(url) === `${SUPABASE_URL}/rest/v1/orders?id=eq.CARD-TOKEN-001`) {
      assert.equal(options.method, 'PATCH');
      assert.deepEqual(JSON.parse(options.body), { status: 'paid' });
      return jsonResponse(200, [{
        id: 'CARD-TOKEN-001',
        status: 'paid',
        total: 5,
        user_id: null,
        member: '信用卡 Token 測試',
        email: 'card-token@example.com',
      }]);
    }

    if (String(url) === 'https://api.resend.com/emails') {
      return jsonResponse(200, { id: 'email-card-token-001' });
    }

    throw new Error(`Unexpected fetch: ${options.method} ${url}`);
  };

  const res = createRes();

  try {
    await sinopacNotify({
      method: 'POST',
      body: { ShopNo: 'TESTSHOP', PayToken: 'PT-CARD-001' },
    }, res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.ok, true);
  assert.equal(res.jsonBody.orderId, 'CARD-TOKEN-001');
  assert.equal(res.jsonBody.status, 'paid');
  assert.equal(calls.length, 4);
});

test('Sinopac notify sends payment email when member has no LINE binding', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalEnv = {
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };

  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-line-token';
  process.env.RESEND_API_KEY = 'test-resend-key';

  global.fetch = async (url, options = {}) => {
    const notificationRpc = paymentNotificationRpcResponse(url, options);
    if (notificationRpc) return notificationRpc;
    calls.push({ url: String(url), options });

    if (String(url).startsWith(`${SUPABASE_URL}/rest/v1/orders?id=eq.ORDER-EMAIL-001&select=`)) {
      return jsonResponse(200, [{
        id: 'ORDER-EMAIL-001',
        status: 'awaiting_confirm',
        total: 1280,
        user_id: 'user-email-001',
        member: 'Email 會員',
        email: 'buyer@example.com',
      }]);
    }

    if (String(url) === `${SUPABASE_URL}/rest/v1/orders?id=eq.ORDER-EMAIL-001`) {
      return jsonResponse(200, [{
        id: 'ORDER-EMAIL-001',
        status: 'paid',
        total: 1280,
        user_id: 'user-email-001',
        member: 'Email 會員',
        email: 'buyer@example.com',
      }]);
    }

    if (String(url).startsWith(`${SUPABASE_URL}/rest/v1/profiles?id=eq.user-email-001&select=line_user_id,email`)) {
      return jsonResponse(200, [{ email: 'buyer@example.com', line_user_id: null }]);
    }

    if (String(url) === 'https://api.resend.com/emails') {
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer test-resend-key');
      const body = JSON.parse(options.body);
      assert.deepEqual(body.to, ['buyer@example.com']);
      assert.match(body.subject, /訂單已付款完成/);
      assert.match(body.text, /訂單編號：ORDER-EMAIL-001/);
      return jsonResponse(200, { id: 'email_001' });
    }

    throw new Error(`Unexpected fetch: ${options.method} ${url}`);
  };

  const res = createRes();

  try {
    await sinopacNotify({
      method: 'POST',
      body: { OrderNo: 'ORDER-EMAIL-001', Status: 'S', Amount: 1280 },
    }, res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.lineSent, false);
  assert.equal(res.jsonBody.emailSent, true);
  assert.equal(calls.length, 4);
});

test('Sinopac notify retries customer notice for an already-paid order that has no delivery receipt', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalEnv = {
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  process.env.RESEND_API_KEY = 'test-resend-key';

  global.fetch = async (url, options = {}) => {
    const notificationRpc = paymentNotificationRpcResponse(url, options);
    if (notificationRpc) return notificationRpc;
    calls.push({ url: String(url), options });
    if (String(url).startsWith(`${SUPABASE_URL}/rest/v1/orders?id=eq.ORDER-RETRY-NOTICE&select=`)) {
      return jsonResponse(200, [{
        id: 'ORDER-RETRY-NOTICE', status: 'paid', total: 1280, user_id: null,
        member: '補送測試', email: 'retry@example.com', payment_notification_sent_at: null,
      }]);
    }
    if (String(url) === 'https://api.resend.com/emails') {
      return jsonResponse(200, { id: 'email-retry-001' });
    }
    throw new Error(`Unexpected fetch: ${options.method} ${url}`);
  };

  const res = createRes();
  try {
    await sinopacNotify({
      method: 'POST',
      body: { OrderNo: 'ORDER-RETRY-NOTICE', Status: 'S', Amount: 1280 },
    }, res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.emailSent, true);
  assert.equal(calls.some(call => call.options.method === 'PATCH'), false, '已付款訂單不應再次變更付款／庫存狀態');
});

test('Sinopac notify records delivery failure and asks caller to retry', async () => {
  const originalFetch = global.fetch;
  const originalError = console.error;
  const originalEnv = {
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  delete process.env.RESEND_API_KEY;
  console.error = () => {};
  let failureRecorded = false;

  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.startsWith(`${SUPABASE_URL}/rest/v1/orders?id=eq.ORDER-NOTICE-FAIL&select=`)) {
      return jsonResponse(200, [{
        id: 'ORDER-NOTICE-FAIL', status: 'unpaid', total: 500,
        user_id: null, member: '通知失敗測試', email: '',
      }]);
    }
    if (target === `${SUPABASE_URL}/rest/v1/orders?id=eq.ORDER-NOTICE-FAIL`) {
      return jsonResponse(200, [{
        id: 'ORDER-NOTICE-FAIL', status: 'paid', total: 500,
        user_id: null, member: '通知失敗測試', email: '',
      }]);
    }
    if (target.endsWith('/rest/v1/rpc/claim_order_payment_notification')) {
      return jsonResponse(200, { claimed: true, attempts: 1 });
    }
    if (target.endsWith('/rest/v1/rpc/complete_order_payment_notification')) {
      const body = JSON.parse(options.body);
      assert.equal(body.p_sent, false);
      assert.match(body.p_error, /email|user_id/i);
      failureRecorded = true;
      return jsonResponse(200, true);
    }
    throw new Error(`Unexpected fetch: ${options.method} ${url}`);
  };

  const res = createRes();
  try {
    await sinopacNotify({
      method: 'POST',
      body: { OrderNo: 'ORDER-NOTICE-FAIL', Status: 'S', Amount: 500 },
    }, res);
  } finally {
    global.fetch = originalFetch;
    console.error = originalError;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 503);
  assert.equal(failureRecorded, true);
  assert.match(res.jsonBody.error, /notification failed/);
});

test('Sinopac notify ignores explicit failed payment notices', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('should not call Supabase for failed payment notices');
  };

  const res = createRes();

  try {
    await sinopacNotify({
      method: 'POST',
      body: { OrderNo: 'ORDER-FAILED-001', Status: 'F' },
    }, res);
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.ignored, true);
});

test('Sinopac notify rejects amount mismatch without changing order or sending notices', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalEnv = {
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };

  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-line-token';
  process.env.RESEND_API_KEY = 'test-resend-key';

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith(`${SUPABASE_URL}/rest/v1/orders?id=eq.ORDER-AMOUNT-MISMATCH&select=`)) {
      assert.equal(options.method, 'GET');
      return jsonResponse(200, [{
        id: 'ORDER-AMOUNT-MISMATCH',
        status: 'unpaid',
        total: 3980,
        user_id: 'user-amount-mismatch',
        email: 'buyer@example.com',
      }]);
    }
    throw new Error(`amount mismatch must not make another request: ${options.method} ${url}`);
  };

  const res = createRes();
  try {
    await sinopacNotify({
      method: 'POST',
      body: { OrderNo: 'ORDER-AMOUNT-MISMATCH', Status: 'S', Amount: 100 },
    }, res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.jsonBody, {
    ok: false,
    error: 'amount mismatch',
    orderId: 'ORDER-AMOUNT-MISMATCH',
  });
  assert.equal(calls.length, 1, '金額不符只能讀取訂單，不能改狀態或發通知');
});

test('Sinopac notify returns 404 for an unknown order without creating one', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalEnv = {
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    assert.match(String(url), /orders\?id=eq\.ORDER-UNKNOWN&select=/);
    assert.equal(options.method, 'GET');
    return jsonResponse(200, []);
  };

  const res = createRes();
  try {
    await sinopacNotify({
      method: 'POST',
      body: { OrderNo: 'ORDER-UNKNOWN', Status: 'S', Amount: 500 },
    }, res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.jsonBody, { ok: false, error: 'order not found', orderId: 'ORDER-UNKNOWN' });
  assert.equal(calls.length, 1);
});

test('Sinopac notify returns 500 and sends no notice when paid status update fails', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalError = console.error;
  const originalEnv = {
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };

  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-line-token';
  process.env.RESEND_API_KEY = 'test-resend-key';
  console.error = () => {};

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith(`${SUPABASE_URL}/rest/v1/orders?id=eq.ORDER-PATCH-FAILED&select=`)) {
      return jsonResponse(200, [{
        id: 'ORDER-PATCH-FAILED',
        status: 'unpaid',
        total: 1280,
        user_id: 'user-patch-failed',
        email: 'buyer@example.com',
      }]);
    }
    if (String(url) === `${SUPABASE_URL}/rest/v1/orders?id=eq.ORDER-PATCH-FAILED`) {
      assert.equal(options.method, 'PATCH');
      return jsonResponse(500, { message: 'database temporarily unavailable' });
    }
    throw new Error(`status update failure must not send a notice: ${options.method} ${url}`);
  };

  const res = createRes();
  try {
    await sinopacNotify({
      method: 'POST',
      body: { OrderNo: 'ORDER-PATCH-FAILED', Status: 'S', Amount: 1280 },
    }, res);
  } finally {
    global.fetch = originalFetch;
    console.error = originalError;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 500);
  assert.equal(res.jsonBody.ok, false);
  assert.match(res.jsonBody.error, /database temporarily unavailable/);
  assert.equal(calls.length, 2, '狀態寫入失敗後不可發送付款成功通知');
});

function createRes() {
  return {
    statusCode: 200,
    jsonBody: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.jsonBody = body;
      return this;
    },
    end() {
      return this;
    },
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
  };
}

function paymentNotificationRpcResponse(url, options = {}) {
  const target = String(url);
  if (target.endsWith('/rest/v1/rpc/claim_order_payment_notification')) {
    assert.equal(options.method, 'POST');
    assert.ok(JSON.parse(options.body).p_order_id);
    return jsonResponse(200, { claimed: true, attempts: 1 });
  }
  if (target.endsWith('/rest/v1/rpc/complete_order_payment_notification')) {
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    assert.ok(body.p_order_id);
    assert.equal(body.p_sent, true);
    assert.ok(['line', 'email'].includes(body.p_channel));
    return jsonResponse(200, true);
  }
  return null;
}

function restoreEnv(originalEnv) {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
