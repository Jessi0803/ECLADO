const {test}=require('node:test');const assert=require('node:assert/strict');
const {mountAssistedRoutes,publicAssistedOrder}=require('./assisted-orders');
const {paymentRequestFromStoredMethod}=require('./server');
function fixture({bankFailure=false,rejected=false,duplicate=false,malformed=false,persistFailure=false,paymentMethod='card'}={}){
  const routes={};const calls=[];let claimed=false;let instruction=null;
  const order={id:'ORDER',user_id:'member',member:'顧客',address:'地址',email:'client@example.test',phone:'0911111111',status:'unpaid',
    subtotal:1000,total:1120,payment_due_at:new Date(Date.now()+86400000).toISOString(),invoice_type:'personal',
    invoice_company_name:'SECRET',note:'CUSTOMER',admin_note:'SECRET',items:[{name:'產品',size:'100ml',qty:1,unit_price:1000,stock_at_order:50,cost:20,internal_note:'SECRET'}]};
  mountAssistedRoutes({post:(path,handler)=>{routes[path]=handler;}},{
    rpc:async(name,args)=>{
      calls.push({name,args});
      if(name==='authorize_assisted_link'){
        if(args.p_link_token!=='valid')throw new Error('Invalid');
        return {payment_token:'PRIVATE',payment_method:paymentMethod};
      }
      if(name==='resolve_assisted_payment_claim'&&args.p_outcome==='rejected')claimed=false;
    },getOrder:async()=>order,getInstruction:async()=>instruction,
    rateLimit:async()=>true,paymentRequest:method=>method==='atm'?{payType:'A'}:paymentRequestFromStoredMethod(method),
    buildCreate:async input=>{if(claimed)throw new Error('claim exists');claimed=true;calls.push({name:'claim',input});return {OrderNo:'ORDER',Amount:1120};},
    callBank:async()=>{calls.push({name:'bank'});await new Promise(resolve=>setTimeout(resolve,5));if(bankFailure)throw new Error('timeout');return {data:malformed?{}:{Status:rejected||duplicate?'F':'S',Description:duplicate?'Duplicate order exists':rejected?'E0001 rejected':'S0000',PayToken:'test'}};},
    gatewayError:data=>data.Status==='F'?'Rejected':'',
    saveInstruction:async()=>{if(persistFailure)throw new Error('database unavailable');instruction={payment_url:'https://bank.example.test/pay',payment_state:'pending'};},
    saveAttempt:async()=>{},sendEmail:async()=>{},publicInstruction:entry=>entry,resultToken:()=> 'SHORT_RESULT',
  });
  async function request(action,body={orderNo:'ORDER',linkToken:'valid'}){
    const result={statusCode:200};const res={set:()=>{},status:code=>{result.statusCode=code;return res;},json:data=>{result.data=data;return res;}};
    await routes[`/api/orders/assisted-${action}`]({body},res);return result;
  }
  return {request,calls,order};
}
test('customer projection explicitly excludes staff notes, costs, stock and payment credentials',()=>{
  const {order}=fixture();const data=publicAssistedOrder(order);
  assert.equal(JSON.stringify(data).includes('SECRET'),false);assert.equal(data.invoice_company_name,null);
  assert.equal('stock_at_order' in data.items[0],false);assert.equal('cost' in data.items[0],false);
});
test('invalid link denies details and never reaches bank',async()=>{
  const f=fixture();const result=await f.request('details',{orderNo:'ORDER',linkToken:'bad'});
  assert.equal(result.statusCode,403);assert.equal(f.calls.some(call=>call.name==='bank'),false);
});
test('payment ignores client amounts/method; repeat/concurrent requests create only once',async()=>{
  const f=fixture();const results=await Promise.all([f.request('payment',{orderNo:'ORDER',linkToken:'valid',amount:1,paymentMethod:'atm'}),f.request('payment')]);
  assert.deepEqual(results.map(result=>result.statusCode).sort(),[200,409]);assert.equal(f.calls.filter(call=>call.name==='bank').length,1);
  const repeat=await f.request('payment');assert.equal(repeat.statusCode,200);assert.equal(repeat.data.recovered,true);
  assert.equal(f.calls.find(call=>call.name==='claim').input.payType,'C');assert.equal('amount' in f.calls.find(call=>call.name==='claim').input,false);
  assert.equal(JSON.stringify(repeat.data).includes('PRIVATE'),false);
});
test('ambiguous timeout keeps claim; repeat cannot create another bank request',async()=>{
  const f=fixture({bankFailure:true});assert.equal((await f.request('payment')).statusCode,409);
  assert.equal((await f.request('payment')).statusCode,409);assert.equal(f.calls.filter(call=>call.name==='bank').length,1);
  assert.equal(f.calls.filter(call=>call.name==='resolve_assisted_payment_claim').length,0);
});
test('Apple/Google Pay use the existing wallet gateway mapping from the saved method, not caller input',async()=>{
  for(const [paymentMethod,choosePay] of [['apple','A'],['google','G']]){
    const f=fixture({paymentMethod});
    assert.equal((await f.request('payment',{orderNo:'ORDER',linkToken:'valid',paymentMethod:'card'})).statusCode,200);
    const input=f.calls.find(call=>call.name==='claim').input;
    assert.equal(input.payType,'M');assert.equal(input.choosePay,choosePay);
    assert.equal((await f.request('details')).data.paymentMethod,paymentMethod);
  }
});
test('definite rejection releases claim but retains original order for same-ID retry',async()=>{
  const f=fixture({rejected:true});assert.equal((await f.request('payment')).statusCode,400);
  assert.equal((await f.request('payment')).statusCode,400);assert.equal(f.calls.filter(call=>call.name==='bank').length,2);
  assert.equal(f.calls.find(call=>call.name==='resolve_assisted_payment_claim').args.p_outcome,'rejected');
});
test('duplicate bank response, malformed response and persistence failure never admit another creation',async()=>{
  for(const options of [{duplicate:true},{malformed:true},{persistFailure:true}]){
    const f=fixture(options);assert.equal((await f.request('payment')).statusCode,409);
    assert.equal((await f.request('payment')).statusCode,409);assert.equal(f.calls.filter(call=>call.name==='bank').length,1);
    assert.equal(f.calls.some(call=>call.name==='resolve_assisted_payment_claim'&&call.args.p_outcome==='rejected'),false);
  }
});
test('paid/cancelled/expired orders cannot create payment',async()=>{
  for(const status of ['paid','cancelled']){const f=fixture();f.order.status=status;assert.equal((await f.request('payment')).statusCode,409);assert.equal(f.calls.some(call=>call.name==='bank'),false);}
  const f=fixture();f.order.payment_due_at='2020-01-01';assert.equal((await f.request('payment')).statusCode,409);
});
