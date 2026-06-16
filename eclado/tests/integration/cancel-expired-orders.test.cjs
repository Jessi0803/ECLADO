const test = require('node:test');
const assert = require('node:assert/strict');
const cancelExpiredOrders = require('../../api/cancel-expired-orders.js');

test('cancel expired orders - requires cron auth when x-vercel-cron is absent', async () => {
  const originalEnv = {
    CRON_SECRET: process.env.CRON_SECRET,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  };

  process.env.CRON_SECRET = 'test-cron-secret';
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

  const res = createRes();
  try {
    await cancelExpiredOrders({ method: 'POST', headers: {}, body: {} }, res);
  } finally {
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.jsonBody, { error: 'Unauthorized' });
});

test('cancel expired orders - cancels awaiting_confirm and unpaid orders older than 24 hours', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalNow = Date.now;
  const originalEnv = {
    CRON_SECRET: process.env.CRON_SECRET,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    ORDER_PAYMENT_EXPIRE_HOURS: process.env.ORDER_PAYMENT_EXPIRE_HOURS,
  };

  process.env.CRON_SECRET = 'test-cron-secret';
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  delete process.env.ORDER_PAYMENT_EXPIRE_HOURS;
  Date.now = () => Date.parse('2026-05-21T12:00:00.000Z');

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (options.method === 'GET') {
      assert.match(String(url), /status=in\.\(awaiting_confirm,unpaid\)/);
      assert.match(String(url), /created_at=lt\.2026-05-20T12%3A00%3A00\.000Z/);
      return jsonResponse(200, [
        { id: 'OLD-001', status: 'awaiting_confirm', created_at: '2026-05-20T10:00:00.000Z' },
        { id: 'OLD-002', status: 'unpaid', created_at: '2026-05-20T09:00:00.000Z' },
      ]);
    }

    if (options.method === 'PATCH') {
      assert.match(String(url), /id=in\.\(OLD-001,OLD-002\)/);
      assert.match(String(url), /status=in\.\(awaiting_confirm,unpaid\)/);
      assert.deepEqual(JSON.parse(options.body), { status: 'cancelled' });
      return jsonResponse(200, [
        { id: 'OLD-001', status: 'cancelled' },
        { id: 'OLD-002', status: 'cancelled' },
      ]);
    }

    throw new Error(`Unexpected fetch ${options.method} ${url}`);
  };

  const res = createRes();

  try {
    await cancelExpiredOrders({
      method: 'POST',
      headers: { authorization: 'Bearer test-cron-secret' },
      body: {},
    }, res);
  } finally {
    global.fetch = originalFetch;
    Date.now = originalNow;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.ok, true);
  assert.equal(res.jsonBody.cancelled, 2);
  assert.deepEqual(res.jsonBody.orderIds, ['OLD-001', 'OLD-002']);
  assert.equal(calls.length, 2);
});

test('cancel expired orders - rejects unsupported methods', async () => {
  const res = createRes();

  await cancelExpiredOrders({ method: 'PUT', headers: {}, body: {} }, res);

  assert.equal(res.statusCode, 405);
  assert.deepEqual(res.jsonBody, { error: 'Method not allowed' });
});

test('cancel expired orders - returns zero when no expired orders exist', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalNow = Date.now;
  const originalEnv = {
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  Date.now = () => Date.parse('2026-05-21T12:00:00.000Z');

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    assert.equal(options.method, 'GET');
    return jsonResponse(200, []);
  };

  const res = createRes();

  try {
    await cancelExpiredOrders({
      method: 'POST',
      headers: { 'x-vercel-cron': '1' },
      body: {},
    }, res);
  } finally {
    global.fetch = originalFetch;
    Date.now = originalNow;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.ok, true);
  assert.equal(res.jsonBody.cancelled, 0);
  assert.equal(res.jsonBody.message, 'No expired unpaid orders');
  assert.equal(calls.length, 1);
});

test('cancel expired orders - returns 500 when service key is missing', async () => {
  const originalEnv = {
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const originalError = console.error;
  console.error = () => {};
  delete process.env.SUPABASE_SERVICE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const res = createRes();

  try {
    await cancelExpiredOrders({
      method: 'POST',
      headers: { 'x-vercel-cron': '1' },
      body: {},
    }, res);
  } finally {
    console.error = originalError;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.jsonBody, { ok: false, error: 'SUPABASE_SERVICE_KEY not set' });
});

test('cancel expired orders - returns 500 when Supabase update fails', async () => {
  const originalFetch = global.fetch;
  const originalError = console.error;
  const originalEnv = {
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  console.error = () => {};

  global.fetch = async (url, options = {}) => {
    if (options.method === 'GET') {
      return jsonResponse(200, [
        { id: 'OLD-003', status: 'awaiting_confirm', created_at: '2026-05-20T10:00:00.000Z' },
      ]);
    }
    if (options.method === 'PATCH') {
      assert.match(String(url), /id=in\.\(OLD-003\)/);
      return jsonResponse(500, { message: 'staging update failed' });
    }
    throw new Error(`Unexpected fetch ${options.method} ${url}`);
  };

  const res = createRes();

  try {
    await cancelExpiredOrders({
      method: 'POST',
      headers: { 'x-vercel-cron': '1' },
      body: {},
    }, res);
  } finally {
    global.fetch = originalFetch;
    console.error = originalError;
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.jsonBody, { ok: false, error: 'staging update failed' });
});

function createRes() {
  return {
    statusCode: 200,
    jsonBody: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.jsonBody = body;
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
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
