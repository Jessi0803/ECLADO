const test = require('node:test');
const assert = require('node:assert/strict');
const professionalApplicationNotice = require('../../api/professional-application-notice.js');

test('professional application approval sends LINE first', async () => {
  const originalFetch = global.fetch;
  const originalEnv = snapshotEnv();
  const calls = [];
  setTestEnv();

  global.fetch = async (url, options = {}) => {
    const value = String(url);
    calls.push({ url: value, options });
    if (value.endsWith('/auth/v1/user')) return jsonResponse(200, { id: 'admin-1' });
    if (value.endsWith('/rest/v1/rpc/is_eclado_admin')) return jsonResponse(200, true);
    if (value.includes('/professional_applications?')) {
      return jsonResponse(200, [{
        id: 'app-1', user_id: 'user-1', user_email: 'beautician@example.com',
        contact_name: '王美容師', status: 'approved',
      }]);
    }
    if (value.includes('/profiles?')) {
      return jsonResponse(200, [{ email: 'profile@example.com', name: '王小姐', line_user_id: 'U-LINE-1' }]);
    }
    if (value === 'https://api.line.me/v2/bot/message/push') {
      const body = JSON.parse(options.body);
      assert.equal(body.to, 'U-LINE-1');
      assert.match(body.messages[0].text, /申請已核准/);
      assert.match(body.messages[0].text, /專業價已開通/);
      return jsonResponse(200, {});
    }
    if (value === 'https://api.resend.com/emails') throw new Error('Email must not be sent after LINE succeeds');
    throw new Error(`Unexpected fetch: ${value}`);
  };

  const res = createRes();
  try {
    await professionalApplicationNotice(request('app-1'), res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.jsonBody, { ok: true, channel: 'line', status: 'approved' });
  assert.equal(calls.filter(call => call.url === 'https://api.line.me/v2/bot/message/push').length, 1);
});

test('professional application rejection falls back to Email when LINE is unavailable', async () => {
  const originalFetch = global.fetch;
  const originalEnv = snapshotEnv();
  setTestEnv();

  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value.endsWith('/auth/v1/user')) return jsonResponse(200, { id: 'admin-1' });
    if (value.endsWith('/rest/v1/rpc/is_eclado_admin')) return jsonResponse(200, true);
    if (value.includes('/professional_applications?')) {
      return jsonResponse(200, [{
        id: 'app-2', user_id: 'user-2', user_email: 'fallback@example.com',
        contact_name: '陳美容師', status: 'rejected',
      }]);
    }
    if (value.includes('/profiles?')) {
      return jsonResponse(200, [{ email: 'profile@example.com', name: '陳小姐', line_user_id: null }]);
    }
    if (value === 'https://api.resend.com/emails') {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.to, ['fallback@example.com']);
      assert.match(body.subject, /申請結果通知/);
      assert.match(body.text, /目前未通過審核/);
      assert.match(body.html, /ECLADO/);
      return jsonResponse(200, { id: 'email-review-2' });
    }
    throw new Error(`Unexpected fetch: ${value}`);
  };

  const res = createRes();
  try {
    await professionalApplicationNotice(request('app-2'), res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.ok, true);
  assert.equal(res.jsonBody.channel, 'email');
  assert.equal(res.jsonBody.status, 'rejected');
});

test('professional application notice rejects unreviewed applications', async () => {
  const originalFetch = global.fetch;
  const originalEnv = snapshotEnv();
  setTestEnv();

  global.fetch = async url => {
    const value = String(url);
    if (value.endsWith('/auth/v1/user')) return jsonResponse(200, { id: 'admin-1' });
    if (value.endsWith('/rest/v1/rpc/is_eclado_admin')) return jsonResponse(200, true);
    if (value.includes('/professional_applications?')) {
      return jsonResponse(200, [{ id: 'app-3', status: 'pending' }]);
    }
    throw new Error(`Unexpected fetch: ${value}`);
  };

  const res = createRes();
  try {
    await professionalApplicationNotice(request('app-3'), res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.jsonBody, { error: 'Application has not been reviewed' });
});

function request(applicationId) {
  return {
    method: 'POST',
    headers: { authorization: 'Bearer admin-access-token' },
    body: { applicationId },
  };
}

function createRes() {
  return {
    statusCode: 200,
    jsonBody: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; },
    end() { return this; },
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); },
    async json() { return body; },
  };
}

function snapshotEnv() {
  return {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    ORDER_EMAIL_FROM: process.env.ORDER_EMAIL_FROM,
    INTERNAL_API_KEY: process.env.INTERNAL_API_KEY,
  };
}

function setTestEnv() {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-line-token';
  process.env.RESEND_API_KEY = 'test-resend-key';
  process.env.ORDER_EMAIL_FROM = 'ECLADO Test <test@example.com>';
  delete process.env.INTERNAL_API_KEY;
}

function restoreEnv(values) {
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
}
