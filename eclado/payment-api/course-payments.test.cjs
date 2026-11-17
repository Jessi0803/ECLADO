const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mountCoursePaymentRoutes } = require('./course-payments.cjs');

test('course routes use payer authorization, server prices and bank-captured evidence', async () => {
  const id = '10000000-0000-4000-8000-000000000001';
  const courseId = '10000000-0000-4000-8000-000000000002';
  const provider = 'CRS' + id.replaceAll('-', '');
  const routes = new Map();
  const calls = [];
  const input = [];
  let status = '1C300', amount = '240000', user = { id: 'payer' }, claimOwner = 'payer';
  let starts = 0, confirmations = 0;
  let selected = 'card', bankType = 'C';
  const gatewayLink = 'https://bank.example.test/pay';
  const app = {
    post: (path, callback) => routes.set('POST ' + path, callback),
    get: (path, callback) => routes.set('GET ' + path, callback),
  };
  mountCoursePaymentRoutes(app, {
    storefrontOrigin: "https://education.example.test",
    authenticate: async () => user,
    rateLimit: async () => true,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'claim_course_payment') {
        if (args.p_payer_id !== claimOwner) return null;
        return { summary: { total_twd: 2400, status: 'pending' }, provider_order_no: provider,
          create_attempt: args.p_create && !starts, minutes: 10, payment_method: args.p_method, link_expires_at: '2035-11-11T12:00:00Z' };
      }
      if (name === 'get_course_payment_target') return { course_id: courseId, total: 2400, payment_method: selected };
      if (name === 'confirm_course_payment') {
        confirmations++;
        assert.equal(args.p_provider_order_no, provider);
        assert.equal(args.p_transaction_no, 'T1234');
        return { status: 'paid' };
      }
    },
    formatSinopacDeadline: () => ({ expireDate: '20351111', expireTime: '2000' }),
    buildCreateBody: data => ({ OrderNo: data.orderNo, Amount: data.amount * 100, ReturnURL: data.returnUrl,
      PayType: data.payType, choosePay: data.choosePay, expireTime: data.expireTime }),
    callOrderApi: async (operation, body) => {
      assert.equal(operation, 'OrderCreate');
      starts++;
      input.push(body);
      return { data: { Status: 'S', CardParam: { CardPayURL: gatewayLink },
        ATMParam: { WebAtmURL: gatewayLink, AtmPayNo: '12345678901234' },
        MobileParam: { MobilePayURL: gatewayLink }, TSNo: 'T1234' } };
    },
    requireCreatedPayment: () => {},
    resolvePayment: async (body, options) => {
      if (options?.requirePayTokenOrder && !body.PayToken) throw new Error('Token missing');
      return { orderNo: provider, tsNo: 'T1234', payType: bankType, payStatus: status,
        raw: { orderQuery: { OrderList: [{ Amount: amount }] } } };
    },
    requirePaymentOrderHints: (sources, expected) => {
      assert.ok(sources.every(source => !source?.OrderNo || source.OrderNo === expected));
    },
    requireBankPaymentAmount: (payment, order) => {
      assert.equal(payment.raw.orderQuery.OrderList[0].Amount, String(order.total * 100));
    },
  });

  async function request(method, path, body = {}) {
    const response = { code: 200 };
    const res = {
      status(code) { response.code = code; return this; },
      json(data) { response.body = data; return this; },
      set() {},
      redirect(code, url) { response.code = code; response.url = url; },
    };
    await routes.get(method + ' ' + path)({ body, query: {} }, res);
    return response;
  }

  const start = '/api/courses/payment/start';
  const notify = '/api/courses/payment-notify';
  user = null;
  assert.equal((await request('POST', start, { orderId: id })).code, 401);
  user = { id: 'another-member' };
  assert.equal((await request('POST', start, { orderId: id })).code, 404);
  user = { id: claimOwner };
  assert.equal((await request('POST', start, { orderId: id, amount: 1, payType: 'A' })).body.paymentLink, 'https://bank.example.test/pay');
  assert.equal(input[0].Amount, 240000);
  assert.equal(input[0].PayType, 'C');
  assert.ok(input[0].BackendURL.endsWith(notify));
  assert.equal((await request('POST', start, { orderId: id })).code, 409);
  assert.equal(starts, 1);
  assert.equal((await request('POST', notify, { OrderNo: provider })).body.Status, 'S');
  assert.equal(confirmations, 0);
  status = '1C400';
  amount = '1';
  assert.equal((await request('POST', notify, { OrderNo: provider })).code, 503);
  assert.equal(confirmations, 0);
  amount = '240000';
  assert.equal((await request('POST', notify, { OrderNo: provider })).body.Status, 'S');
  assert.equal(confirmations, 1);
  assert.equal((await request('POST', '/courses/payment-return', { OrderNo: provider })).url, 'https://education.example.test/courses');
  assert.match((await request('POST', '/courses/payment-return', { PayToken: 'verified' })).url, new RegExp(courseId));
  for (const [method, type, mobileChoice] of [['atm','A',undefined],['apple','M','A'],['google','M','G']]) {
    selected = method;
    bankType = type;
    status = `1${type}400`;
    starts = 0;
    const result = await request('POST', start, { orderId: id, paymentMethod: method });
    assert.equal(result.body.paymentMethod, method);
    assert.equal(result.body.paymentLink, gatewayLink);
    assert.equal(input.at(-1).PayType, type);
    assert.equal(input.at(-1).choosePay, mobileChoice);
    if (method === 'atm') {
      assert.equal(result.body.atmAccount, '12345678901234');
      assert.equal(input.at(-1).expireTime, '2000');
      assert.equal(calls.at(-1)[1].p_atm_account, result.body.atmAccount);
    }
    const before = confirmations;
    assert.equal((await request('POST', notify, { OrderNo: provider })).body.Status, 'S');
    assert.equal(confirmations, before + 1);
    bankType = 'C';
    assert.equal((await request('POST', notify, { OrderNo: provider })).code, 503);
    assert.equal(confirmations, before + 1);
  }
  assert.ok(calls.every(([name]) => name.includes('course')));
});
