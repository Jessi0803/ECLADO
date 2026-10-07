const assert = require('node:assert/strict');
const test = require('node:test');

const handler = require('../../api/professional-quarterly-notices.js');

test('一月排程只準備及領取季度通知，不進行年度結算或降級', async () => {
  const OriginalDate = global.Date;
  const originalFetch = global.fetch;
  const originalSecret = process.env.CRON_SECRET;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const paths = [];
  try {
    global.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : ['2027-01-01T02:00:00Z'])); }
    };
    process.env.CRON_SECRET = 'mock-secret';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-key';
    global.fetch = async (url, options) => {
      paths.push({ path:new URL(url).pathname, body:JSON.parse(options.body) });
      return new Response(JSON.stringify(url.includes('claim_') ? [] : { prepared:1 }));
    };
    const res = { code:0, body:null, status(code) { this.code=code; return this; }, json(body) { this.body=body; } };
    await handler({method:'GET',headers:{authorization:'Bearer mock-secret'}},res);
    assert.equal(res.code,200);
    assert.equal(res.body.quarterStart,'2026-10-01');
    assert.deepEqual(paths,[
      {path:'/rest/v1/rpc/prepare_professional_quarterly_notices',body:{p_quarter_start:'2026-10-01'}},
      {path:'/rest/v1/rpc/claim_professional_quarterly_notices',body:{p_limit:100}},
    ]);
    assert.equal(res.body.finalization,undefined);
  } finally {
    global.Date=OriginalDate; global.fetch=originalFetch;
    if(originalSecret===undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET=originalSecret;
    if(originalKey===undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY=originalKey;
  }
});

test('任一季度內重跑都只準備上一個完整季度', () => {
  assert.equal(handler._private.quarterStartToPrepare({ year:2027, month:1, day:1 }), '2026-10-01');
  assert.equal(handler._private.quarterStartToPrepare({ year:2027, month:4, day:8 }), '2027-01-01');
  assert.equal(handler._private.quarterStartToPrepare({ year:2027, month:7, day:31 }), '2027-04-01');
  assert.equal(handler._private.quarterStartToPrepare({ year:2027, month:10, day:2 }), '2027-07-01');
});

test('季度通知清楚區分季度、年度與暫估學員數', () => {
  const result = handler._private.noticeText({ name:'王小姐' }, {
    snapshot:{ assessment_year:2026, annual_sales_amount:80000, annual_threshold:120000, annual_remaining_amount:40000, student_provisional_count:5, notice_quarter:{ calendar_quarter:3, sales_amount:25000, has_zero_sales:false } },
  });
  assert.match(result.subject, /第 3 季/);
  assert.match(result.text, /本季營業額：NT\$ 25,000/);
  assert.match(result.text, /本年度累計營業額：NT\$ 80,000/);
  assert.match(result.text, /品牌專班學員暫估：5 位/);
  assert.match(result.text, /年度結算與管理員審核/);
});
