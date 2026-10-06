const assert = require('node:assert/strict');
const test = require('node:test');

const handler = require('../../api/professional-quarterly-notices.js');

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
