const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const test = require('node:test');
const assert = require('node:assert/strict');
const lineWebhook = require('../../api/line-webhook.js');

test('LINE webhook - GET health check returns OK without a secret', async () => {
  const originalSecret = process.env.LINE_CHANNEL_SECRET;
  delete process.env.LINE_CHANNEL_SECRET;
  const res = createRes();

  try {
    await lineWebhook(createReq('GET'), res);
  } finally {
    restoreEnv('LINE_CHANNEL_SECRET', originalSecret);
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.sentBody, 'OK');
});

test('LINE webhook - rejects unsupported methods before webhook authentication', async () => {
  const res = createRes();

  await lineWebhook(createReq('PUT'), res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.ended, true);
});

test('LINE webhook - fails closed when the verification secret is missing', async () => {
  const originalSecret = process.env.LINE_CHANNEL_SECRET;
  const originalError = console.error;
  const originalLog = console.log;
  const errors = [];
  const logs = [];
  delete process.env.LINE_CHANNEL_SECRET;
  console.error = (...args) => errors.push(args);
  console.log = (...args) => logs.push(args);
  const rawBody = JSON.stringify({ events: [{ type: 'follow', source: { userId: 'U-forged' } }] });
  const res = createRes();

  try {
    await lineWebhook(createReq('POST', rawBody), res);
  } finally {
    console.error = originalError;
    console.log = originalLog;
    restoreEnv('LINE_CHANNEL_SECRET', originalSecret);
  }

  assert.equal(res.statusCode, 503);
  assert.equal(res.sentBody, 'Webhook verification unavailable');
  assert.equal(errors.length, 1);
  assert.deepEqual(logs, []);
});

test('LINE webhook - treats a blank verification secret as missing', async () => {
  const originalSecret = process.env.LINE_CHANNEL_SECRET;
  const originalError = console.error;
  process.env.LINE_CHANNEL_SECRET = '   ';
  console.error = () => {};
  const res = createRes();

  try {
    await lineWebhook(createReq('POST', '{"events":[]}'), res);
  } finally {
    console.error = originalError;
    restoreEnv('LINE_CHANNEL_SECRET', originalSecret);
  }

  assert.equal(res.statusCode, 503);
});

test('LINE webhook - rejects a missing or invalid signature when secret is configured', async () => {
  const originalSecret = process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET = 'test-line-secret';

  try {
    for (const signature of [undefined, 'bad-signature']) {
      const res = createRes();
      await lineWebhook(createReq('POST', '{"events":[]}', signature
        ? { 'x-line-signature': signature }
        : {}), res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.sentBody, 'Invalid signature');
    }
  } finally {
    restoreEnv('LINE_CHANNEL_SECRET', originalSecret);
  }
});

test('LINE webhook - verifies and parses the exact raw JSON bytes', async () => {
  const originalSecret = process.env.LINE_CHANNEL_SECRET;
  const originalLog = console.log;
  const logs = [];
  const secret = 'test-line-secret';
  const rawBody = '{\n  "events": [{"type":"follow","source":{"userId":"U-\\u6e2c\\u8a66"}}]\n}';

  process.env.LINE_CHANNEL_SECRET = secret;
  console.log = (...args) => logs.push(args);
  const res = createRes();

  try {
    await lineWebhook(createReq('POST', rawBody, {
      'x-line-signature': signRawBody(rawBody, secret),
    }), res);
  } finally {
    console.log = originalLog;
    restoreEnv('LINE_CHANNEL_SECRET', originalSecret);
  }

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.jsonBody, { status: 'ok' });
  assert.deepEqual(logs[0], ['[LINE] new follower:', 'U-測試']);
});

test('LINE webhook - rejects a signature for semantically equal but different bytes', async () => {
  const originalSecret = process.env.LINE_CHANNEL_SECRET;
  const secret = 'test-line-secret';
  const compact = '{"events":[]}';
  const pretty = '{\n  "events": []\n}';
  process.env.LINE_CHANNEL_SECRET = secret;
  const res = createRes();

  try {
    await lineWebhook(createReq('POST', pretty, {
      'x-line-signature': signRawBody(compact, secret),
    }), res);
  } finally {
    restoreEnv('LINE_CHANNEL_SECRET', originalSecret);
  }

  assert.equal(res.statusCode, 403);
});

test('LINE webhook - returns 400 for malformed JSON with a valid signature', async () => {
  const originalSecret = process.env.LINE_CHANNEL_SECRET;
  const secret = 'test-line-secret';
  const rawBody = '{"events":[';
  process.env.LINE_CHANNEL_SECRET = secret;
  const res = createRes();

  try {
    await lineWebhook(createReq('POST', rawBody, {
      'x-line-signature': signRawBody(rawBody, secret),
    }), res);
  } finally {
    restoreEnv('LINE_CHANNEL_SECRET', originalSecret);
  }

  assert.equal(res.statusCode, 400);
  assert.equal(res.sentBody, 'Invalid JSON');
});

test('LINE webhook - returns 400 when the request stream fails', async () => {
  const originalSecret = process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET = 'test-line-secret';
  const request = new Readable({
    read() {
      this.destroy(new Error('stream failed'));
    },
  });
  request.method = 'POST';
  request.headers = { 'x-line-signature': 'unused' };
  const res = createRes();

  try {
    await lineWebhook(request, res);
  } finally {
    restoreEnv('LINE_CHANNEL_SECRET', originalSecret);
  }

  assert.equal(res.statusCode, 400);
  assert.equal(res.sentBody, 'Invalid request body');
});

test('LINE webhook - accepts LINE verification payloads with no events', async () => {
  const originalSecret = process.env.LINE_CHANNEL_SECRET;
  const secret = 'test-line-secret';
  const rawBody = JSON.stringify({ destination: 'U-channel', events: [] });
  process.env.LINE_CHANNEL_SECRET = secret;
  const res = createRes();

  try {
    await lineWebhook(createReq('POST', rawBody, {
      'x-line-signature': signRawBody(rawBody, secret),
    }), res);
  } finally {
    restoreEnv('LINE_CHANNEL_SECRET', originalSecret);
  }

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.jsonBody, { status: 'ok' });
});

test('LINE webhook - does not impose a body limit below the hosting platform limit', async () => {
  const originalSecret = process.env.LINE_CHANNEL_SECRET;
  const secret = 'test-line-secret';
  const rawBody = JSON.stringify({ destination: 'U'.repeat(1024 * 1024), events: [] });
  process.env.LINE_CHANNEL_SECRET = secret;
  const res = createRes();

  try {
    await lineWebhook(createReq('POST', rawBody, {
      'x-line-signature': signRawBody(rawBody, secret),
    }), res);
  } finally {
    restoreEnv('LINE_CHANNEL_SECRET', originalSecret);
  }

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.jsonBody, { status: 'ok' });
});

function signRawBody(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(Buffer.from(rawBody)).digest('base64');
}

function createReq(method, rawBody = '', headers = {}) {
  const request = Readable.from(rawBody ? [Buffer.from(rawBody)] : []);
  request.method = method;
  request.headers = headers;
  return request;
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
