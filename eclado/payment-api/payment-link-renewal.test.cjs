const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

Object.assign(process.env, {
  SUPABASE_URL:'https://supabase.example.test', SUPABASE_SERVICE_ROLE_KEY:'fake-service-key',
  SINOPAC_API_BASE_URL:'https://bank.example.test/api', SINOPAC_X_KEY:'fake-key', SINOPAC_SHOP_NO:'FAKE',
  SINOPAC_A1:'65960834240E44B7', SINOPAC_A2:'2831076A098E49E7',
  SINOPAC_B1:'CB1AFFBF915A492B', SINOPAC_B2:'7F242C0AA612454F',
  GUEST_LOOKUP_SECRET:'fake-guest-secret', PAYMENT_NOTIFY_SECRET:'fake-notify-secret',
});
const server = require('./server.js');

test('payment creation and renewal use only simulated bank/DB responses', async t => {
  const originalFetch = global.fetch;
  const listener = http.createServer(server.app);
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  let order, instruction, authorization, attempts, bankStatus, createMode, queries, creates, rotations, releases;
  const bankRequests = [];
  const reset = (method = 'apple') => {
    order = {
      id:'ECL-RENEWAL', user_id:null, status:'unpaid', total:1000, payment_amount:900,
      shopping_credit_amount:100, reward_credit_amount:0, order_source:'online',
      items:[{name:"O'Reilly 10% " + '品'.repeat(61), qty:1}], note:'請於出貨前聯繫收件人'.repeat(8),
      payment_due_at:new Date(Date.now() + 48 * 3600000).toISOString(),
    };
    instruction = {order_id:order.id, provider_order_no:order.id, attempt_no:1,
      payment_method:method, payment_state:'pending', payment_due_at:order.payment_due_at,
      gateway_created_at:new Date(Date.now() - 11 * 60000).toISOString(),
      link_expires_at:new Date(Date.now() - 60000).toISOString(), payment_url:'https://bank.example.test/old'};
    authorization = {provider_order_no:order.id, token:'fake-token', claimed:false, created:true};
    attempts = [];
    bankStatus = method === 'card' ? '1C250' : '1M250';
    createMode = 'success';
    queries = creates = rotations = releases = 0;
    bankRequests.length = 0;
  };
  const signed = (result, nonce) => Response.json({
    Nonce:nonce, Message:server.encryptMessage(server.getAesKey(), JSON.stringify(result), nonce),
    Sign:server.generateSign(result, server.getAesKey(), nonce),
  });
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    const body = options.body ? JSON.parse(options.body) : {};
    if (target.endsWith('/rpc/consume_service_rate_limit')) return Response.json(true);
    if (target.endsWith('/rpc/authorize_order_payment_access')) return Response.json(body.p_payment_token === authorization.token);
    if (target.includes('/rest/v1/orders?')) {
      if (options.method === 'PATCH') { Object.assign(order, body); return Response.json([order]); }
      return Response.json([order]);
    }
    if (target.includes('/rest/v1/order_payment_instructions?')) {
      if (options.method === 'POST') { instruction = {...body}; return Response.json([instruction]); }
      if (options.method === 'PATCH') {
        const provider = new URL(target).searchParams.get('provider_order_no');
        if (!provider || provider === 'eq.' + instruction.provider_order_no) Object.assign(instruction, body);
        return Response.json([instruction]);
      }
      return Response.json(instruction ? [instruction] : []);
    }
    if (target.includes('/rest/v1/order_payment_attempts?')) {
      attempts.push(body);
      return Response.json([]);
    }
    if (target.endsWith('/rpc/claim_order_payment')) {
      if (authorization.claimed || authorization.created || body.p_payment_token !== authorization.token) return Response.json({}, {status:409});
      authorization.claimed = true;
      return Response.json({...order, provider_order_no:authorization.provider_order_no, attempt_no:rotations + 1});
    }
    if (target.endsWith('/rpc/complete_order_payment_claim')) {
      if (body.p_success) authorization.created = true;
      else releases++;
      authorization.claimed = false;
      return Response.json(true);
    }
    if (target.endsWith('/rpc/begin_verified_order_payment_retry')) {
      assert.equal(body.p_bank_pay_status, bankStatus === 'absent' ? 'NOT_CREATED' : bankStatus);
      if (body.p_provider_order_no !== authorization.provider_order_no) return Response.json({}, {status:409});
      rotations++;
      authorization = {provider_order_no:order.id + '-R' + (rotations + 1), token:'fake-new-token', claimed:false, created:false};
      instruction = {...instruction, provider_order_no:authorization.provider_order_no, payment_state:'initiated', attempt_no:rotations + 1};
      return Response.json({provider_order_no:authorization.provider_order_no, payment_token:authorization.token, attempt_no:rotations + 1});
    }
    if (target.endsWith('/rpc/record_verified_reward_wallet_payment')) return Response.json({applicable:false});
    if (target.endsWith('/rpc/record_reward_credit_payment_failure')) return Response.json({applicable:false});
    if (target === 'https://ecladotaiwan.com/api/sinopac/notify') return Response.json({ok:true});
    if (target.includes('/rest/v1/order_payment_diagnostics')) return Response.json([]);
    if (target === 'https://bank.example.test/api/Nonce') return Response.json({Nonce:'1234567890ABCDEF'});
    if (target === 'https://bank.example.test/api/Order') {
      const inner = JSON.parse(server.decryptMessage(server.getAesKey(), body.Message, body.Nonce));
      bankRequests.push({service:body.APIService, inner});
      if (body.APIService === 'OrderQuery') {
        queries++;
        if (bankStatus === 'timeout') throw new DOMException('Simulated timeout', 'TimeoutError');
        if (bankStatus === 'absent') return signed({Status:'S',Description:'S0001',OrderList:[]}, body.Nonce);
        return signed({Status:'S', ShopNo:'FAKE', OrderList:[{OrderNo:inner.OrderNo, PayStatus:bankStatus,
          Amount:90000, CurrencyID:'TWD', PayType:instruction.payment_method === 'card' ? 'C' : 'M'}]}, body.Nonce);
      }
      assert.equal(body.APIService, 'OrderCreate');
      creates++;
      if (createMode === 'timeout') throw new DOMException('Simulated timeout', 'TimeoutError');
      if (createMode === 'empty') return signed({}, body.Nonce);
      if (createMode === 'processing') return signed({Status:'F',Description:'E0304'}, body.Nonce);
      if (createMode === 'duplicate') return signed({Status:'F',Description:'E0302'}, body.Nonce);
      if (createMode === 'rejected') return signed({Status:'F',Description:'E0602'}, body.Nonce);
      const result = {Status:'S', ShopNo:'FAKE', OrderNo:inner.OrderNo, Amount:inner.Amount, PayType:inner.PayType, TSNo:'FAKE-TS',
        MobileParam:{MobilePayURL:'https://bank.example.test/new'}, CardParam:{CardPayURL:'https://bank.example.test/new'},
        ATMParam:{AtmPayNo:'99922511001200',WebAtmURL:'https://bank.example.test/atm'}};
      if (createMode === 'missing-url') delete result.MobileParam;
      return signed(result, body.Nonce);
    }
    throw new Error('Unexpected upstream request blocked: ' + new URL(target).pathname);
  };
  const request = async (path, extra = {}) => {
    const response = await originalFetch(`http://127.0.0.1:${listener.address().port}/api/sinopac/${path}`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
        orderNo:order.id, paymentToken:'fake-token', ...extra,
      }),
    });
    return response.json();
  };
  try {
    await t.test('long product details and note stay on the order; safe bank title and no Memo', async () => {
      reset();
      instruction = null;
      authorization.created = false;
      const snapshot = JSON.stringify(order);
      const result = await request('create-payment', {payType:'M', choosePay:'A', memo:order.note, prdtName:order.items[0].name});
      assert.equal(result.ok, true);
      assert.equal(creates, 1);
      assert.equal(bankRequests[0].inner.PrdtName, 'ECLADO訂單');
      assert.equal(Object.hasOwn(bankRequests[0].inner, 'Memo'), false);
      assert.equal(bankRequests[0].inner.Amount, 90000);
      assert.equal(JSON.stringify(order), snapshot);
      assert.equal(instruction.payment_due_at, order.payment_due_at);
      assert.ok(Date.parse(instruction.link_expires_at) < Date.parse(order.payment_due_at));
    });
    await t.test('expired mobile link is queried before rotating the same order', async () => {
      reset();
      const snapshot = JSON.stringify(order);
      const result = await request('retry-payment');
      assert.equal(result.ok, true);
      assert.deepEqual(bankRequests.map(row => row.service), ['OrderQuery','OrderCreate']);
      assert.equal(rotations, 1);
      assert.equal(creates, 1);
      assert.equal(JSON.stringify(order), snapshot);
      assert.equal(instruction.provider_order_no, 'ECL-RENEWAL-R2');
      assert.equal(instruction.payment_state, 'pending');
      assert.equal(bankRequests[1].inner.MobileParam.ChoosePay, 'A');
    });
    for (const method of ['google', 'card']) {
      await t.test('renewal preserves stored payment method for ' + method, async () => {
        reset(method);
        assert.equal((await request('retry-payment')).ok, true);
        assert.equal(bankRequests[1].inner.PayType, method === 'card' ? 'C' : 'M');
        if (method === 'google') assert.equal(bankRequests[1].inner.MobileParam.ChoosePay, 'G');
      });
    }
    await t.test('ATM instructions retain the order deadline without a ten-minute timer', async () => {
      reset('atm');
      authorization.created = false;
      instruction = null;
      const deadline = order.payment_due_at;
      const result = await request('create-payment', {payType:'A'});
      assert.equal(result.ok, true);
      assert.equal(result.linkExpiresAt, null);
      assert.equal(instruction.link_expires_at, null);
      assert.equal(instruction.payment_due_at, deadline);
    });
    await t.test('ATM limit uses the bank tender after shopping credit', async () => {
      reset('atm');
      authorization.created = false;
      instruction = null;
      order.total = 31000;
      order.shopping_credit_amount = 2000;
      order.payment_amount = 29000;
      assert.equal((await request('create-payment', {payType:'A'})).ok, true);
      assert.equal(bankRequests[0].inner.Amount, 2900000);
      assert.equal(order.shopping_credit_amount, 2000);
    });
    await t.test('new links never extend beyond the remaining order deadline', async () => {
      reset();
      authorization.created = false;
      instruction = null;
      order.payment_due_at = new Date(Date.now() + 330000).toISOString();
      assert.equal((await request('create-payment', {payType:'M',choosePay:'A'})).ok, true);
      assert.equal(bankRequests[0].inner.MobileParam.ExpMinutes, 5);
      assert.ok(Date.parse(instruction.link_expires_at) <= Date.parse(order.payment_due_at));
    });
    await t.test('local validation failure releases only the unsent request', async () => {
      reset();
      authorization.created = false;
      instruction = null;
      assert.equal((await request('create-payment', {payType:'M',qrCodeSize:349})).ok, false);
      assert.equal(creates, 0);
      assert.equal(authorization.claimed, false);
      assert.equal(releases, 1);
    });
    await t.test('verified absence allows renewal only after a definite bank rejection', async () => {
      reset();
      authorization.created = false;
      instruction = null;
      createMode = 'rejected';
      assert.equal((await request('create-payment', {payType:'M',choosePay:'A'})).ok, false);
      assert.equal(instruction.provider_status, 'F');
      bankStatus = 'absent';
      createMode = 'success';
      assert.equal((await request('retry-payment')).ok, true);
      assert.equal(rotations, 1);
    });
    for (const status of ['1M200', 'timeout', 'UNKNOWN']) {
      await t.test('does not renew when bank state is ' + status, async () => {
        reset();
        bankStatus = status;
        assert.equal((await request('retry-payment')).ok, false);
        assert.equal(queries, 1);
        assert.equal(rotations, 0);
        assert.equal(creates, 0);
      });
    }
    await t.test('paid bank transaction stops renewal', async () => {
      reset();
      bankStatus = '1M400';
      assert.equal((await request('retry-payment')).ok, false);
      assert.equal(rotations, 0);
      assert.equal(creates, 0);
      assert.equal(order.status, 'paid');
    });
    await t.test('simultaneous renewals rotate and create at most once', async () => {
      reset();
      const results = await Promise.all([request('retry-payment'), request('retry-payment')]);
      assert.equal(results.filter(result => result.ok).length, 1);
      assert.equal(rotations, 1);
      assert.equal(creates, 1);
    });
    for (const mode of ['timeout','empty','processing','duplicate','missing-url']) {
      await t.test('preserves unresolved creation for ' + mode, async () => {
        reset();
        authorization.created = false;
        instruction = null;
        createMode = mode;
        assert.equal((await request('create-payment', {payType:'M', choosePay:'A'})).ok, false);
        assert.equal(authorization.claimed, true);
        assert.equal(releases, 0);
        assert.equal(instruction.payment_state, 'initiated');
        // Reconcile the original reference after it has really expired.
        createMode = 'success';
        assert.equal((await request('retry-payment')).ok, true);
        assert.equal(rotations, 1);
      });
    }
    await t.test('48-hour expiry blocks renewal before any bank request', async () => {
      reset();
      order.payment_due_at = new Date(Date.now() - 1).toISOString();
      assert.equal((await request('retry-payment')).ok, false);
      assert.equal(queries, 0);
      assert.equal(creates, 0);
    });
  } finally {
    global.fetch = originalFetch;
    await new Promise(resolve => listener.close(resolve));
  }
});

