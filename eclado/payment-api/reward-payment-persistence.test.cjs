const {test}=require('node:test');const assert=require('node:assert/strict');
process.env.SUPABASE_URL='https://reward-isolated.test';
process.env.SUPABASE_SERVICE_ROLE_KEY='isolated-service-key';
process.env.SINOPAC_SHOP_NO='isolated-test-shop';
const {persistVerifiedRewardPayment}=require('./server');
test('verified reward receipt sends no caller amount and propagates persistence failure for retry',async()=>{
  const original=global.fetch;const calls=[];
  try{
    global.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify({applicable:true}),{status:200});};
    await persistVerifiedRewardPayment('O1','P1',{paid:true,raw:{body:{PayStatus:'1'}}});assert.equal(calls.length,0);
    const positive={raw:{orderQuery:{OrderList:[{OrderNo:'P1',PayStatus:'1C300'}]}}};
    await persistVerifiedRewardPayment('O1','P1',positive);
    assert.equal(calls[0].url,'https://reward-isolated.test/rest/v1/rpc/record_verified_reward_wallet_payment');
    assert.deepEqual(calls[0].body,{p_order_id:'O1',p_provider_order_no:'P1',p_proof_kind:'order_query',p_bank_amount:null});
    global.fetch=async()=>new Response(JSON.stringify({message:'isolated storage failure'}),{status:500});
    await assert.rejects(persistVerifiedRewardPayment('O1','P1',positive),/isolated storage failure/);
    global.fetch=async()=>new Response(JSON.stringify({code:'42883',message:'installed helper dependency is broken'}),{status:400});
    await assert.rejects(persistVerifiedRewardPayment('O1','P1',positive),/42883/);
    global.fetch=async()=>new Response(JSON.stringify({code:'PGRST202',message:'2B is absent'}),{status:404});
    await persistVerifiedRewardPayment('O1','P1',positive);
  }finally{global.fetch=original;}
});
test('released-wallet success is persisted then blocks activation; definite failure uses private release RPC',async()=>{
 const original=global.fetch;const calls=[];
 try{
  global.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify({applicable:true,payment_blocked:true}),{status:200});};
  await assert.rejects(persistVerifiedRewardPayment('O1','P1',{raw:{orderQuery:{OrderList:[{OrderNo:'P1',PayStatus:'1C300'}]}}}),/帳務異常/);
  global.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify({applicable:true}),{status:200});};
  await persistVerifiedRewardPayment('O1','P1',{raw:{orderQuery:{OrderList:[{OrderNo:'P1',PayStatus:'F'}]}}});
  assert.ok(calls.at(-1).url.endsWith('/record_reward_credit_payment_failure'));
  assert.deepEqual(calls.at(-1).body,{p_order_id:'O1',p_provider_order_no:'P1'});
 }finally{global.fetch=original;}
});

test('authoritative double-wallet net payment reaches bank as cents, caller amount ignored',async()=>{
 const {buildAuthoritativeCreateBody}=require('./server');const original=global.fetch;
 try{
  global.fetch=async(url)=>new Response(JSON.stringify(String(url).includes('/rest/v1/orders?')
    ? [{id:'O1',total:5600,shopping_credit_amount:300,reward_credit_amount:5299,payment_amount:1}]
    : {id:'O1',total:1,order_total:5600,shopping_credit_amount:300,reward_credit_amount:5299,items:[],payment_due_at:'2099-01-01T00:00:00Z'}),{status:200});
  const body=await buildAuthoritativeCreateBody({orderNo:'O1',paymentToken:'isolated-token',amount:99999,payType:'C'});
  assert.equal(body.Amount,100);
 }finally{global.fetch=original;}
});
