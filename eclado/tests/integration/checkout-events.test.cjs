const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const handler = require('../../api/checkout-events.js');
const { validateBrowserBatch, createPaymentTrace } = require('../../payment-api/checkout-events.cjs');

function event(overrides = {}) {
  return { event_id: crypto.randomUUID(), flow_id: crypto.randomUUID(), attempt_id: crypto.randomUUID(),
    event_name: 'order_received', occurred_at: new Date().toISOString(), order_id: 'ECL-LOCAL-1', ...overrides };
}
function response() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(n) { this.statusCode = n; return this; }, json(value) { this.body = value; return this; } };
}

test('ingress strips customer data and cannot forge trusted stages or sources', () => {
  const clean = validateBrowserBatch({ events: [event({ source: 'database', email: 'private@example.com',
    token: 'secret', error_message: 'customer address', metadata: { arbitrary: 'data' } })] });
  assert.equal(clean[0].source, undefined);
  assert.doesNotMatch(JSON.stringify(clean), /private|secret|address|arbitrary/);
  for (const overrides of [{ event_name: 'order_stored' }, { event_name: 'gateway_succeeded' },
    { flow_id: 'bad' }, { occurred_at: '2020-01-01' }, { previous_attempt_id: 'bad' }]) {
    assert.throws(() => validateBrowserBatch({ events: [event(overrides)] }));
  }
  assert.throws(() => validateBrowserBatch({ events: Array.from({ length: 11 }, () => event()) }));
});

test('ingress rejects unsupported requests, preserves DB dedupe IDs and handles rate limits without exposing DB errors', async t => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vercel = process.env.VERCEL;
  t.after(() => { if (key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    if (vercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = vercel; });
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.VERCEL = '1';
  const calls = [];
  let result = true;
  t.mock.method(global, 'fetch', async (url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify(result), { status: 200 });
  });
  const req = { method: 'POST', headers: { 'content-type': 'application/json', 'x-vercel-forwarded-for': '192.0.2.1',
    'x-forwarded-for': 'forged' }, body: { events: [event()] } };
  let res = response();
  await handler({ ...req, method: 'GET' }, res);
  assert.equal(res.statusCode, 405);
  res = response(); await handler({ ...req, headers: {} }, res); assert.equal(res.statusCode, 415);
  res = response(); await handler(req, res); assert.equal(res.statusCode, 200);
  assert.equal(calls[0].p_events[0].event_id, req.body.events[0].event_id);
  assert.equal(calls[0].p_key_hash, crypto.createHmac('sha256', 'test-key').update('checkout-events:192.0.2.1').digest('hex'));
  assert.doesNotMatch(JSON.stringify(calls), /192\.0\.2\.1|forged|test-key/);
  result = false; res = response(); await handler(req, res);
  assert.equal(res.statusCode, 429); assert.equal(res.headers['Retry-After'], '900');
  t.mock.method(global, 'fetch', async () => { throw new Error('secret DB detail'); });
  res = response(); await handler(req, res); assert.equal(res.statusCode, 503);
  assert.doesNotMatch(JSON.stringify(res.body), /secret/);
});

test('payment telemetry ignores missing trace, strips raw errors and cannot reject on logging outage', async t => {
  const calls = [];
  const options = { url: 'https://isolated.invalid', key: 'test-key', fetchImpl: async (_, request) => {
    calls.push(JSON.parse(request.body)); return new Response(null, { status: 201 });
  } };
  const noTrace = createPaymentTrace(null, 'ECL-LOCAL-1', options);
  noTrace.record('payment_api_received'); await noTrace.flush(); assert.equal(calls.length, 0);
  const trace = createPaymentTrace({ flowId: crypto.randomUUID(), attemptId: crypto.randomUUID() }, 'ECL-LOCAL-1', options);
  trace.record('payment_api_received');
  trace.record('payment_api_error', { message: 'secret paymentToken=private', code: 'secret' });
  await trace.flush();
  assert.equal(calls[0].length, 2);
  assert.doesNotMatch(JSON.stringify(calls), /secret|private|paymentToken/);
  const warnings = [];
  t.mock.method(console, 'warn', message => warnings.push(message));
  const failing = createPaymentTrace({ flowId: crypto.randomUUID(), attemptId: crypto.randomUUID() }, 'ECL-LOCAL-1', {
    ...options, fetchImpl: async () => { throw new Error('private'); },
  });
  failing.record('payment_api_received'); await assert.doesNotReject(() => failing.flush());
  assert.equal(warnings.length, 1); assert.doesNotMatch(warnings[0], /private/);
});
