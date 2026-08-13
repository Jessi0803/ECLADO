const test = require('node:test');
const assert = require('node:assert/strict');
const sinopacNotifyHandler = require('../../api/sinopac/notify.js');

const SUPABASE_URL = 'https://ilvdvlkdpntwmaijncaz.supabase.co';
const PAYMENT_NOTIFY_SECRET = 'test-payment-notify-secret';
process.env.PAYMENT_NOTIFY_SECRET = PAYMENT_NOTIFY_SECRET;
const { __test } = sinopacNotifyHandler;

function sinopacNotify(req, res) {
  return sinopacNotifyHandler({
    ...req,
    headers: {
      ...(req.headers || {}),
      'x-eclado-payment-secret': PAYMENT_NOTIFY_SECRET,
    },
  }, res);
}

// 豐收款 sandbox 範例雜湊值（AppSettings.config），A1,A2,B1,B2 排序
const HASH_KEYS = '65960834240E44B7,2831076A098E49E7,CB1AFFBF915A492B,7F242C0AA612454F';

test('__test helpers are exported', () => {
  assert.ok(__test, 'notify.js 應匯出 __test 供測試使用');
  for (const fn of ['getAesKey', 'encryptQpayMessage', 'decryptQpayMessage', 'generateQpaySign', 'isFailedPayment', 'getAmount', 'amountsMatch']) {
    assert.equal(typeof __test[fn], 'function', `__test.${fn} 應為函式`);
  }
});

test('AES key derives to 32 bytes and AES-256 round-trips (regression: aes-128 would throw)', () => {
  const prev = process.env.SINOPAC_QPAY_HASH_KEYS;
  process.env.SINOPAC_QPAY_HASH_KEYS = HASH_KEYS;
  try {
    const aesKey = __test.getAesKey();
    // 4 把 8-byte 雜湊 XOR 後串成 16 bytes → hex 32 字元；當 ASCII 餵入即 32 bytes = AES-256
    assert.equal(aesKey.length, 32, 'AES key 應為 32 字元 hex 字串');
    assert.equal(Buffer.from(aesKey, 'ascii').length, 32, '當作金鑰使用時應為 32 bytes（AES-256）');

    const nonce = 'nonce-abc-123456';
    const plain = JSON.stringify({ ShopNo: 'NA0636_001', PayToken: 'PT-RT-001' });
    const cipher = __test.encryptQpayMessage(aesKey, nonce, plain);
    assert.match(cipher, /^[0-9A-F]+$/, '密文應為大寫 hex');
    assert.equal(__test.decryptQpayMessage(aesKey, nonce, cipher), plain, '解密應還原原文');
  } finally {
    if (prev === undefined) delete process.env.SINOPAC_QPAY_HASH_KEYS;
    else process.env.SINOPAC_QPAY_HASH_KEYS = prev;
  }
});

test('signString sorts case-insensitively and drops empty/object values', () => {
  const s = __test.signString({ b: '2', A: '1', blank: '', nested: { x: 1 }, n: null });
  assert.equal(s, 'A=1&b=2');
});

test('isFailedPayment treats explicit failure values as failed, success as not', () => {
  assert.equal(__test.isFailedPayment({ Status: 'S' }), false);
  assert.equal(__test.isFailedPayment({ Status: 'F' }), true);
  assert.equal(__test.isFailedPayment({ Result: 'CANCEL' }), true);
  assert.equal(__test.isFailedPayment({}), false);
});

test('getAmount / amountsMatch handle dollar and cent amounts', () => {
  assert.equal(__test.getAmount({ Amount: '500' }), 500);
  assert.equal(__test.getAmount({}), null);
  assert.equal(__test.amountsMatch(5, 500), true); // 豐收款金額含小數二位
  assert.equal(__test.amountsMatch(500, 500), true);
  assert.equal(__test.amountsMatch(5, null), true); // 通知未帶金額視為符合
  assert.equal(__test.amountsMatch(5, 999), false);
});

