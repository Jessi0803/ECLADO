const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
process.env.SUPABASE_URL = 'https://schema-compat.example.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-schema-key';
process.env.GUEST_LOOKUP_SECRET = 'isolated-guest-secret';
const server = require('./server');
const missing = { code: '42703', message: 'column orders.reward_credit_amount does not exist' };
const order = { id: 'LEGACY', user_id: null, phone: '0912345678', total: 1000, shopping_credit_amount: 100, payment_amount: 900, status: 'unpaid', items: [], payment_due_at: '2099-01-01T00:00:00Z' };

test('legacy order read retries only the absent reward column, preserves filters and authoritative bank amount', async () => {
  const original = global.fetch, queries = [];
  try {
    global.fetch = async (url, options) => {
      if (String(url).includes('/orders?')) {
        const params = new URL(url).searchParams; queries.push(params);
        assert.equal(options.headers.Authorization, 'Bearer isolated-schema-key');
        return params.get('select').includes('reward_credit_amount')
          ? new Response(JSON.stringify(missing), { status: 400 })
          : new Response(JSON.stringify([order]));
      }
      assert.ok(String(url).endsWith('/claim_order_payment'));
      return new Response(JSON.stringify({ ...order, total: 900, order_total: 1000 }));
    };
    const body = await server.buildAuthoritativeCreateBody({ orderNo: 'LEGACY', paymentToken: 'fake', amount: 99999, payType: 'C' });
    assert.equal(body.Amount, 90000);
    assert.equal(queries.length, 2);
    assert.equal(queries[1].get('id'), queries[0].get('id'));
    assert.equal(queries[1].get('limit'), '1');
    assert.equal(queries[1].get('select'), queries[0].get('select').split(',').filter(x => x !== 'reward_credit_amount').join(','));
  } finally { global.fetch = original; }
});

test('permission, unrelated missing column and storage failures never downgrade the order projection', async () => {
  const original = global.fetch;
  try {
    for (const [status, error] of [[403, { code: '42501' }], [400, { code: '42703', message: 'column orders.payment_amount does not exist' }], [500, { message: 'storage unavailable' }]]) {
      let calls = 0;
      global.fetch = async () => { calls++; return new Response(JSON.stringify(error), { status }); };
      await assert.rejects(server.buildAuthoritativeCreateBody({ orderNo: 'LEGACY', paymentToken: 'fake' }), /order lookup failed/);
      assert.equal(calls, 1);
    }
  } finally { global.fetch = original; }
});

test('schema cache fallback is temporary: subsequent reads use the newly installed reward column', async () => {
  const original = global.fetch; let installed = false, legacyReads = 0, rewardReads = 0;
  try {
    global.fetch = async url => {
      if (String(url).includes('/orders?')) {
        if (new URL(url).searchParams.get('select').includes('reward_credit_amount')) {
          rewardReads++;
          if (!installed) return new Response(JSON.stringify({ code: 'PGRST204', message: "Could not find the 'reward_credit_amount' column of 'orders' in the schema cache" }), { status: 400 });
          return new Response(JSON.stringify([{ ...order, reward_credit_amount: 800, payment_amount: 100 }]));
        }
        legacyReads++; return new Response(JSON.stringify([order]));
      }
      return new Response(JSON.stringify({ ...order, total: installed ? 100 : 900, order_total: 1000 }));
    };
    assert.equal((await server.buildAuthoritativeCreateBody({ orderNo: 'LEGACY', paymentToken: 'fake', payType: 'C' })).Amount, 90000);
    installed = true;
    assert.equal((await server.buildAuthoritativeCreateBody({ orderNo: 'LEGACY', paymentToken: 'fake', payType: 'C' })).Amount, 10000);
    assert.equal(legacyReads, 1); assert.equal(rewardReads, 2);
  } finally { global.fetch = original; }
});

test('legacy guest lookup preserves code/phone checks and private-field redaction', async () => {
  const original = global.fetch, queries = [];
  const listener = http.createServer(server.app);
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  try {
    global.fetch = async url => {
      if (String(url).endsWith('/consume_service_rate_limit')) return new Response('true');
      if (String(url).includes('/orders?')) {
        const params = new URL(url).searchParams; queries.push(params);
        return params.get('select').includes('reward_credit_amount')
          ? new Response(JSON.stringify(missing), { status: 400 })
          : new Response(JSON.stringify([order]));
      }
      if (String(url).includes('/order_payment_instructions?')) return new Response('[]');
      throw new Error('Unexpected upstream');
    };
    for (const [phone, expected] of [['0912345678', 200], ['0987654321', 400]]) {
      const response = await original(`http://127.0.0.1:${listener.address().port}/api/orders/guest-lookup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lookupCode: 'ABCDE12345', phone }) });
      assert.equal(response.status, expected);
      const body = await response.json();
      if (expected === 200) {
        assert.equal(body.order.reward_credit_amount, 0);
        assert.equal(body.order.phone, undefined);
        assert.ok(server.verifyGuestAccessToken(body.guestAccessToken, 'LEGACY'));
      } else assert.equal(body.guestAccessToken, undefined);
    }
    assert.equal(queries.length, 4);
    for (const params of queries) assert.equal(params.get('public_lookup_code'), 'eq.ABCDE-12345');
  } finally { global.fetch = original; await new Promise(resolve => listener.close(resolve)); }
});
