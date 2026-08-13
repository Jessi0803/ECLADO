const test = require('node:test');
const assert = require('node:assert/strict');

// 在 require server.js 前先備妥金鑰環境（豐收款 sandbox 範例值），
// getAesKey / buildCreateBody 於呼叫時才讀取，設定於此即可。
process.env.SINOPAC_A1 = process.env.SINOPAC_A1 || '65960834240E44B7';
process.env.SINOPAC_A2 = process.env.SINOPAC_A2 || '2831076A098E49E7';
process.env.SINOPAC_B1 = process.env.SINOPAC_B1 || 'CB1AFFBF915A492B';
process.env.SINOPAC_B2 = process.env.SINOPAC_B2 || '7F242C0AA612454F';
process.env.SINOPAC_SHOP_NO = process.env.SINOPAC_SHOP_NO || 'NA0636_001';
process.env.PAYMENT_PUBLIC_URL = process.env.PAYMENT_PUBLIC_URL || 'https://pay.ecladotaiwan.com';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://supabase.example.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
process.env.ORDER_CLEANUP_KEY = process.env.ORDER_CLEANUP_KEY || 'test-cleanup-key';
process.env.PAYMENT_NOTIFY_SECRET = process.env.PAYMENT_NOTIFY_SECRET || 'test-payment-notify-secret';

const server = require('./server.js');

test('exports pure helpers without starting the server', () => {
  for (const fn of ['getAesKey', 'encryptMessage', 'decryptMessage', 'isPaidLike', 'buildCreateBody', 'signableString', 'generateSign']) {
    assert.equal(typeof server[fn], 'function', `應匯出 ${fn}`);
  }
});

test('ORDER_CLEANUP_KEY 必須設定，且清理金鑰需完全一致', () => {
  const originalKey = process.env.ORDER_CLEANUP_KEY;
  delete process.env.ORDER_CLEANUP_KEY;
  assert.throws(() => server.validateRequiredRuntimeEnv(), /Missing env: ORDER_CLEANUP_KEY/);
  assert.equal(server.hasValidCleanupKey('test-cleanup-key'), false);

  process.env.ORDER_CLEANUP_KEY = originalKey;
  assert.doesNotThrow(() => server.validateRequiredRuntimeEnv());
  assert.equal(server.hasValidCleanupKey(originalKey), true);
  assert.equal(server.hasValidCleanupKey(`${originalKey}-wrong`), false);
  assert.equal(server.hasValidCleanupKey(''), false);
});

test('PAYMENT_NOTIFY_SECRET 必須設定', () => {
  const originalSecret = process.env.PAYMENT_NOTIFY_SECRET;
  delete process.env.PAYMENT_NOTIFY_SECRET;
  assert.throws(() => server.validateRequiredRuntimeEnv(), /Missing env: PAYMENT_NOTIFY_SECRET/);

  process.env.PAYMENT_NOTIFY_SECRET = originalSecret;
  assert.doesNotThrow(() => server.validateRequiredRuntimeEnv());
});

test('付款通知轉發會帶共用密鑰，且檢查 Vercel 回應', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(String(url), 'https://ecladotaiwan.com/api/sinopac/notify');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['X-ECLADO-Payment-Secret'], process.env.PAYMENT_NOTIFY_SECRET);
    assert.deepEqual(JSON.parse(options.body), { OrderNo: 'ECL-NOTIFY-001', Status: 'S' });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  try {
    assert.deepEqual(await server.forwardPaidNotification('ECL-NOTIFY-001'), { sent: true });
  } finally {
    global.fetch = originalFetch;
  }
});

test('Vercel 拒絕付款通知時，Vultr 會留下明確失敗結果', async () => {
  const originalFetch = global.fetch;
  const originalError = console.error;
  const errors = [];
  global.fetch = async () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  console.error = (...args) => errors.push(args.join(' '));

  try {
    const result = await server.forwardPaidNotification('ECL-NOTIFY-002');
    assert.equal(result.sent, false);
    assert.match(result.reason, /Vercel notify HTTP 401/);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /notify forward.*401/);
  } finally {
    global.fetch = originalFetch;
    console.error = originalError;
  }
});

test('isPaidLike: 授權/請款/付款完成算已付款；待付款/逾期不算', () => {
  // 已付款（規格書 §10.2）
  assert.equal(server.isPaidLike('1C300'), true, '1C300 已授權未請款');
  assert.equal(server.isPaidLike('1C400'), true, '1C400 請款完成');
  assert.equal(server.isPaidLike('1A400'), true, '1A400 ATM付款完成');
  assert.equal(server.isPaidLike('1M400'), true, '1M400 行動支付付款完成');
  assert.equal(server.isPaidLike('S'), true);
  assert.equal(server.isPaidLike('Y'), true);
  // 不算已付款
  assert.equal(server.isPaidLike('1C200'), false, '1C200 待付款不算');
  assert.equal(server.isPaidLike('1C250'), false, '1C250 刷卡逾期不算');
  assert.equal(server.isPaidLike('1C350'), false, '1C350 授權失效不算');
  assert.equal(server.isPaidLike(''), false);
  assert.equal(server.isPaidLike(undefined), false);
});

test('isPendingLike: 待付款類', () => {
  assert.equal(server.isPendingLike('N'), true);
  assert.equal(server.isPendingLike('PENDING'), true);
  assert.equal(server.isPendingLike('1C400'), false);
});

