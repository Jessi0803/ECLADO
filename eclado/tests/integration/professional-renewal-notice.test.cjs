const assert = require('node:assert/strict');
const test = require('node:test');

function response(status, body) {
  return { ok:status >= 200 && status < 300, status, text:async () => JSON.stringify(body), json:async () => body };
}
function mockRes() {
  return { statusCode:200, body:null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('續約核准通知優先使用 LINE 並回寫發送狀態', async t => {
  const originalFetch = global.fetch;
  const env = { ...process.env };
  process.env.INTERNAL_API_KEY = 'internal';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'line';
  const patches = [];
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('professional_renewal_applications?') && options.method !== 'PATCH') return response(200, [{ id:'app-1', user_id:'member-1', renewal_year:2027, status:'approved', decision_reason:'符合資格' }]);
    if (target.includes('/profiles?')) return response(200, [{ name:'王小姐', email:'member@example.com', line_user_id:'U1' }]);
    if (target.includes('api.line.me')) return response(200, {});
    if (target.includes('professional_renewal_applications?') && options.method === 'PATCH') { patches.push(JSON.parse(options.body)); return response(200, [{}]); }
    throw new Error(`unexpected fetch ${target}`);
  };
  t.after(() => { global.fetch = originalFetch; process.env = env; });
  delete require.cache[require.resolve('../../api/professional-renewal-notice.js')];
  const handler = require('../../api/professional-renewal-notice.js');
  const res = mockRes();
  await handler({ method:'POST', headers:{ 'x-internal-api-key':'internal' }, body:{ applicationId:'app-1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.channel, 'line');
  assert.equal(patches[0].result_notification_channel, 'line');
});
