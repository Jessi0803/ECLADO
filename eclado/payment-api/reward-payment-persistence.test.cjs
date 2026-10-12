const {test}=require('node:test');const assert=require('node:assert/strict');
process.env.SUPABASE_URL='https://reward-isolated.test';
process.env.SUPABASE_SERVICE_ROLE_KEY='isolated-service-key';
const {persistVerifiedRewardPayment}=require('./server');
test('verified reward receipt sends no caller amount and propagates persistence failure for retry',async()=>{
  const original=global.fetch;const calls=[];
  try{
    global.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify({applicable:true}),{status:200});};
    await persistVerifiedRewardPayment('O1','P1',{paid:true,raw:{body:{PayStatus:'1'}}});assert.equal(calls.length,0);
    const positive={raw:{orderQuery:{OrderList:[{OrderNo:'P1',PayStatus:'1C300'}]}}};
    await persistVerifiedRewardPayment('O1','P1',positive);
    assert.equal(calls[0].url,'https://reward-isolated.test/rest/v1/rpc/record_verified_instructor_reward_payment');
    assert.deepEqual(calls[0].body,{p_order_id:'O1',p_provider_order_no:'P1',p_proof_kind:'order_query'});
    global.fetch=async()=>new Response(JSON.stringify({message:'isolated storage failure'}),{status:500});
    await assert.rejects(persistVerifiedRewardPayment('O1','P1',positive),/isolated storage failure/);
    global.fetch=async()=>new Response(JSON.stringify({code:'42883',message:'installed helper dependency is broken'}),{status:400});
    await assert.rejects(persistVerifiedRewardPayment('O1','P1',positive),/42883/);
    global.fetch=async()=>new Response(JSON.stringify({code:'PGRST202',message:'2B is absent'}),{status:404});
    await persistVerifiedRewardPayment('O1','P1',positive);
  }finally{global.fetch=original;}
});
