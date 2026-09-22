const test = require('node:test');
const assert = require('node:assert/strict');
const adminDeleteMember = require('../../api/admin-delete-member.js');

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const SUPER_ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const TARGET_ADMIN_ID = '44444444-4444-4444-8444-444444444444';
const TARGET_SUPER_ID = '55555555-5555-4555-8555-555555555555';

test('admin delete member writes a sanitized audit record with the real actor role', async () => {
  const scenario = await runScenario();

  assert.equal(scenario.res.statusCode, 200);
  assert.deepEqual(scenario.res.jsonBody, { ok: true, memberId: MEMBER_ID, auditLogged: true });
  assert.equal(scenario.deleteCalls.length, 1);

  const auditCall = scenario.calls.find(call => call.url.endsWith('/rest/v1/audit_logs'));
  assert.ok(auditCall, 'expected an audit log request');
  assert.equal(auditCall.options.method, 'POST');
  assert.equal(auditCall.options.headers.Prefer, 'return=minimal');
  const audit = JSON.parse(auditCall.options.body);
  assert.equal(audit.actor_user_id, ADMIN_ID);
  assert.equal(audit.actor_email, 'admin@example.com');
  assert.equal(audit.actor_role, 'admin');
  assert.equal(audit.action, 'profiles.delete');
  assert.deepEqual(audit.before_data, { id: MEMBER_ID, name: '測試會員', role: 'professional' });
  assert.equal(audit.before_data.phone, undefined);
  assert.equal(audit.before_data.address, undefined);
});

test('self deletion is rejected before any service-role lookup or Auth deletion', async () => {
  const scenario = await runScenario({ actorId: ADMIN_ID, memberId: ADMIN_ID });

  assert.equal(scenario.res.statusCode, 403);
  assert.match(scenario.res.jsonBody.error, /目前登入/);
  assert.equal(scenario.deleteCalls.length, 0);
  assert.equal(scenario.calls.some(call => call.url.includes('/rest/v1/admin_users?')), false);
});

test('ordinary admin cannot delete another backoffice identity', async () => {
  const scenario = await runScenario({
    memberId: TARGET_ADMIN_ID,
    targetAdmin: { user_id: TARGET_ADMIN_ID, role: 'admin', active: true },
  });

  assert.equal(scenario.res.statusCode, 403);
  assert.match(scenario.res.jsonBody.error, /後台人員帳號/);
  assert.equal(scenario.deleteCalls.length, 0);
});

test('super admin also cannot use the member flow to delete another admin or super admin', async () => {
  for (const targetAdmin of [
    { user_id: TARGET_ADMIN_ID, role: 'admin', active: true },
    { user_id: TARGET_SUPER_ID, role: 'super_admin', active: true },
  ]) {
    const scenario = await runScenario({
      actorId: SUPER_ADMIN_ID,
      actorRole: 'super_admin',
      memberId: targetAdmin.user_id,
      targetAdmin,
    });
    assert.equal(scenario.res.statusCode, 403);
    assert.match(scenario.res.jsonBody.error, /後台人員帳號/);
    assert.equal(scenario.deleteCalls.length, 0);
  }
});

test('inactive backoffice identities fail closed and cannot be deleted as ordinary members', async () => {
  const scenario = await runScenario({
    memberId: TARGET_ADMIN_ID,
    targetAdmin: { user_id: TARGET_ADMIN_ID, role: 'admin', active: false },
  });

  assert.equal(scenario.res.statusCode, 403);
  assert.equal(scenario.deleteCalls.length, 0);
});

test('missing members.write permission and inactive actors cannot delete members', async () => {
  const withoutPermission = await runScenario({ permissionAllowed: false });
  assert.equal(withoutPermission.res.statusCode, 403);
  assert.equal(withoutPermission.deleteCalls.length, 0);

  const inactiveActor = await runScenario({ actorActive: false });
  assert.equal(inactiveActor.res.statusCode, 403);
  assert.equal(inactiveActor.deleteCalls.length, 0);
});

test('missing profiles and malformed ids are rejected without Auth deletion', async () => {
  const missing = await runScenario({ profile: null });
  assert.equal(missing.res.statusCode, 404);
  assert.equal(missing.deleteCalls.length, 0);

  const malformed = await runScenario({ memberId: 'not-a-uuid' });
  assert.equal(malformed.res.statusCode, 400);
  assert.equal(malformed.deleteCalls.length, 0);
});

async function runScenario({
  actorId = ADMIN_ID,
  actorRole = 'admin',
  actorActive = true,
  permissionAllowed = true,
  memberId = MEMBER_ID,
  profile,
  targetAdmin = null,
} = {}) {
  if (profile === undefined) profile = { id: memberId, name: '測試會員', role: 'professional' };
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

    if (request.url.endsWith('/rest/v1/rpc/has_backoffice_permission')) return jsonResponse(permissionAllowed);
    if (request.url.endsWith('/auth/v1/user')) return jsonResponse({ id: actorId, email: 'admin@example.com' });
    if (request.url.includes('/rest/v1/admin_users?')) {
      const requestedId = new URL(request.url).searchParams.get('user_id')?.replace(/^eq\./, '');
      if (requestedId === actorId) return jsonResponse([{ user_id: actorId, role: actorRole, active: actorActive }]);
      if (requestedId === memberId && targetAdmin) return jsonResponse([targetAdmin]);
      return jsonResponse([]);
    }
    if (request.url.includes('/rest/v1/profiles?')) return jsonResponse(profile ? [profile] : []);
    if (request.url.endsWith(`/auth/v1/admin/users/${memberId}`)) return emptyResponse();
    if (request.url.endsWith('/rest/v1/audit_logs')) return emptyResponse();
    throw new Error(`Unexpected fetch: ${request.url}`);
  };

  const res = createRes();
  try {
    await adminDeleteMember({
      method: 'DELETE',
      headers: { authorization: 'Bearer admin-access-token' },
      body: { memberId },
    }, res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  }

  return {
    res,
    calls,
    deleteCalls: calls.filter(call => call.url.includes('/auth/v1/admin/users/')),
  };
}

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
