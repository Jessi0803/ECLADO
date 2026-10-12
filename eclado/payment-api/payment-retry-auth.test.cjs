const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Isolated HTTP/mocked upstream test; never load production credentials.
process.env.SUPABASE_URL = 'https://supabase.example.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.GUEST_LOOKUP_SECRET = 'test-guest-lookup-secret';
process.env.PAYMENT_NOTIFY_SECRET = 'test-payment-notify-secret';
const server = require('./server.js');

test('retry authorization rejects unauthorized clients and sends legitimate retries through service RPC', async () => {
  const originalFetch = global.fetch;
  const listener = http.createServer(server.app);
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${listener.address().port}/api/sinopac/retry-payment`;
  const id = 'ECL-AUTH-RETRY';
  let memberId = 'owner';
  let orderOwner = 'owner';
  let retryCalls = 0;
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/rpc/consume_service_rate_limit')) return new Response('true');
    if (target.endsWith('/auth/v1/user')) {
      return options.headers.Authorization === 'Bearer owner-session'
        ? new Response(JSON.stringify({ id: memberId }))
        : new Response('{}', { status: 401 });
    }
    if (target.endsWith('/rpc/authorize_order_payment_access')) {
      const valid = JSON.parse(options.body).p_payment_token === 'valid-payment-token';
      return new Response(JSON.stringify(valid));
    }
    if (target.includes('/rest/v1/orders?')) return new Response(JSON.stringify([{
      id, user_id: orderOwner, status: 'unpaid', total: 1000,
      payment_amount: 900, shopping_credit_amount: 100,
      payment_due_at: '2099-01-01T00:00:00.000Z', items: [], order_source: 'online',
    }]));
    if (target.includes('/rest/v1/order_payment_instructions?')) return new Response(JSON.stringify([{
      order_id: id, payment_state: 'failed', payment_method: 'card', attempt_no: 1,
    }]));
    if (target.endsWith('/rpc/begin_order_payment_retry')) {
      retryCalls += 1;
      assert.equal(options.headers.Authorization, 'Bearer test-service-role-key');
      assert.equal(options.headers.apikey, 'test-service-role-key');
      assert.equal(JSON.parse(options.body).p_order_id, id);
      // Stop at the verified boundary: do not create a bank transaction.
      return new Response(JSON.stringify({ message: 'authorized retry boundary reached' }), { status: 409 });
    }
    throw new Error(`Unexpected upstream request: ${target}`);
  };
  async function request(body = {}, bearer = '') {
    const response = await originalFetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify({ orderNo: id, ...body }),
    });
    return response.json();
  }
  try {
    for (const body of [{}, { paymentToken: 'invalid' }, { guestAccessToken: 'invalid' },
      { resultAccessToken: server.createPaymentResultAccessToken('another-order') }]) {
      assert.equal((await request(body)).ok, false);
      assert.equal(retryCalls, 0);
    }
    memberId = 'another-member';
    assert.equal((await request({}, 'owner-session')).ok, false);
    assert.equal(retryCalls, 0);
    memberId = 'owner';
    const memberResult = await request({}, 'owner-session');
    assert.match(memberResult.error, /authorized retry boundary reached/);
    assert.equal(retryCalls, 1);
    assert.match((await request({ paymentToken: 'valid-payment-token' })).error,
      /authorized retry boundary reached/);
    orderOwner = null;
    assert.match((await request({ guestAccessToken: server.createGuestAccessToken(id) })).error,
      /authorized retry boundary reached/);
    orderOwner = 'owner';
    assert.match((await request({ resultAccessToken: server.createPaymentResultAccessToken(id) })).error,
      /authorized retry boundary reached/);
    assert.equal(retryCalls, 4);
  } finally {
    global.fetch = originalFetch;
    await new Promise(resolve => listener.close(resolve));
  }
});
