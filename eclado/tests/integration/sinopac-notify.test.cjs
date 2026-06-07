const test = require('node:test');
const assert = require('node:assert/strict');
const sinopacNotify = require('../../api/sinopac/notify.js');

const SUPABASE_URL = 'https://ilvdvlkdpntwmaijncaz.supabase.co';

test('Sinopac notify marks order paid and sends LINE payment notice', async () => {
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
  };

  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (String(url).startsWith(`${SUPABASE_URL}/rest/v1/orders?id=eq.APPLE-PAID-001&select=`)) {
      assert.equal(options.method, 'GET');
      return jsonResponse(200, [{
        id: 'APPLE-PAID-001',
        status: 'awaiting_confirm',
        total: 5,
        user_id: null,
        member: 'Apple Pay 測試',
        email: '',
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
        email: '',
      }]);
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
  assert.equal(calls.length, 2);
});

test('Sinopac notify resolves mobile payment by PayToken when OrderNo is absent', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalEnv = {
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  };

  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (String(url).startsWith(`${SUPABASE_URL}/rest/v1/orders?note=ilike.*pay_token%3APT-APPLE-001*`)) {
      assert.equal(options.method, 'GET');
      return jsonResponse(200, [{
        id: 'APPLE-TOKEN-001',
        status: 'unpaid',
        total: 5,
        user_id: null,
        member: 'Apple Pay Token 測試',
        email: '',
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
        email: '',
      }]);
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
  assert.equal(calls.length, 2);
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

function restoreEnv(originalEnv) {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
