const test = require('node:test');
const assert = require('node:assert/strict');
const orderEmail = require('../../api/order-email.js');

test('order email sends order placed notice through Resend', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalEnv = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    ORDER_EMAIL_FROM: process.env.ORDER_EMAIL_FROM,
    INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
  };

  process.env.RESEND_API_KEY = 'test-resend-key';
  process.env.ORDER_EMAIL_FROM = 'ECLADO Test <test@example.com>';
  process.env.INTERNAL_API_KEY = 'test-internal-key';
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    assert.equal(String(url), 'https://api.resend.com/emails');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer test-resend-key');
    const body = JSON.parse(options.body);
    assert.equal(body.from, 'ECLADO Test <test@example.com>');
    assert.deepEqual(body.to, ['buyer@example.com']);
    assert.match(body.subject, /訂單已建立/);
    assert.match(body.text, /訂單編號：ORDER-PLACED-001/);
    assert.match(body.text, /訂單金額：NT\$ 3,702/);
    assert.match(body.text, /訪客查詢碼：ABCDE-12345/);
    assert.match(body.text, /https:\/\/ecladotaiwan\.com\/order-lookup\?lookup=ABCDE-12345/);
    return jsonResponse(200, { id: 'email_placed_001' });
  };

  const res = createRes();

  try {
    await orderEmail({
      method: 'POST',
      headers: { 'x-internal-api-key': 'test-internal-key' },
      body: {
        type: 'order_placed',
        email: 'buyer@example.com',
        orderId: 'ORDER-PLACED-001',
        total: 3702,
        memberName: '登入買家',
        lookupCode: 'ABCDE-12345',
        lookupUrl: 'https://ecladotaiwan.com/order-lookup?lookup=ABCDE-12345',
        paymentDueAt: '2026-08-19T15:59:00.000Z',
      },
    }, res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.jsonBody, { status: 'sent', id: 'email_placed_001' });
  assert.equal(calls.length, 1);
});

test('order email accepts Payment API secret only for the opted-in email endpoint', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
    PAYMENT_NOTIFY_SECRET: process.env.PAYMENT_NOTIFY_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };
  delete process.env.INTERNAL_API_KEY;
  process.env.PAYMENT_NOTIFY_SECRET = 'payment-api-email-secret';
  process.env.RESEND_API_KEY = 'test-resend-key';
  global.fetch = async url => {
    assert.equal(String(url), 'https://api.resend.com/emails');
    return textJsonResponse(200, { id: 'email_payment_api_001' });
  };
  const res = createRes();
  try {
    await orderEmail({
      method: 'POST',
      headers: { 'x-eclado-payment-secret': 'payment-api-email-secret' },
      body: { email: 'guest@example.com', orderId: 'ORDER-GUEST-001' },
    }, res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }
  assert.equal(res.statusCode, 200);
});

test('order email sends shipment notice with tracking link', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
  };

  process.env.RESEND_API_KEY = 'test-resend-key';
  process.env.INTERNAL_API_KEY = 'test-internal-key';
  global.fetch = async (url, options = {}) => {
    assert.equal(String(url), 'https://api.resend.com/emails');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.to, ['buyer@example.com']);
    assert.match(body.subject, /訂單已出貨/);
    assert.match(body.text, /托運單號：SF111222333/);
    assert.match(body.text, /https:\/\/htm\.sf-express\.com\/tw\/tc\//);
    return jsonResponse(200, { id: 'email_shipped_001' });
  };

  const res = createRes();

  try {
    await orderEmail({
      method: 'POST',
      headers: { 'x-internal-api-key': 'test-internal-key' },
      body: {
        type: 'shipment',
        email: 'buyer@example.com',
        orderId: 'ORDER-SHIP-001',
        tracking: 'SF111222333',
      },
    }, res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.status, 'sent');
});

test('order email rejects unauthenticated callers', async () => {
  const originalKey = process.env.INTERNAL_API_KEY;
  delete process.env.INTERNAL_API_KEY;
  const res = createRes();

  try {
    await orderEmail({
      method: 'POST',
      headers: {},
      body: { email: 'buyer@example.com', orderId: 'ORDER-DENIED-001' },
    }, res);
  } finally {
    if (originalKey === undefined) delete process.env.INTERNAL_API_KEY;
    else process.env.INTERNAL_API_KEY = originalKey;
  }

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.jsonBody, { error: 'Unauthorized' });
});

test('order email accepts a verified administrator access token', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };
  delete process.env.INTERNAL_API_KEY;
  process.env.RESEND_API_KEY = 'test-resend-key';

  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/auth/v1/user')) {
      assert.equal(options.headers.Authorization, 'Bearer admin-access-token');
      return textJsonResponse(200, { email: 'ecladotaiwan@gmail.com' });
    }
    if (String(url).endsWith('/rest/v1/rpc/is_eclado_admin')) {
      assert.equal(options.headers.Authorization, 'Bearer admin-access-token');
      return textJsonResponse(200, true);
    }
    if (String(url) === 'https://api.resend.com/emails') {
      return textJsonResponse(200, { id: 'email_admin_001' });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const res = createRes();
  try {
    await orderEmail({
      method: 'POST',
      headers: { authorization: 'Bearer admin-access-token' },
      body: { email: 'buyer@example.com', orderId: 'ORDER-ADMIN-001' },
    }, res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.id, 'email_admin_001');
});

test('order email rejects a signed-in non-administrator', async () => {
  const originalFetch = global.fetch;
  const originalKey = process.env.INTERNAL_API_KEY;
  delete process.env.INTERNAL_API_KEY;
  global.fetch = async url => {
    if (String(url).endsWith('/auth/v1/user')) {
      return textJsonResponse(200, { email: 'member@example.com' });
    }
    if (String(url).endsWith('/rest/v1/rpc/is_eclado_admin')) {
      return textJsonResponse(200, false);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  const res = createRes();
  try {
    await orderEmail({
      method: 'POST',
      headers: { authorization: 'Bearer member-access-token' },
      body: { email: 'buyer@example.com', orderId: 'ORDER-FORBIDDEN-001' },
    }, res);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.INTERNAL_API_KEY;
    else process.env.INTERNAL_API_KEY = originalKey;
  }

  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.jsonBody, { error: 'Forbidden' });
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
    async json() {
      return body;
    },
  };
}

function textJsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    },
  };
}

function restoreEnv(originalEnv) {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
