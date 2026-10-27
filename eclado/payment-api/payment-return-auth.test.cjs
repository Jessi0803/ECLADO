const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// All credentials and upstreams are fixtures; only the loopback app is contacted.
Object.assign(process.env, {
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  SINOPAC_API_BASE_URL: 'https://bank.example.test/api',
  SINOPAC_SHOP_NO: 'TESTSHOP', SINOPAC_X_KEY: 'test-bank-key',
  SINOPAC_A1: '65960834240E44B7', SINOPAC_A2: '2831076A098E49E7',
  SINOPAC_B1: 'CB1AFFBF915A492B', SINOPAC_B2: '7F242C0AA612454F',
  GUEST_LOOKUP_SECRET: 'test-guest-secret',
  PAYMENT_NOTIFY_SECRET: 'test-notify-secret',
  PAYMENT_NOTIFY_FORWARD_URL: 'https://site.example.test/notify',
});
const server = require('./server.js');

async function fixture(run) {
  const nativeFetch = global.fetch;
  const listener = http.createServer(server.app);
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${listener.address().port}`;
  const state = {
    provider: 'ECL-RETURN-A', site: 'ECL-RETURN-A', apiStatus: 'S',
    transactionStatus: 'F', payStatus: 'N', orderStatus: 'unpaid', owner: null,
    mapping: true, calls: [], bankAmount: 100000, orderApiStatus: 'S',
    orderIdentity: null, bankShop: 'TESTSHOP', currency: 'TWD',
    total: 1000, paymentAmount: 1000,
  };
  global.fetch = async (url, options = {}) => {
    const target = new URL(String(url));
    state.calls.push({ url: target, method: options.method || 'GET', body: options.body });
    if (target.href === 'https://bank.example.test/api/Nonce') return Response.json({ Nonce: 'fixture-nonce' });
    if (target.href === 'https://bank.example.test/api/Order') {
      const envelope = JSON.parse(options.body);
      const input = JSON.parse(server.decryptMessage(server.getAesKey(), envelope.Message, envelope.Nonce));
      let data;
      if (envelope.APIService === 'OrderPayQuery') {
        assert.equal(input.PayToken, 'own-bank-token');
        data = { Status: state.apiStatus, ShopNo: state.bankShop, TSResultContent: {
          OrderNo: state.provider, Status: state.transactionStatus, APType: 'PayOut', ShopNo: state.bankShop,
        } };
      } else {
        assert.equal(envelope.APIService, 'OrderQuery');
        data = { Status: state.orderApiStatus, ShopNo: state.bankShop, OrderList: [{
          OrderNo: state.orderIdentity ?? input.OrderNo, PayStatus: state.payStatus,
          Amount: state.bankAmount, CurrencyID: state.currency,
        }] };
      }
      const nonce = 'fixture-response-nonce';
      return Response.json({ Nonce: nonce,
        Message: server.encryptMessage(server.getAesKey(), JSON.stringify(data), nonce),
        Sign: server.generateSign(data, server.getAesKey(), nonce) });
    }
    assert.ok(['supabase.example.test', 'site.example.test'].includes(target.host), 'unmocked external request');
    if (target.host === 'site.example.test') return Response.json({ ok: true });
    if (target.pathname.endsWith('/consume_service_rate_limit')) return Response.json(true);
    if (target.pathname.endsWith('/record_verified_reward_wallet_payment')) return Response.json({ applicable: false });
    if (target.pathname === '/rest/v1/order_payment_attempts' && !options.method) {
      assert.equal(target.searchParams.get('provider_order_no'), `eq.${state.provider}`);
      return Response.json(state.mapping ? [{ order_id: state.site }] : []);
    }
    if (target.pathname === '/rest/v1/orders') {
      if (target.searchParams.has('public_lookup_code')) {
        assert.equal(target.searchParams.get('public_lookup_code'), 'eq.ABCDE-12345');
      } else assert.equal(target.searchParams.get('id'), `eq.${state.site}`);
      if (options.method === 'PATCH' && target.searchParams.get('status') === 'in.(awaiting_confirm,unpaid)'
          && !['awaiting_confirm', 'unpaid'].includes(state.orderStatus)) return Response.json([]);
      return Response.json([{ id: state.site, user_id: state.owner, phone: '0912345678',
        public_lookup_code: 'ABCDE-12345', status: options.method === 'PATCH' ? 'paid' : state.orderStatus,
        total: state.total, payment_amount: state.paymentAmount, items: [], payment_due_at: '2099-01-01T00:00:00Z' }]);
    }
    if (target.pathname === '/rest/v1/order_payment_instructions' && !options.method) {
      return Response.json([{ order_id: state.site, payment_method: 'card', payment_state: 'failed' }]);
    }
    if (['/rest/v1/order_payment_diagnostics', '/rest/v1/order_payment_instructions',
      '/rest/v1/order_payment_attempts'].includes(target.pathname) && options.method === 'POST' ||
      ['/rest/v1/order_payment_instructions', '/rest/v1/order_payment_attempts'].includes(target.pathname) && options.method === 'PATCH') {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected fixture upstream: ${target.pathname}`);
  };
  const request = async (path, body) => nativeFetch(`${base}${path}`, {
    redirect: 'manual', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  try { await run({ state, request }); }
  finally { global.fetch = nativeFetch; await new Promise(resolve => listener.close(resolve)); }
}

function resultUrl(response) {
  assert.equal(response.status, 303);
  return new URL(response.headers.get('location'));
}
function assertNoLocalEffects(state) {
  assert.equal(state.calls.some(call => call.url.host !== 'bank.example.test' && call.method !== 'GET'), false);
}

test('return rejects a caller-owned PayToken paired with another order, including conflicting aliases', async () => {
  await fixture(async ({ state, request }) => {
    const cases = [
      ['/return?orderNo=ECL-RETURN-B&payToken=own-bank-token'],
      ['/return?orderNo=ECL-RETURN-B', { OrderNo: state.site, PayToken: 'own-bank-token' }],
      ['/return?orderNo=ECL-RETURN-A', { OrderNo: 'ECL-RETURN-B', PayToken: 'own-bank-token' }],
      ['/return', { orderNo: state.site, OrderNo: 'ECL-RETURN-B', PayToken: 'own-bank-token' }],
      ['/return?OrderNo=ECL-RETURN-B&PayToken=own-bank-token'],
      ['/return', { OrderNo: [state.site, 'ECL-RETURN-B'], PayToken: 'own-bank-token' }],
    ];
    for (const [path, body] of cases) {
      state.calls = [];
      assert.equal(resultUrl(await request(path, body)).searchParams.has('resultToken'), false);
      assertNoLocalEffects(state);
    }
  });
});

test('return requires successful bank API identity, even when the request supplies an order', async () => {
  await fixture(async ({ state, request }) => {
    for (const [apiStatus, provider] of [['S', ''], ['S', null], ['S', ['ECL-RETURN-A']], ['F', state.site], ['', state.site]]) {
      state.apiStatus = apiStatus; state.provider = provider; state.calls = [];
      const url = resultUrl(await request('/return', { OrderNo: state.site, PayToken: 'own-bank-token' }));
      assert.equal(url.searchParams.has('resultToken'), false);
      assertNoLocalEffects(state);
    }
  });
});

test('verified pending and declined returns retain query authorization for both guests and members', async () => {
  await fixture(async ({ state, request }) => {
    for (const owner of [null, 'member-owner']) {
      state.owner = owner;
      for (const payStatus of ['N', 'DECLINED']) {
        state.payStatus = payStatus;
        const url = resultUrl(await request(`/return?orderNo=${state.site}`, { PayToken: 'own-bank-token' }));
        const token = url.searchParams.get('resultToken');
        assert.equal(server.verifyPaymentResultAccessToken(token, state.site), true);
        assert.equal(url.searchParams.get('result'), payStatus === 'N' ? 'pending' : 'failed');
        state.orderStatus = 'paid'; // Terminal query proves the issued capability is usable without another bank call.
        const result = await request('/api/sinopac/query-payment', { orderNo: state.site, resultAccessToken: token });
        assert.equal(result.status, 200);
        assert.equal((await result.json()).order.id, state.site);
        state.orderStatus = 'unpaid';
      }
    }
  });
});

test('return maps retry provider identity to site order before issuing a result token', async () => {
  await fixture(async ({ state, request }) => {
    state.provider = `${state.site}-R2`;
    const path = `/return?orderNo=${state.site}`;
    let url = resultUrl(await request(path, { OrderNo: state.provider, PayToken: 'own-bank-token' }));
    assert.equal(url.searchParams.get('orderNo'), state.site);
    assert.equal(server.verifyPaymentResultAccessToken(url.searchParams.get('resultToken'), state.site), true);
    // A provider-only hint must still map to the site order rather than bypass the lookup.
    url = resultUrl(await request('/return', { OrderNo: state.provider, PayToken: 'own-bank-token' }));
    assert.equal(url.searchParams.get('orderNo'), state.site);
    for (const mapping of [false, true]) {
      state.mapping = mapping; state.calls = [];
      url = resultUrl(await request('/return?orderNo=ECL-RETURN-B', { OrderNo: state.provider, PayToken: 'own-bank-token' }));
      assert.equal(url.searchParams.has('resultToken'), false);
      assertNoLocalEffects(state);
    }
  });
});

test('matching paid return still confirms payment, and code plus phone guest lookup still refreshes', async () => {
  await fixture(async ({ state, request }) => {
    state.transactionStatus = 'S'; state.payStatus = '1C300';
    const url = resultUrl(await request(`/return?orderNo=${state.site}&payToken=own-bank-token`));
    assert.equal(url.searchParams.get('result'), 'paid');
    assert.equal(server.verifyPaymentResultAccessToken(url.searchParams.get('resultToken'), state.site), true);
    assert.equal(state.calls.some(call => call.url.pathname === '/rest/v1/orders' && call.method === 'PATCH'), true);
    let response = await request('/api/orders/guest-lookup', { lookupCode: 'ABCDE12345', phone: '+886912345678' });
    const lookup = await response.json();
    assert.equal(response.status, 200);
    assert.equal(server.verifyGuestAccessToken(lookup.guestAccessToken, state.site), true);
    response = await request('/api/orders/guest-details', { orderNo: state.site, guestAccessToken: lookup.guestAccessToken });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).order.id, state.site);
  });
});