test('AES key 為 32 bytes（AES-256），加解密可往返', () => {
  const aesKey = server.getAesKey();
  assert.equal(aesKey.length, 32, 'AES key 應為 32 字元 hex');
  assert.equal(Buffer.from(aesKey, 'ascii').length, 32, '當金鑰使用應為 32 bytes（AES-256）');

  const nonce = 'nonce-server-123';
  const plain = JSON.stringify({ ShopNo: 'NA0636_001', PayToken: 'PT-S-001' });
  const cipher = server.encryptMessage(aesKey, plain, nonce);
  assert.equal(server.decryptMessage(aesKey, cipher, nonce), plain);
});

test('signableString 排序（不分大小寫）並排除空值/物件', () => {
  assert.equal(server.signableString({ b: '2', A: '1', blank: '', nested: {}, n: null }), 'A=1&b=2');
});

test('generateSign 對相同輸入穩定、對不同 nonce 改變', () => {
  const aesKey = server.getAesKey();
  const obj = { ShopNo: 'NA0636_001', PayToken: 'PT-X' };
  const s1 = server.generateSign(obj, aesKey, 'nonceA');
  const s2 = server.generateSign(obj, aesKey, 'nonceA');
  const s3 = server.generateSign(obj, aesKey, 'nonceB');
  assert.equal(s1, s2);
  assert.notEqual(s1, s3);
  assert.match(s1, /^[0-9A-F]+$/);
});

test('buildCreateBody: 信用卡 AutoBilling=Y，且 BackendURL 強制指向本服務', () => {
  const body = server.buildCreateBody({
    orderNo: 'ECL-UNIT-001',
    amount: 100,
    payType: 'C',
    prdtName: '單元測試',
    backendUrl: 'https://www.ecladotaiwan.com/api/sinopac/notify', // 應被忽略
    returnUrl: 'https://pay.ecladotaiwan.com/return',
  });
  assert.equal(body.PayType, 'C');
  assert.equal(body.Amount, 10000, '金額需 ×100（含小數二位）');
  assert.deepEqual(body.CardParam, { AutoBilling: 'Y' });
  assert.equal(body.BackendURL, 'https://pay.ecladotaiwan.com/api/sinopac/notify', 'BackendURL 應強制走本服務，忽略傳入值');
});

test('buildCreateBody: ATM 帶 ATMParam；金額為 0 應拋錯', () => {
  const atm = server.buildCreateBody({ orderNo: 'ECL-UNIT-002', amount: 50, payType: 'A', expireDate: '20260701', expireTime: '1200' });
  assert.equal(atm.PayType, 'A');
  assert.ok(atm.ATMParam, '應帶 ATMParam');
  assert.throws(() => server.buildCreateBody({ orderNo: 'X', amount: 0, payType: 'A' }), /amount/);
});

test('buildAuthoritativeCreateBody: 忽略呼叫端 amount，使用資料庫訂單 total', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.match(String(url), /rpc\/claim_order_payment$/);
    assert.equal(options.headers.apikey, process.env.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal(options.headers.Authorization, `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`);
    assert.deepEqual(JSON.parse(options.body), {
      p_order_id: 'ECL-AUTH-001',
      p_payment_token: 'payment-token-test',
    });
    return new Response(JSON.stringify({
      id: 'ECL-AUTH-001',
      total: 3980,
      status: 'unpaid',
      items: [{ name: '胜肽修護精華液', qty: 1 }],
      payment_due_at: '2026-07-31T07:30:00.000Z',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const body = await server.buildAuthoritativeCreateBody({
      orderNo: 'ECL-AUTH-001',
      paymentToken: 'payment-token-test',
      amount: 1,
      payType: 'A',
    });
    assert.equal(body.Amount, 398000);
    assert.equal(body.PrdtName, '胜肽修護精華液');
    assert.equal(body.ATMParam.ExpireDate, '20260731');
    assert.equal(body.ATMParam.ExpireTime, '1530');
  } finally {
    global.fetch = originalFetch;
  }
});

test('formatSinopacDeadline: 將權威截止時間轉為台灣日期與時間', () => {
  assert.deepEqual(server.formatSinopacDeadline('2026-07-31T15:59:00.000Z'), {
    expireDate: '20260731',
    expireTime: '2359',
  });
  assert.equal(server.formatSinopacDeadline('invalid'), null);
});

test('buildAuthoritativeCreateBody: 缺少 payment token 時拒絕建單', async () => {
  await assert.rejects(
    server.buildAuthoritativeCreateBody({ orderNo: 'ECL-NO-TOKEN', amount: 100, payType: 'A' }),
    /paymentToken is required/,
  );
});

test('getSinopacPaymentError: 失敗回傳描述，成功回空字串', () => {
  assert.equal(server.getSinopacPaymentError({ Status: 'S' }), '');
  assert.match(server.getSinopacPaymentError({ Status: 'F', Description: '卡片遭拒' }), /卡片遭拒/);
});

test('付款返回網址只包含訂單與結果，不洩漏任何 token', () => {
  const url = new URL(server.buildPaymentResultUrl('ECL-RETURN-001', 'paid'));
  assert.equal(url.pathname, '/payment-result');
  assert.equal(url.searchParams.get('orderNo'), 'ECL-RETURN-001');
  assert.equal(url.searchParams.get('result'), 'paid');
  assert.equal(url.searchParams.has('payToken'), false);
  assert.equal(url.searchParams.has('paymentToken'), false);
});
