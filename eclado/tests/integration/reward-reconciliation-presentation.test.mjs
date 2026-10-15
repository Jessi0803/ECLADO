import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reconciliationRules,reconciliationFields} from '../../src/admin/domain/rewardReconciliation.js';

test('every emitted reconciliation rule has a Chinese label and explanation',()=>{
 const sql=readFileSync(new URL('../../supabase-instructor-reward-reconciliation.sql',import.meta.url),'utf8');
 const rules=[...sql.matchAll(/select '([a-z_]+)'/g)].map(match=>match[1]);
 assert.equal(rules.length,19);
 for(const rule of rules){assert.ok(reconciliationRules[rule],rule);for(const text of reconciliationRules[rule])assert.match(text,/[\u4e00-\u9fff]/);}
});
test('presentation distinguishes money, event counts, absent data and statuses without changing findings',()=>{
 const values={balance:1100,pending:0,shopping_hold:0,withdrawal_hold:0};
 const original=JSON.stringify(values);const fields=reconciliationFields('account_ledger',values);
 assert.equal(fields[0].label,'帳戶餘額');assert.equal(fields[0].text,'NT$ 1,100');assert.equal(JSON.stringify(values),original);
 assert.equal(reconciliationFields('income_events',{pending:1})[0].text,'1');
 assert.equal(reconciliationFields('income_events',{pending:1})[0].label,'待入帳紀錄次數');
 assert.equal(reconciliationFields('account_projections',{pending:100})[0].text,'NT$ 100');
 assert.equal(reconciliationFields('account_ledger',{balance:-100})[0].text,'NT$ -100');
 assert.equal(reconciliationFields('account_ledger',{balance:null})[0].text,'缺少資料');
 assert.equal(reconciliationFields('income_lifecycle',{receipt:false})[0].text,'否');
 assert.equal(reconciliationFields('withdrawal_events',{status:'pending'})[0].text,'待匯款');
 assert.equal(reconciliationFields('income_events',{status:'pending'})[0].text,'待入帳');
 assert.equal(reconciliationFields('payment_unknown',{reason:'payment_after_release'})[0].text,'返饋金保留已釋放後收到付款成功');
 assert.equal(reconciliationFields('future_rule',{new_field:'new_value'})[0].text,'new_value');
});
