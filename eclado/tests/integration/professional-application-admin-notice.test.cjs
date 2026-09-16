const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../../api/professional-application-admin-notice.js');

test('new professional application sends one minimal branded admin email', async () => {
  const originalFetch = global.fetch;
  const originalEnv = snapshotEnv();
  setTestEnv();
  const calls = [];

  global.fetch = async (url, options = {}) => {
    const value = String(url);
    calls.push({ url:value, options });
    if (value.endsWith('/auth/v1/user')) return jsonResponse(200, { id:'member-1' });
    if (value.endsWith('/rpc/claim_professional_application_admin_notification')) {
      assert.deepEqual(JSON.parse(options.body), {
        p_application_id:'application-1', p_user_id:'member-1',
      });
      return jsonResponse(200, {
        id:'application-1', created_at:'2026-09-16T01:00:00.000Z', attempts:1,
      });
    }
    if (value === 'https://api.resend.com/emails') {
      const body = JSON.parse(options.body);
      assert.deepEqual(body.to, ['ecladotaiwan@gmail.com']);
      assert.match(body.subject, /新的美容師申請待審核/);
      assert.match(body.text, /管理後台：https:\/\/ecladotaiwan\.com\/admin/);
      assert.match(body.html, /前往管理後台/);
      assert.match(body.html, /ECLADO/);
      assert.doesNotMatch(body.text, /地址|電話|證書/);
      assert.equal(options.headers['Idempotency-Key'], 'professional-application-admin-application-1');
      return jsonResponse(200, { id:'email-1' });
    }
    if (value.endsWith('/rpc/complete_professional_application_admin_notification')) {
      assert.deepEqual(JSON.parse(options.body), {
        p_application_id:'application-1', p_sent:true, p_error:null,
      });
      return jsonResponse(200, true);
    }
    throw new Error(`Unexpected fetch: ${value}`);
  };

  const res = createRes();
  try {
    await handler(request('application-1'), res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.jsonBody, { ok:true, sent:true });
  assert.equal(calls.filter(call => call.url === 'https://api.resend.com/emails').length, 1);
});

test('already claimed or delivered application does not send a duplicate email', async () => {
  const originalFetch = global.fetch;
  const originalEnv = snapshotEnv();
  setTestEnv();

  global.fetch = async (url) => {
    const value = String(url);
    if (value.endsWith('/auth/v1/user')) return jsonResponse(200, { id:'member-1' });
    if (value.endsWith('/rpc/claim_professional_application_admin_notification')) {
      return jsonResponse(200, null);
    }
    if (value === 'https://api.resend.com/emails') throw new Error('Duplicate email must not be sent');
    throw new Error(`Unexpected fetch: ${value}`);
  };

  const res = createRes();
  try {
    await handler(request('application-1'), res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.jsonBody, { ok:true, sent:false, alreadyHandled:true });
});

test('admin notice endpoint rejects requests without member authentication', async () => {
  const res = createRes();
  await handler({ method:'POST', headers:{}, body:{ applicationId:'application-1' } }, res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.jsonBody, { error:'Unauthorized' });
});

function request(applicationId) {
  return {
    method:'POST',
    headers:{ authorization:'Bearer member-access-token' },
    body:{ applicationId },
  };
}

function createRes() {
  return {
    statusCode:200,
    jsonBody:undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; },
  };
}

function jsonResponse(status, body) {
  return {
    ok:status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); },
    async json() { return body; },
  };
}

function snapshotEnv() {
  return {
    SUPABASE_URL:process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY:process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_SERVICE_KEY:process.env.SUPABASE_SERVICE_KEY,
    RESEND_API_KEY:process.env.RESEND_API_KEY,
    ORDER_EMAIL_FROM:process.env.ORDER_EMAIL_FROM,
    PROFESSIONAL_APPLICATION_ADMIN_EMAIL:process.env.PROFESSIONAL_APPLICATION_ADMIN_EMAIL,
  };
}

function setTestEnv() {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.RESEND_API_KEY = 'test-resend-key';
  process.env.ORDER_EMAIL_FROM = 'ECLADO Test <service@example.com>';
  process.env.PROFESSIONAL_APPLICATION_ADMIN_EMAIL = 'ecladotaiwan@gmail.com';
}

function restoreEnv(values) {
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
}
