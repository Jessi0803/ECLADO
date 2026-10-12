const {test}=require('node:test');const assert=require('node:assert/strict');
const {isPaidLike,resolvePaymentQueryState}=require('./server');
const {verifiedRewardPaymentEvidence:proof}=require('./reward-payment-evidence.cjs');
test('reward proof excludes webhook/body claims, paid_at and inferred stored paid state',()=>{
  assert.equal(resolvePaymentQueryState({status:'paid'},{OrderList:[{PayStatus:'N'}]}),'paid');
  for(const payment of [{paid:true},{paid_at:new Date().toISOString()},{raw:{body:{PayStatus:'1'}}},
    {paid:true,raw:{orderQuery:{OrderList:[{PayStatus:'N'}]}}}])assert.equal(proof(payment,'P1',isPaidLike),null);
});
test('only positive real bank query evidence bound to the registered provider reference qualifies',()=>{
  assert.equal(proof({raw:{orderQuery:{OrderList:[{OrderNo:'P1',PayStatus:'1C300'}]}}},'P1',isPaidLike),'order_query');
  assert.equal(proof({raw:{payQuery:{TSResultContent:{OrderNo:'P1',Status:'S',APType:'PayOut'}}}},'P1',isPaidLike),'pay_query');
  assert.equal(proof({raw:{orderQuery:{OrderList:[{OrderNo:'OTHER',PayStatus:'1'}]}}},'P1',isPaidLike),null);
  assert.equal(proof({raw:{payQuery:{TSResultContent:{Status:'F',APType:'CaptureOut'}}}},'P1',isPaidLike),null);
  assert.equal(proof({raw:{payQuery:{TSResultContent:{Status:'S',APType:'PayOut'}}}},'P1',isPaidLike),null);
});
test('reward failure requires explicit verified current query failure, never unknown/body/pending',()=>{
 const {verifiedRewardPaymentFailure:failed}=require('./reward-payment-evidence.cjs');
 assert.equal(failed({raw:{orderQuery:{OrderList:[{OrderNo:'P1',PayStatus:'F'}]}}},'P1'),true);
 for(const payment of [{raw:{body:{Status:'F'}}},{},{raw:{orderQuery:{OrderList:[{OrderNo:'P2',PayStatus:'F'}]}}},{raw:{orderQuery:{OrderList:[{OrderNo:'P1',PayStatus:'N'}]}}}])assert.equal(failed(payment,'P1'),false);
});

test('bank amount is extracted only from bound verified query; zero status stays pending',()=>{
 const {rewardBankAmount,verifiedRewardPaymentFailure}=require('./reward-payment-evidence.cjs');
 assert.equal(rewardBankAmount({raw:{orderQuery:{OrderList:[{OrderNo:'P1',Amount:'1,000'}]}}},'P1'),1000);
 assert.equal(rewardBankAmount({raw:{orderQuery:{OrderList:[{OrderNo:'OTHER',Amount:1000}]}}},'P1'),null);
 assert.equal(rewardBankAmount({raw:{body:{Amount:1000}}},'P1'),null);
 assert.equal(verifiedRewardPaymentFailure({raw:{orderQuery:{OrderList:[{PayStatus:'0'}]}}},'P1'),false);
});
