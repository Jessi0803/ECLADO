const test = require('node:test');
const assert = require('node:assert/strict');
const { extractDiagnostic, createDiagnosticWriter } = require('./sinopac-diagnostics.cjs');
const context = { orderId:'ECL-LOCAL-1', providerOrderNo:'ECL-LOCAL-1-R2', source:'notify', apiService:'OrderPayQuery' };
const response = () => ({ Status:'S', Description:'S0000 – 處理成功', PayToken:'PRIVATE', TSResultContent:{
  OrderNo:context.providerOrderNo, APType:'PayOut', Status:'F', Description:'E2720 – 3D 驗證失敗 token=PRIVATE',
  AuthResponseCode:'N7', LeftCCNo:'411111', RightCCNo:'1111', CCToken:'PRIVATE', CCExpDate:'2812', Param1:'private@example.com',
} });

test('verified inner transaction decline is distinct from successful API; no raw payload or card data persists', () => {
  const row = extractDiagnostic(context,response());
  assert.equal(row.api_status,'S'); assert.equal(row.transaction_status,'F');
  assert.equal(row.transaction_message_code,'E2720'); assert.equal(row.auth_response_code,'N7');
  assert.equal(row.attempt_no,2);
  assert.doesNotMatch(JSON.stringify(row),/PRIVATE|411111|1111|2812|example.com|Token|Description/);
  assert.equal(extractDiagnostic(context,response()).diagnostic_key,row.diagnostic_key);
});
test('different bank references and untrusted local errors cannot become order evidence', () => {
  const wrong=response(); wrong.TSResultContent.OrderNo='ECL-OTHER';
  assert.equal(extractDiagnostic(context,wrong),null);
  assert.equal(extractDiagnostic(context,{Status:'F',Description:'E2501 – wrong token'}),null);
  assert.equal(extractDiagnostic({...context,apiService:'OrderQuery'},{Status:'S',OrderList:[]}),null);
  assert.equal(extractDiagnostic({...context,apiService:'OrderQuery'},{Status:'S',OrderList:[{OrderNo:'ECL-OTHER',PayStatus:'1C400'}]}),null);
  assert.equal(extractDiagnostic(context,null,new Error('customer input failure')),null);
  assert.equal(extractDiagnostic({...context,orderId:'bad'},response()),null);
});
test('HTTP authentication/transport evidence is explicit and cannot claim a card decline', () => {
  for(const kind of ['bank_http','network','timeout','response_integrity','configuration']){
    const row=extractDiagnostic({...context,apiService:'OrderCreate'},null,{message:'PRIVATE',sinopacDiagnostic:{kind,httpStatus:kind==='bank_http'?401:null}});
    assert.equal(row.failure_kind,kind); assert.equal(row.transaction_status,null);
    assert.doesNotMatch(JSON.stringify(row),/PRIVATE/);
  }
});
test('logging outage cannot reject payment; duplicate snapshots use ignore-duplicates', async t => {
  let request;
  const record=createDiagnosticWriter({url:'https://isolated.invalid',key:'fake',fetchImpl:async(url,options)=>{
    request=options;return new Response(null,{status:201});
  }});
  await record(context,response());
  assert.match(request.headers.Prefer,/ignore-duplicates/);
  t.mock.method(console,'warn',()=>{});
  const broken=createDiagnosticWriter({url:'https://isolated.invalid',key:'fake',fetchImpl:async()=>{throw new Error('PRIVATE');}});
  await assert.doesNotReject(()=>broken(context,response()));
});
