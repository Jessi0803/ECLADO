const test=require('node:test');
const assert=require('node:assert/strict');
Object.assign(process.env,{
  SUPABASE_URL:'https://supabase.example.test',SUPABASE_SERVICE_ROLE_KEY:'fake-key',SINOPAC_X_KEY:'fake-x-key',
  SINOPAC_SHOP_NO:'NA0636_001',SINOPAC_A1:'65960834240E44B7',SINOPAC_A2:'2831076A098E49E7',
  SINOPAC_B1:'CB1AFFBF915A492B',SINOPAC_B2:'7F242C0AA612454F',SINOPAC_API_BASE_URL:'https://bank.example.test/api',
});
const server=require('./server.js');
const context={orderId:'ECL-LOCAL-1',providerOrderNo:'ECL-LOCAL-1',source:'create'};

test('real API wrapper captures 401 privately, verifies signatures before storing codes and tolerates telemetry failure',async t=>{
  const rows=[];
  let mode='http401';
  t.mock.method(console,'warn',()=>{});
  t.mock.method(global,'fetch',async(url,options)=>{
    if(String(url).includes('/rest/v1/order_payment_diagnostics')){
      rows.push(JSON.parse(options.body));
      if(mode==='logging-failure')throw new Error('diagnostics unavailable');
      return new Response(null,{status:201});
    }
    if(mode==='http401')return new Response('PRIVATE-X-KEY',{status:401});
    if(String(url).endsWith('/Nonce'))return Response.json({Nonce:'1234567890ABCDEF'});
    const req=JSON.parse(options.body);
    const decoded={Status:'F',Description:'E2720 – 3D 驗證失敗'};
    return Response.json({Nonce:req.Nonce,Message:server.encryptMessage(server.getAesKey(),JSON.stringify(decoded),req.Nonce),
      Sign:mode==='bad-sign'?'INVALID':server.generateSign(decoded,server.getAesKey(),req.Nonce)});
  });
  await assert.rejects(()=>server.callOrderApi('OrderCreate',{OrderNo:context.orderId},context),error=>{
    assert.doesNotMatch(error.message,/PRIVATE/);return /401/.test(error.message);
  });
  assert.equal(rows.at(-1).http_status,401); assert.equal(rows.at(-1).failure_kind,'bank_http');
  mode='bad-sign';
  await assert.rejects(()=>server.callOrderApi('OrderCreate',{OrderNo:context.orderId},context),/sign mismatch/);
  assert.equal(rows.at(-1).failure_kind,'response_integrity'); assert.equal(rows.at(-1).api_message_code,null);
  mode='verified';
  const result=await server.callOrderApi('OrderCreate',{OrderNo:context.orderId},context);
  assert.equal(result.data.Status,'F'); assert.equal(rows.at(-1).api_message_code,'E2720');
  mode='logging-failure';
  await assert.doesNotReject(()=>server.callOrderApi('OrderCreate',{OrderNo:context.orderId},context));
});