test('bank contract boundaries reject invalid fields and validate successful responses', () => {
  const base = {orderNo:'ECL-BOUNDARY', amount:100, payType:'M', choosePay:'A'};
  for (const qrCodeSize of [350, 800]) assert.doesNotThrow(() => server.buildCreateBody({...base, qrCodeSize}));
  for (const expMinutes of [1, 30]) assert.doesNotThrow(() => server.buildCreateBody({...base, expMinutes}));
  for (const qrCodeSize of [349, 801, 350.5, NaN]) assert.throws(() => server.buildCreateBody({...base, qrCodeSize}));
  for (const expMinutes of [0, 31, 1.5, NaN]) assert.throws(() => server.buildCreateBody({...base, expMinutes}));
  for (const amount of [0, -1, 1.5, 10000000, Infinity]) assert.throws(() => server.buildCreateBody({...base, amount}));
  assert.throws(() => server.buildCreateBody({...base, amount:30001, payType:'A'}), /30,000/);
  assert.throws(() => server.buildCreateBody({...base, choosePay:'INVALID'}));
  assert.throws(() => server.buildCreateBody({...base, returnUrl:'https://example.test/' + 'x'.repeat(256)}));
  const inner = server.buildCreateBody(base);
  assert.throws(() => server.requireCreatedPayment({}, inner));
  const valid = {Status:'S', ShopNo:inner.ShopNo, OrderNo:inner.OrderNo, Amount:inner.Amount,
    PayType:'M', TSNo:'FAKE', MobileParam:{MobilePayURL:'https://bank.example.test/pay'}};
  assert.doesNotThrow(() => server.requireCreatedPayment(valid, inner));
  for (const patch of [{Amount:1}, {OrderNo:'OTHER'}, {ShopNo:'OTHER'}, {MobileParam:{}}, {Status:'F'},
    {MobileParam:{MobilePayURL:'https://'}}, {MobileParam:{MobilePayURL:['https://bank.example.test/pay']}}, {TSNo:'x'.repeat(21)}]) {
    assert.throws(() => server.requireCreatedPayment({...valid, ...patch}, inner));
  }
});