test('public callback cannot turn request success flags into bank payment evidence', async () => {
  await fixture(async ({ state, request }) => {
    for (const body of [
      { OrderNo: state.site, PayFlag: 'Y', PayStatus: 'SUCCESS' },
      { data: { orderNo: state.site, payFlag: 'S', payStatus: '1C300' } },
      { payload: { OrderNo: state.site, PayFlag: 'Y' } },
    ]) {
      state.calls = [];
      await request('/api/sinopac/notify', body);
      assert.equal(state.calls.some(call => call.url.host === 'site.example.test'), false);
      assert.equal(state.calls.some(call => call.url.pathname === '/rest/v1/orders'
        && call.method === 'PATCH' && JSON.parse(call.body).status === 'paid'), false);
      assert.equal(state.calls.some(call => call.url.pathname.endsWith('/record_verified_reward_wallet_payment')), false);
    }
  });
});

test('paid callbacks require matching bank order, successful API, merchant, currency and cents amount', async () => {
  await fixture(async ({ state, request }) => {
    state.payStatus = '1A300';
    for (const change of [
      { orderIdentity: 'ECL-OTHER' }, { orderIdentity: '' }, { orderApiStatus: 'F' },
      { bankShop: 'OTHER-SHOP' }, { currency: 'USD' }, { bankAmount: 1000 },
      { bankAmount: null }, { bankAmount: 99999 },
    ]) {
      const previous = { ...state };
      Object.assign(state, change, { calls: [] });
      await request('/api/sinopac/notify', { OrderNo: state.site });
      assert.equal(state.calls.some(call => call.url.host === 'site.example.test'), false);
      assert.equal(state.calls.some(call => call.url.pathname === '/rest/v1/orders' && call.method === 'PATCH'), false);
      assert.equal(state.calls.some(call => call.url.pathname.endsWith('/record_verified_reward_wallet_payment')), false);
      Object.assign(state, previous);
    }
  });
});

