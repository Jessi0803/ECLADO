const test = require('node:test');
const assert = require('node:assert/strict');
const remindUnpaidOrders = require('../../api/remind-unpaid-orders.js');

test('remind unpaid orders - reminder delay defaults to 3 hours', () => {
  const originalEnv = {
    ORDER_PAYMENT_REMIND_MINUTES: process.env.ORDER_PAYMENT_REMIND_MINUTES,
    ORDER_PAYMENT_REMIND_HOURS: process.env.ORDER_PAYMENT_REMIND_HOURS,
    ORDER_PAYMENT_SECOND_REMIND_MINUTES: process.env.ORDER_PAYMENT_SECOND_REMIND_MINUTES,
    ORDER_PAYMENT_SECOND_REMIND_HOURS: process.env.ORDER_PAYMENT_SECOND_REMIND_HOURS,
  };

  try {
    delete process.env.ORDER_PAYMENT_REMIND_MINUTES;
    delete process.env.ORDER_PAYMENT_REMIND_HOURS;
    delete process.env.ORDER_PAYMENT_SECOND_REMIND_MINUTES;
    delete process.env.ORDER_PAYMENT_SECOND_REMIND_HOURS;
    assert.equal(remindUnpaidOrders.__test.getReminderDelayMs(), 3 * 60 * 60 * 1000);
    assert.equal(remindUnpaidOrders.__test.getSecondReminderDelayMs(), 24 * 60 * 60 * 1000);

    process.env.ORDER_PAYMENT_REMIND_HOURS = '3';
    assert.equal(remindUnpaidOrders.__test.getReminderDelayMs(), 3 * 60 * 60 * 1000);

    process.env.ORDER_PAYMENT_REMIND_MINUTES = '10';
    assert.equal(remindUnpaidOrders.__test.getReminderDelayMs(), 10 * 60 * 1000);
  } finally {
    restoreEnv(originalEnv);
  }
});

