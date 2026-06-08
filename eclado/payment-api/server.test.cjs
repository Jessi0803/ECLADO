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

const server = require('./server.js');

test('exports pure helpers without starting the server', () => {
  for (const fn of ['getAesKey', 'encryptMessage', 'decryptMessage', 'isPaidLike', 'buildCreateBody', 'signableString', 'generateSign']) {
    assert.equal(typeof server[fn], 'function', `應匯出 ${fn}`);
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

test('getSinopacPaymentError: 失敗回傳描述，成功回空字串', () => {
  assert.equal(server.getSinopacPaymentError({ Status: 'S' }), '');
  assert.match(server.getSinopacPaymentError({ Status: 'F', Description: '卡片遭拒' }), /卡片遭拒/);
});
