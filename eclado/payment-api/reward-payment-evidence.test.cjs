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