test('remind unpaid orders - sends LINE first and marks reminded', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalNow = Date.now;
  const originalEnv = {
    CRON_SECRET: process.env.CRON_SECRET,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    ORDER_PAYMENT_REMIND_MINUTES: process.env.ORDER_PAYMENT_REMIND_MINUTES,
    ORDER_PAYMENT_REMIND_HOURS: process.env.ORDER_PAYMENT_REMIND_HOURS,
  };

  process.env.CRON_SECRET = 'test-cron-secret';
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-line-token';
  process.env.RESEND_API_KEY = 'test-resend-key';
  delete process.env.ORDER_PAYMENT_REMIND_MINUTES;
  delete process.env.ORDER_PAYMENT_REMIND_HOURS;
  Date.now = () => Date.parse('2026-05-21T12:00:00.000Z');

  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (String(url).includes('/rest/v1/orders?') && options.method === 'GET') {
      assert.match(String(url), /status=in\.\(awaiting_confirm,unpaid\)/);
      assert.match(String(url), /created_at=lte\.2026-05-21T09%3A00%3A00\.000Z/);
      assert.match(String(url), /payment_due_at=gt\.2026-05-21T12%3A00%3A00\.000Z/);
      assert.match(String(url), /or=\(payment_reminded_at\.is\.null,and\(created_at\.lte\.2026-05-20T12%3A00%3A00\.000Z,payment_second_reminded_at\.is\.null\)\)/);
      return jsonResponse(200, [
        {
          id: 'REMIND-LINE-001',
          status: 'unpaid',
          created_at: '2026-05-21T08:30:00.000Z',
          total: 4130,
          user_id: 'user-line-001',
          member: 'LINE 買家',
          email: 'buyer@example.com',
          payment_reminded_at: null,
          payment_second_reminded_at: null,
          payment_due_at: '2026-05-23T08:30:00.000Z',
        },
      ]);
    }

    if (String(url).includes('/rest/v1/profiles?id=eq.user-line-001')) {
      return jsonResponse(200, [{ line_user_id: 'U1234567890', email: 'profile@example.com' }]);
    }

    if (url === 'https://api.line.me/v2/bot/message/push') {
      const body = JSON.parse(options.body);
      assert.equal(options.headers.Authorization, 'Bearer test-line-token');
      assert.equal(body.to, 'U1234567890');
      assert.match(body.messages[0].text, /尚未完成付款/);
      assert.match(body.messages[0].text, /訂單編號：REMIND-LINE-001/);
      assert.match(body.messages[0].text, /訂單金額：NT\$ 4,130/);
      return jsonResponse(200, { ok: true });
    }

    if (String(url).includes('/rest/v1/orders?id=eq.REMIND-LINE-001') && options.method === 'PATCH') {
      assert.match(String(url), /payment_reminded_at=is\.null/);
      assert.ok(JSON.parse(options.body).payment_reminded_at);
      return jsonResponse(200, []);
    }

    if (url === 'https://api.resend.com/emails') {
      throw new Error('email should not send when LINE succeeds');
    }

    throw new Error(`Unexpected fetch ${options.method} ${url}`);
  };

  const res = createRes();

  try {
    await remindUnpaidOrders({
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
  assert.equal(res.jsonBody.checked, 1);
  assert.equal(res.jsonBody.reminded, 1);
  assert.equal(res.jsonBody.results[0].lineSent, true);
  assert.equal(calls.filter(call => call.url === 'https://api.line.me/v2/bot/message/push').length, 1);
});

test('remind unpaid orders - falls back to email when LINE is unavailable', async () => {
  const originalFetch = global.fetch;
  const originalNow = Date.now;
  const originalEnv = {
    CRON_SECRET: process.env.CRON_SECRET,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    ORDER_PAYMENT_REMIND_MINUTES: process.env.ORDER_PAYMENT_REMIND_MINUTES,
    ORDER_PAYMENT_REMIND_HOURS: process.env.ORDER_PAYMENT_REMIND_HOURS,
  };

  process.env.CRON_SECRET = 'test-cron-secret';
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  process.env.RESEND_API_KEY = 'test-resend-key';
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  delete process.env.ORDER_PAYMENT_REMIND_MINUTES;
  delete process.env.ORDER_PAYMENT_REMIND_HOURS;
  Date.now = () => Date.parse('2026-05-21T12:00:00.000Z');

  global.fetch = async (url, options = {}) => {
    if (String(url).includes('/rest/v1/orders?') && options.method === 'GET') {
      return jsonResponse(200, [
        {
          id: 'REMIND-EMAIL-001',
          status: 'awaiting_confirm',
          created_at: '2026-05-21T07:30:00.000Z',
          total: 8800,
          user_id: null,
          member: 'Email 買家',
          email: 'buyer@example.com',
          payment_reminded_at: null,
          payment_second_reminded_at: null,
          payment_due_at: '2026-05-23T07:30:00.000Z',
        },
      ]);
    }

    if (url === 'https://api.resend.com/emails') {
      const body = JSON.parse(options.body);
      assert.equal(options.headers.Authorization, 'Bearer test-resend-key');
      assert.deepEqual(body.to, ['buyer@example.com']);
      assert.match(body.subject, /付款提醒/);
      assert.match(body.text, /尚未完成付款/);
      assert.match(body.text, /訂單編號：REMIND-EMAIL-001/);
      return jsonResponse(200, { id: 'email_reminder_001' });
    }

    if (String(url).includes('/rest/v1/orders?id=eq.REMIND-EMAIL-001') && options.method === 'PATCH') {
      return jsonResponse(200, []);
    }

    throw new Error(`Unexpected fetch ${options.method} ${url}`);
  };

  const res = createRes();

  try {
    await remindUnpaidOrders({
      method: 'GET',
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
  assert.equal(res.jsonBody.checked, 1);
  assert.equal(res.jsonBody.reminded, 1);
  assert.equal(res.jsonBody.results[0].emailSent, true);
});

test('remind unpaid orders - sends a second reminder after 24 hours and marks both timestamps', async () => {
  const originalFetch = global.fetch;
  const originalNow = Date.now;
  const originalEnv = {
    CRON_SECRET: process.env.CRON_SECRET,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  };

  process.env.CRON_SECRET = 'test-cron-secret';
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-line-token';
  Date.now = () => Date.parse('2026-05-21T12:00:00.000Z');

  global.fetch = async (url, options = {}) => {
    if (String(url).includes('/rest/v1/orders?') && options.method === 'GET') {
      return jsonResponse(200, [{
        id: 'REMIND-SECOND-001',
        status: 'unpaid',
        created_at: '2026-05-20T11:00:00.000Z',
        total: 5200,
        user_id: 'user-line-002',
        member: '第二次提醒買家',
        email: 'buyer@example.com',
        payment_reminded_at: null,
        payment_second_reminded_at: null,
        payment_due_at: '2026-05-22T11:00:00.000Z',
      }]);
    }
    if (String(url).includes('/rest/v1/profiles?id=eq.user-line-002')) {
      return jsonResponse(200, [{ line_user_id: 'U2222222222', email: 'buyer@example.com' }]);
    }
    if (url === 'https://api.line.me/v2/bot/message/push') {
      const body = JSON.parse(options.body);
      assert.match(body.messages[0].text, /仍未完成付款/);
      assert.match(body.messages[0].text, /最後提醒/);
      assert.match(body.messages[0].text, /付款期限/);
      return jsonResponse(200, { ok: true });
    }
    if (String(url).includes('/rest/v1/orders?id=eq.REMIND-SECOND-001') && options.method === 'PATCH') {
      assert.match(String(url), /payment_second_reminded_at=is\.null/);
      const body = JSON.parse(options.body);
      assert.equal(body.payment_reminded_at, '2026-05-21T12:00:00.000Z');
      assert.equal(body.payment_second_reminded_at, '2026-05-21T12:00:00.000Z');
      return jsonResponse(200, []);
    }
    throw new Error(`Unexpected fetch ${options.method} ${url}`);
  };

  const res = createRes();
  try {
    await remindUnpaidOrders({
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
  assert.equal(res.jsonBody.results[0].stage, 'second');
  assert.equal(res.jsonBody.results[0].marked, true);
});

test('remind unpaid orders - rejects forged x-vercel-cron header without bearer secret', async () => {
  const originalEnv = {
    CRON_SECRET: process.env.CRON_SECRET,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  };

  process.env.CRON_SECRET = 'test-cron-secret';
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';

  const res = createRes();

  try {
    await remindUnpaidOrders({
      method: 'POST',
      headers: { 'x-vercel-cron': '1' },
      body: {},
    }, res);
  } finally {
    restoreEnv(originalEnv);
  }

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.jsonBody, { error: 'Unauthorized' });
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
  return new Response(body === null ? '' : JSON.stringify(body), {
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
