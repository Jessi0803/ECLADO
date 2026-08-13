const test = require('node:test');
const assert = require('node:assert/strict');
const adminDeleteMember = require('../../api/admin-delete-member.js');

test('admin delete member writes a sanitized append-only audit record', async () => {
  const originalFetch = global.fetch;
  const originalEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const calls = [];

  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.SUPABASE_SERVICE_KEY = 'service-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  global.fetch = async (url, options = {}) => {
    const request = { url: String(url), options };
    calls.push(request);

    if (request.url.endsWith('/rest/v1/rpc/is_eclado_admin')) return jsonResponse(true);
    if (request.url.endsWith('/auth/v1/user')) return jsonResponse({ id: 'admin-001', email: 'admin@example.com' });
    if (request.url.includes('/rest/v1/profiles?')) return jsonResponse([{ id: 'member-001', name: '測試會員', role: 'professional' }]);
    if (request.url.endsWith('/auth/v1/admin/users/member-001')) return emptyResponse();
    if (request.url.endsWith('/rest/v1/audit_logs')) return emptyResponse();
    throw new Error(`Unexpected fetch: ${request.url}`);
  };

  const res = createRes();
  try {
    await adminDeleteMember({
      method: 'DELETE',
      headers: { authorization: 'Bearer admin-access-token' },
      body: { memberId: 'member-001' },
    }, res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.jsonBody, { ok: true, memberId: 'member-001', auditLogged: true });

  const auditCall = calls.find(call => call.url.endsWith('/rest/v1/audit_logs'));
  assert.ok(auditCall, 'expected an audit log request');
  assert.equal(auditCall.options.method, 'POST');
  assert.equal(auditCall.options.headers.Prefer, 'return=minimal');
  const audit = JSON.parse(auditCall.options.body);
  assert.equal(audit.actor_user_id, 'admin-001');
  assert.equal(audit.actor_email, 'admin@example.com');
  assert.equal(audit.action, 'profiles.delete');
  assert.deepEqual(audit.before_data, { id: 'member-001', name: '測試會員', role: 'professional' });
  assert.equal(audit.before_data.phone, undefined);
  assert.equal(audit.before_data.address, undefined);
});

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); },
  };
}

function emptyResponse(status = 204) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return ''; },
  };
}

function createRes() {
  return {
    statusCode: 200,
    jsonBody: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; },
  };
}

function restoreEnv(values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
