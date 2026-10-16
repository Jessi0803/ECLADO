import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getOrderPaymentAmounts} from '../../src/domain/orderPaymentAmounts.js';
for (const [shopping,reward,payment] of [[0,0,1000],[300,0,700],[0,200,800],[300,200,500],[300,699,1]]) {
  test(`payment snapshot: shopping ${shopping}, reward ${reward}, bank ${payment}`, () => {
    assert.deepEqual(getOrderPaymentAmounts({total:1000,shopping_credit_amount:shopping,reward_credit_amount:reward,payment_amount:payment}),
      {total:1000,shoppingCreditAmount:shopping,rewardCreditAmount:reward,paymentAmount:payment});
  });
}
test('legacy order without wallet fields retains total fallback',()=>assert.equal(getOrderPaymentAmounts({total:1000}).paymentAmount,1000));
test('reject missing, negative, nonnumeric or inconsistent wallet snapshots',()=>{
  for(const order of [
    {total:1000,reward_credit_amount:200},
    {total:1000,reward_credit_amount:-1,payment_amount:1001},
    {total:1000,reward_credit_amount:'invalid',payment_amount:1000},
    {total:1000,shopping_credit_amount:300,reward_credit_amount:200,payment_amount:700},
    {total:1000,reward_credit_amount:1000,payment_amount:0},
  ]) assert.throws(()=>getOrderPaymentAmounts(order));
});
