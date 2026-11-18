const assert=require('node:assert/strict');
const {test}=require('node:test');
const config=require('../../src/config/cartReminder.json');
const {cartReminderMessage,deliverCartReminder}=require('../../api/_cart-reminder-delivery.js');
const handler=require('../../api/remind-abandoned-carts.js');
const {dispatchCartReminders}=handler._private;
const job={id:'job',lease_token:'token',channel:'line',target:'U'+'a'.repeat(32),key:'11111111-1111-4111-8111-111111111111',from:'ECLADO <service@example.test>',payload:{kind:'cart_reminder',template_version:1,content:config.defaultContent}};
const env={SUPABASE_URL:'https://isolated.test',SUPABASE_SERVICE_ROLE_KEY:'service',LINE_CHANNEL_ACCESS_TOKEN:'line',RESEND_API_KEY:'email'};
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}});

test('public copy is preserved and placeholders become a fixed, token-free cart URL',()=>{
 const message=cartReminderMessage(job.payload);
 assert.equal(message.text,config.defaultContent.replaceAll('[購物車連結]','https://ecladotaiwan.com/cart'));
 assert(!message.text.includes('[購物車連結]'));
 assert.throws(()=>cartReminderMessage({...job.payload,content:'no link'}),/Invalid/);
 assert.throws(()=>cartReminderMessage({...job.payload,template_version:2}),/Invalid/);
 assert.throws(()=>cartReminderMessage({...job.payload,content:config.placeholder.repeat(200)}),/Invalid/);
});
test('LINE sends a stable retry key; an accepted retry response is success',async()=>{
 let request;
 const delivery=await deliverCartReminder(job,{env,fetchImpl:async(url,options)=>{request={url,...options};return json({},409,{'x-line-accepted-request-id':'accepted-uuid'});}});
 assert.deepEqual(delivery,{result:'accepted',providerId:'accepted-uuid'});
 assert.equal(request.headers['X-Line-Retry-Key'],job.key);
 assert.equal(JSON.parse(request.body).messages[0].text,cartReminderMessage(job.payload).text);
});
for(const [status,result] of [[400,'line_rejected'],[401,'line_rejected'],[429,'transient'],[500,'ambiguous'],[409,'ambiguous']]){
 test(`LINE ${status} classified as ${result}`,async()=>assert.equal((await deliverCartReminder(job,{env,fetchImpl:async()=>json({},status)})).result,result));
}
test('timeout is ambiguous and missing credentials do not call providers',async()=>{
 assert.equal((await deliverCartReminder(job,{env,fetchImpl:async()=>{throw new Error('timeout');}})).result,'ambiguous');
 assert.equal((await deliverCartReminder(job,{env:{},fetchImpl:async()=>assert.fail('provider called')})).result,'configuration');
});
test('Email escapes custom text, adds a real cart button and preserves idempotency',async()=>{
 let request;
 const delivery=await deliverCartReminder({...job,channel:'email',target:'member@example.test',payload:{...job.payload,content:'<script>alert(1)</script> [購物車連結]'}},
 {env,fetchImpl:async(url,options)=>{request={url,...options};return json({id:'mail-id'});}});
 assert.equal(delivery.result,'accepted');assert.equal(request.headers['Idempotency-Key'],job.key);
 const body=JSON.parse(request.body);
 assert(!body.html.includes('<script>'));assert(body.html.includes('&lt;script&gt;'));
 assert(body.html.includes('href="https://ecladotaiwan.com/cart"'));
 assert(body.html.includes('返回購物車'));assert.deepEqual(body.to,['member@example.test']);
});
test('worker rechecks eligibility before delivery and marks success only after acceptance',async()=>{
 const calls=[];let claimed=0;
 const result=await dispatchCartReminders({env,fetchImpl:async(url,options)=>{
  calls.push(url.split('/').pop());
  if(url.endsWith('claim_cart_reminder'))return json(claimed++===0?{id:job.id,lease_token:job.lease_token}:null);
  if(url.endsWith('prepare_cart_reminder'))return json(job);
  if(url.includes('api.line.me'))return json({},200,{'x-line-request-id':'request-id'});
  if(url.endsWith('complete_cart_reminder')){assert.equal(JSON.parse(options.body).p_result,'accepted');return json(true);}
  assert.fail('unexpected endpoint');
 }});
 assert.deepEqual(result,{checked:1,accepted:1,skipped:0});
 assert.deepEqual(calls,['claim_cart_reminder','prepare_cart_reminder','push','complete_cart_reminder','claim_cart_reminder']);
});
test('changed cart final check suppresses provider send',async()=>{
 let claims=0;
 const result=await dispatchCartReminders({env,fetchImpl:async url=>{
  if(url.endsWith('claim_cart_reminder'))return json(claims++===0?{id:'job',lease_token:'token'}:null);
  if(url.endsWith('prepare_cart_reminder'))return json(null);
  assert.fail('provider should not be called');
 }});
 assert.deepEqual(result,{checked:0,accepted:0,skipped:1});
});
test('worker does not claim success for a stale completion or ambiguous provider response',async()=>{
 let claims=0;
 const result=await dispatchCartReminders({env,fetchImpl:async(url,options)=>{
  if(url.endsWith('claim_cart_reminder'))return json(claims++===0?{id:'job',lease_token:'token'}:null);
  if(url.endsWith('prepare_cart_reminder'))return json(job);
  if(url.includes('api.line.me'))return json({},500);
  if(url.endsWith('complete_cart_reminder')){assert.equal(JSON.parse(options.body).p_result,'ambiguous');return json(false);}
  assert.fail('unexpected endpoint');
 }});
 assert.equal(result.accepted,0);assert.equal(result.checked,1);
});
test('worker auth fails closed and never touches a database for unauthorized requests',async()=>{
 const before=process.env.CRON_SECRET;
 const invoke=async(method,authorization)=>{
  const res={code:0,setHeader(){},status(code){this.code=code;return this;},json(value){this.body=value;return this;}};
  await handler({method,headers:{authorization}},res);return res;
 };
 try{
  delete process.env.CRON_SECRET;assert.equal((await invoke('GET','')).code,503);
  process.env.CRON_SECRET='test-secret';assert.equal((await invoke('GET','Bearer wrong')).code,401);
  assert.equal((await invoke('DELETE','Bearer test-secret')).code,405);
 }finally{if(before===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=before;}
});
