const crypto = require('node:crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const lineWebhook = require('../../api/line-webhook.js');

test('LINE webhook - GET health check returns OK', async () => {
  const res = createRes();

  await lineWebhook({ method: 'GET', headers: {}, body: {} }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.sentBody, 'OK');
});

test('LINE webhook - rejects unsupported methods', async () => {
  const res = createRes();

  await lineWebhook({ method: 'PUT', headers: {}, body: {} }, res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.ended, true);
});

test('LINE webhook - rejects invalid signature when secret is configured', async () => {
  const originalSecret = process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET = 'test-line-secret';

  const res = createRes();
  try {
    await lineWebhook({
      method: 'POST',
      headers: { 'x-line-signature': 'bad-signature' },
      body: { events: [] },
    }, res);
  } finally {
    restoreEnv('LINE_CHANNEL_SECRET', originalSecret);
  }

  assert.equal(res.statusCode, 403);
  assert.equal(res.sentBody, 'Invalid signature');
});

test('LINE webhook - accepts valid follow event signature', async () => {
  const originalSecret = process.env.LINE_CHANNEL_SECRET;
  const originalLog = console.log;
  const logs = [];
  const secret = 'test-line-secret';
  const body = {
    events: [
      { type: 'follow', source: { userId: 'U-test-follower' } },
    ],
  };

  process.env.LINE_CHANNEL_SECRET = secret;
  console.log = (...args) => logs.push(args);

  const res = createRes();
  try {
    await lineWebhook({
      method: 'POST',
      headers: { 'x-line-signature': signBody(body, secret) },
      body,
    }, res);
  } finally {
    console.log = originalLog;
    restoreEnv('LINE_CHANNEL_SECRET', originalSecret);
  }

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.jsonBody, { status: 'ok' });
  assert.deepEqual(logs[0], ['[LINE] new follower:', 'U-test-follower']);
});

function signBody(body, secret) {
  return crypto.createHmac('SHA256', secret).update(JSON.stringify(body)).digest('base64');
}

function createRes() {
  return {
    statusCode: 200,
    sentBody: null,
    jsonBody: null,
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.sentBody = body;
      return this;
    },
    json(body) {
      this.jsonBody = body;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
