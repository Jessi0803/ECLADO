const test = require('node:test');
const assert = require('node:assert/strict');
const orderEmail = require('../../api/order-email.js');

test('order email sends order placed notice through Resend', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalEnv = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    ORDER_EMAIL_FROM: process.env.ORDER_EMAIL_FROM,
  };

  process.env.RESEND_API_KEY = 'test-resend-key';
  process.env.ORDER_EMAIL_FROM = 'ECLADO Test <test@example.com>';
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
    return jsonResponse(200, { id: 'email_placed_001' });
  };

  const res = createRes();

  try {
    await orderEmail({
      method: 'POST',
      body: {
        type: 'order_placed',
        email: 'buyer@example.com',
        orderId: 'ORDER-PLACED-001',
        total: 3702,
        memberName: '登入買家',
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

test('order email sends shipment notice with tracking link', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };

  process.env.RESEND_API_KEY = 'test-resend-key';
  global.fetch = async (url, options = {}) => {
    assert.equal(String(url), 'https://api.resend.com/emails');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.to, ['buyer@example.com']);
    assert.match(body.subject, /訂單已出貨/);
    assert.match(body.text, /托運單號：SF111222333/);
    assert.match(body.text, /waybillno=SF111222333/);
    return jsonResponse(200, { id: 'email_shipped_001' });
  };

  const res = createRes();

  try {
    await orderEmail({
      method: 'POST',
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

function restoreEnv(originalEnv) {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