test('callback rejects another order hint with a valid token before paid side effects', async () => {
  await fixture(async ({ state, request }) => {
    state.transactionStatus = 'S';
    await request('/api/sinopac/notify', { OrderNo: 'ECL-RETURN-B', PayToken: 'own-bank-token' });
    assertNoLocalEffects(state);
  });
});

test('ATM and card/mobile verified callback payment remains supported, including retry mapping', async () => {
  await fixture(async ({ state, request }) => {
    for (const token of [false, true]) {
      state.calls = []; state.payStatus = token ? 'N' : '1A300';
      state.transactionStatus = token ? 'S' : 'F';
      state.provider = token ? `${state.site}-R2` : state.site;
      const response = await request('/api/sinopac/notify', {
        OrderNo: state.site, ...(token ? { PayToken: 'own-bank-token' } : {}),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).updated, 'paid');
      assert.equal(state.calls.some(call => call.url.host === 'site.example.test'), true);
      assert.equal(state.calls.some(call => call.url.pathname === '/rest/v1/orders'
        && call.method === 'PATCH' && JSON.parse(call.body).status === 'paid'), true);
    }
  });
});

test('late pending callback preserves manually confirmed paid or fulfilled orders', async () => {
  await fixture(async ({ state, request }) => {
    for (const status of ['paid', 'preparing', 'shipped', 'delivered', 'cancelled']) {
      state.orderStatus = status; state.calls = [];
      const response = await request('/api/sinopac/notify', { OrderNo: state.site, PayStatus: 'N' });
      assert.equal(response.status, 200);
      assert.equal(state.calls.some(call => call.url.pathname === '/rest/v1/orders' && call.method === 'PATCH'), false);
      assert.equal(state.calls.some(call => call.url.host === 'site.example.test'), false);
    }
  });
});

