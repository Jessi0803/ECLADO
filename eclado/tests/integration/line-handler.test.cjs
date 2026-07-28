const test = require('node:test');
const assert = require('node:assert/strict');
const lineCallback = require('../../api/line-callback.js');
const linePush = require('../../api/line-push.js');

const SUPABASE_URL = 'https://ilvdvlkdpntwmaijncaz.supabase.co';

test('LINE callback - 新使用者會建立 auth user、profiles 與 magic link', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalEnv = {
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    LINE_LOGIN_CHANNEL_SECRET: process.env.LINE_LOGIN_CHANNEL_SECRET,
  };

  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  process.env.LINE_LOGIN_CHANNEL_SECRET = 'test-login-secret';
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (url === 'https://api.line.me/oauth2/v2.1/token') {
      return jsonResponse(200, { access_token: 'line-access-token' });
    }

    if (url === 'https://api.line.me/v2/profile') {
      return jsonResponse(200, { userId: 'U1234567890', displayName: 'LINE 測試帳號' });
    }

    if (String(url).startsWith(`${SUPABASE_URL}/rest/v1/profiles?line_user_id=eq.U1234567890`)) {
      return jsonResponse(200, []);
    }

    if (url === `${SUPABASE_URL}/auth/v1/admin/users`) {
      const body = JSON.parse(options.body);
      assert.equal(body.email, 'line.U1234567890@ecladotaiwan.com');
      assert.equal(body.email_confirm, true);
      return jsonResponse(200, { id: 'user-123' });
    }

    if (url === `${SUPABASE_URL}/rest/v1/profiles`) {
      const body = JSON.parse(options.body);
      assert.equal(body.id, 'user-123');
      assert.equal(body.line_user_id, 'U1234567890');
      assert.equal(body.role, 'consumer');
      return jsonResponse(201, [{ id: 'user-123' }]);
    }

    if (url === `${SUPABASE_URL}/auth/v1/admin/generate_link`) {
      const body = JSON.parse(options.body);
      assert.equal(body.type, 'magiclink');
      assert.equal(body.email, 'line.U1234567890@ecladotaiwan.com');
      return jsonResponse(200, { action_link: 'https://ecladotaiwan.com/line-callback#access_token=magic' });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  const res = createRes();

  try {
    await lineCallback({ query: { code: 'line-code' } }, res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.redirectedTo, 'https://ecladotaiwan.com/line-callback#access_token=magic');
  assert.equal(res.statusCode, 200);
  assert.ok(calls.some(call => call.url === 'https://api.line.me/oauth2/v2.1/token'));
  assert.ok(calls.some(call => call.url === `${SUPABASE_URL}/auth/v1/admin/users`));
  assert.ok(calls.some(call => call.url === `${SUPABASE_URL}/auth/v1/admin/generate_link`));
});

test('LINE callback - 已存在會員會更新名稱並重用既有帳號', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalEnv = {
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    LINE_LOGIN_CHANNEL_SECRET: process.env.LINE_LOGIN_CHANNEL_SECRET,
  };

  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  process.env.LINE_LOGIN_CHANNEL_SECRET = 'test-login-secret';
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (url === 'https://api.line.me/oauth2/v2.1/token') {
      return jsonResponse(200, { access_token: 'line-access-token' });
    }

    if (url === 'https://api.line.me/v2/profile') {
      return jsonResponse(200, { userId: 'U9999999999', displayName: '新名稱' });
    }

    if (String(url).startsWith(`${SUPABASE_URL}/rest/v1/profiles?line_user_id=eq.U9999999999`)) {
      return jsonResponse(200, [{ id: 'user-999', email: 'old@example.com' }]);
    }

    if (String(url).startsWith(`${SUPABASE_URL}/rest/v1/profiles?id=eq.user-999`)) {
      const body = JSON.parse(options.body);
      assert.equal(body.name, '新名稱');
      return jsonResponse(200, [{ id: 'user-999' }]);
    }

    if (url === `${SUPABASE_URL}/auth/v1/admin/generate_link`) {
      return jsonResponse(200, { action_link: 'https://ecladotaiwan.com/line-callback#access_token=magic' });
    }

    if (url === `${SUPABASE_URL}/auth/v1/admin/users`) {
      throw new Error('should not create auth user for existing profile');
    }

    if (url === `${SUPABASE_URL}/rest/v1/profiles`) {
      throw new Error('should not insert profile for existing user');
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  const res = createRes();

  try {
    await lineCallback({ query: { code: 'line-code' } }, res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.redirectedTo, 'https://ecladotaiwan.com/line-callback#access_token=magic');
  assert.equal(res.statusCode, 200);
  assert.ok(calls.some(call => call.url === `${SUPABASE_URL}/rest/v1/profiles?id=eq.user-999`));
});

test('LINE callback - LINE email 與既有會員相同時會綁定同一個帳戶', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalEnv = {
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    LINE_LOGIN_CHANNEL_SECRET: process.env.LINE_LOGIN_CHANNEL_SECRET,
  };

  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  process.env.LINE_LOGIN_CHANNEL_SECRET = 'test-login-secret';
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (url === 'https://api.line.me/oauth2/v2.1/token') {
      return jsonResponse(200, { access_token: 'line-access-token', id_token: 'line-id-token' });
    }

    if (url === 'https://api.line.me/oauth2/v2.1/verify') {
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('id_token'), 'line-id-token');
      assert.equal(body.get('client_id'), '2010106039');
      return jsonResponse(200, { email: 'SameUser@Example.com' });
    }

    if (url === 'https://api.line.me/v2/profile') {
      return jsonResponse(200, { userId: 'U-email-match', displayName: 'LINE 同信箱' });
    }

    if (String(url).startsWith(`${SUPABASE_URL}/rest/v1/profiles?line_user_id=eq.U-email-match`)) {
      return jsonResponse(200, []);
    }

    if (String(url).startsWith(`${SUPABASE_URL}/rest/v1/profiles?email=eq.sameuser%40example.com`)) {
      return jsonResponse(200, [{ id: 'same-email-user', email: 'sameuser@example.com', line_user_id: null }]);
    }

    if (String(url).startsWith(`${SUPABASE_URL}/rest/v1/profiles?id=eq.same-email-user`)) {
      const body = JSON.parse(options.body);
      assert.equal(body.name, 'LINE 同信箱');
      assert.equal(body.line_user_id, 'U-email-match');
      return jsonResponse(200, [{ id: 'same-email-user' }]);
    }

    if (url === `${SUPABASE_URL}/auth/v1/admin/generate_link`) {
      const body = JSON.parse(options.body);
      assert.equal(body.email, 'sameuser@example.com');
      return jsonResponse(200, { action_link: 'https://ecladotaiwan.com/line-callback#access_token=magic' });
    }

    if (url === `${SUPABASE_URL}/auth/v1/admin/users`) {
      throw new Error('should not create auth user when email profile exists');
    }

    if (url === `${SUPABASE_URL}/rest/v1/profiles`) {
      throw new Error('should not insert profile when email profile exists');
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  const res = createRes();

  try {
    await lineCallback({ query: { code: 'line-code' } }, res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.redirectedTo, 'https://ecladotaiwan.com/line-callback#access_token=magic');
  assert.equal(res.statusCode, 200);
  assert.ok(calls.some(call => call.url === 'https://api.line.me/oauth2/v2.1/verify'));
});

test('LINE push 會送出出貨通知', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalEnv = {
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
  };

  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-line-token';
  process.env.INTERNAL_API_KEY = 'test-internal-key';
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (url === 'https://api.line.me/v2/bot/message/push') {
      const body = JSON.parse(options.body);
      assert.equal(body.to, 'U1234567890');
      assert.equal(body.messages[0].type, 'text');
      assert.match(body.messages[0].text, /訂單編號：ORDER-001/);
      assert.match(body.messages[0].text, /托運單號：SF123456789/);
      return jsonResponse(200, { ok: true });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  const res = createRes();

  try {
    await linePush({
      method: 'POST',
      headers: { 'x-internal-api-key': 'test-internal-key' },
      body: {
        lineUserId: 'U1234567890',
        orderId: 'ORDER-001',
        tracking: 'SF123456789',
        memberName: '測試會員',
      },
    }, res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.jsonBody, { status: 'sent' });
  assert.equal(calls.length, 1);
});

test('LINE push 會送出付款完成通知', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalEnv = {
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
  };

  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-line-token';
  process.env.INTERNAL_API_KEY = 'test-internal-key';
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (url === 'https://api.line.me/v2/bot/message/push') {
      const body = JSON.parse(options.body);
      assert.equal(body.to, 'U1234567890');
      assert.equal(body.messages[0].type, 'text');
      assert.match(body.messages[0].text, /訂單已付款完成/);
      assert.match(body.messages[0].text, /訂單編號：ORDER-002/);
      assert.match(body.messages[0].text, /付款金額：NT\$ 4,130/);
      return jsonResponse(200, { ok: true });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  const res = createRes();

  try {
    await linePush({
      method: 'POST',
      headers: { 'x-internal-api-key': 'test-internal-key' },
      body: {
        type: 'payment_paid',
        lineUserId: 'U1234567890',
        orderId: 'ORDER-002',
        total: 4130,
        memberName: '測試會員',
      },
    }, res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.jsonBody, { status: 'sent' });
  assert.equal(calls.length, 1);
});

test('LINE push 拒絕未驗證呼叫者', async () => {
  const originalKey = process.env.INTERNAL_API_KEY;
  delete process.env.INTERNAL_API_KEY;
  const res = createRes();

  try {
    await linePush({
      method: 'POST',
      headers: {},
      body: { lineUserId: 'U1234567890', orderId: 'ORDER-DENIED-001' },
    }, res);
  } finally {
    if (originalKey === undefined) delete process.env.INTERNAL_API_KEY;
    else process.env.INTERNAL_API_KEY = originalKey;
  }

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.jsonBody, { error: 'Unauthorized' });
});

function createRes() {
  return {
    statusCode: 200,
    redirectedTo: '',
    jsonBody: null,
    sentBody: null,
    redirect(url) {
      this.redirectedTo = url;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.jsonBody = body;
      return this;
    },
    send(body) {
      this.sentBody = body;
      return this;
    },
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function restoreEnv(values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
