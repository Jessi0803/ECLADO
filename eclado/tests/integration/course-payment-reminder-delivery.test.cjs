const {test}=require('node:test');const assert=require('node:assert/strict');
const {deliverRewardNotice}=require('../../api/_reward-notification-delivery');
const {dispatchCourseNotifications}=require('../../api/reward-notification-worker')._private;
const payload={kind:'course_payment',name:'付款提醒課程',course_id:'c0ea0000-0000-4000-8000-000000000001',
 order_id:'c0ea0000-0000-4000-8000-000000000002',starts_at:'2035-01-01T12:00:00Z',payment_due_at:'2035-01-01T11:30:00Z',
 total_twd:2400,participants:['王小美','李小明'],final:true};
test('payment reminder reuses delivery transport/idempotency key and sends no Zoom URL',async()=>{
 const job={id:'notice',key:'stable-key',channel:'line',target:'test-only',payload};let calls=0;
 const fetchImpl=async(url,opts)=>{calls++;const body=JSON.parse(opts.body);assert.equal(url,'https://api.line.me/v2/bot/message/push');
  assert.equal(opts.headers['X-Line-Retry-Key'],'stable-key');assert.match(body.messages[0].text,/王小美、李小明/);
  assert.match(body.messages[0].text,/課程最後付款提醒/);assert.match(body.messages[0].text,/https:\/\/preview.example.test\/courses\/.+\/register/);
  assert.match(body.messages[0].text,/開課前 30 分鐘/);assert.match(body.messages[0].text,/19:30/);
  assert.doesNotMatch(body.messages[0].text,/Zoom/);return new Response('{}',{status:200});};
 const result=await deliverRewardNotice(job,{env:{LINE_CHANNEL_ACCESS_TOKEN:'mock-only',COURSE_STOREFRONT_ORIGIN:'https://preview.example.test'},fetchImpl});
 assert.equal(result.result,'accepted');assert.equal(calls,1);
});
test('course worker dispatches queued payment reminders and records accepted delivery',async()=>{
 let claimed=0,completed=0,sent=0;
 const fetchImpl=async(url,opts)=>{
  if(url.endsWith('/claim_course_payment_reminder'))return new Response(JSON.stringify(claimed++===0?{
   id:'notice',lease_token:'lease',key:'notice',channel:'email',target:'test@example.test',from:'sender@example.test',payload}:null));
  if(url.endsWith('/complete_course_notification')){completed++;assert.equal(JSON.parse(opts.body).p_result,'accepted');return new Response('true');}
  if(url==='https://api.resend.com/emails'){sent++;assert.equal(opts.headers['Idempotency-Key'],'notice');return new Response('{"id":"mock-id"}');}
  throw Error('unexpected destination');
 };
 const result=await dispatchCourseNotifications({env:{SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'mock-only',RESEND_API_KEY:'mock-only',ORDER_EMAIL_FROM:'sender@example.test'},fetchImpl,paymentReminders:true});
 assert.deepEqual(result,{checked:1,accepted:1});assert.equal(sent,1);assert.equal(completed,1);
});