test('bank verification uses net tender after wallet credit, not gross order total', async () => {
  await fixture(async ({ state, request }) => {
    state.payStatus = '1A300'; state.paymentAmount = 600; state.bankAmount = 60000;
    let response = await request('/api/sinopac/notify', { OrderNo: state.site });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).updated, 'paid');
    state.calls = []; state.bankAmount = 100000;
    response = await request('/api/sinopac/notify', { OrderNo: state.site });
    assert.equal(response.status, 503);
    assert.equal(state.calls.some(call => call.url.host === 'site.example.test'), false);
    assert.equal(state.calls.some(call => call.url.pathname === '/rest/v1/orders' && call.method === 'PATCH'), false);
  });
});

test('authorized result polling accepts verified pending/paid bank states and rejects wrong payment amounts', async () => {
  await fixture(async ({ state, request }) => {
    const access = { orderNo: state.site, resultAccessToken: server.createPaymentResultAccessToken(state.site) };
    let response = await request('/api/sinopac/query-payment', access);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).paymentState, 'pending');
    state.payStatus = '1C300';
    response = await request('/api/sinopac/query-payment', access);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).paymentState, 'paid');
    state.bankAmount = 1; state.calls = [];
    response = await request('/api/sinopac/query-payment', access);
    assert.equal(response.status, 400);
    assert.equal(state.calls.some(call => call.url.pathname.endsWith('/record_verified_reward_wallet_payment')), false);
  });
});