test('real BackendURL {ShopNo, PayToken} resolves order via OrderPayQuery (AES-256) and marks paid', async () => {
  const originalFetch = global.fetch;
  const saved = {
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SINOPAC_QPAY_HASH_KEYS: process.env.SINOPAC_QPAY_HASH_KEYS,
    SINOPAC_QPAY_X_KEY_ID: process.env.SINOPAC_QPAY_X_KEY_ID,
    SINOPAC_QPAY_API_BASE: process.env.SINOPAC_QPAY_API_BASE,
    SINOPAC_SHOP_NO: process.env.SINOPAC_SHOP_NO,
    SINOPAC_PAYMENT_QUERY_URL: process.env.SINOPAC_PAYMENT_QUERY_URL,
    LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };

  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SINOPAC_QPAY_HASH_KEYS = HASH_KEYS;
  process.env.SINOPAC_QPAY_X_KEY_ID = 'test-xkey';
  process.env.SINOPAC_QPAY_API_BASE = 'https://qpay.test/api/';
  process.env.SINOPAC_SHOP_NO = 'NA0636_001';
  delete process.env.SINOPAC_PAYMENT_QUERY_URL; // 強制走 direct（真實加解密）
  delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
  delete process.env.RESEND_API_KEY;

  const aesKey = __test.getAesKey();
  const respNonce = 'RESP-NONCE-7654321';
  // 模擬 OrderPayQuery 解密後的 QryOrderPay 內容（信用卡付款成功）
  const decoded = {
    ShopNo: 'NA0636_001',
    PayToken: 'PT-CARD-REAL',
    Status: 'S',
    Description: '',
    TSResultContent: {
      APType: 'PayOut',
      TSNo: 'NA063600000099',
      OrderNo: 'CARD-REAL-001',
      ShopNo: 'NA0636_001',
      PayType: 'C',
      Amount: '500', // 含小數二位 → 實際 5 元
      Status: 'S',
      Param1: 'CARD-REAL-001',
      PayDate: '202606081346',
    },
  };
  const encryptedMessage = __test.encryptQpayMessage(aesKey, respNonce, JSON.stringify(decoded));
  const responseSign = __test.generateQpaySign(decoded, aesKey, respNonce);

  let patched = false;
  global.fetch = async (url, options = {}) => {
    const u = String(url);

    if (u === 'https://qpay.test/api/Nonce') {
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['X-KeyID'], 'test-xkey');
      return jsonResponse(200, { Nonce: 'REQ-NONCE-0001' });
    }

    if (u === 'https://qpay.test/api/Order') {
      assert.equal(options.method, 'POST');
      return jsonResponse(200, { Message: encryptedMessage, Nonce: respNonce, Sign: responseSign });
    }

    if (u.startsWith(`${SUPABASE_URL}/rest/v1/orders?id=eq.CARD-REAL-001&select=`)) {
      assert.equal(options.method, 'GET');
      return jsonResponse(200, [{ id: 'CARD-REAL-001', status: 'unpaid', total: 5, user_id: null, member: '信用卡實測', email: '' }]);
    }

    if (u === `${SUPABASE_URL}/rest/v1/orders?id=eq.CARD-REAL-001`) {
      assert.equal(options.method, 'PATCH');
      assert.deepEqual(JSON.parse(options.body), { status: 'paid' });
      patched = true;
      return jsonResponse(200, [{ id: 'CARD-REAL-001', status: 'paid', total: 5, user_id: null, member: '信用卡實測', email: '' }]);
    }

    throw new Error(`Unexpected fetch: ${options.method} ${u}`);
  };

  const res = createRes();
  try {
    await sinopacNotify({ method: 'POST', body: { ShopNo: 'NA0636_001', PayToken: 'PT-CARD-REAL' } }, res);
  } finally {
    global.fetch = originalFetch;
    restoreEnv(saved);
  }

  assert.equal(res.statusCode, 200);
  assert.equal(res.jsonBody.ok, true);
  assert.equal(res.jsonBody.orderId, 'CARD-REAL-001', '應從 OrderPayQuery 的 OrderNo 解析出訂單');
  assert.equal(res.jsonBody.status, 'paid');
  assert.equal(patched, true, '訂單應被 PATCH 為 paid');
});

function createRes() {
  return {
    statusCode: 200,
    jsonBody: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.jsonBody = body; return this; },
    end() { return this; },
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(body); },
  };
}

function restoreEnv(saved) {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
