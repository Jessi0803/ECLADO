const {test}=require('node:test'),assert=require('node:assert/strict');
const {run,configuration,dailyRunKey}=require('../../scripts/reward-worker-host.cjs');
const source={REWARD_WORKER_ENABLED:'true',REWARD_WORKER_PROJECT_REF:'aaaaaaaaaaaaaaaaaaaa',SUPABASE_URL:'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'mock-only',RESEND_API_KEY:'mock-email',ORDER_EMAIL_FROM:'sender@example.test',REWARD_NOTIFICATION_ADMIN_EMAILS:'admin@example.test'};
test('host: default disabled and check mode make zero network requests',async()=>{
 const fetchImpl=()=>{throw Error('must not call');};
 assert.equal((await run({action:'dispatch',source:{},fetchImpl})).status,'disabled');
 assert.deepEqual(await run({action:'check',source,fetchImpl}),{status:'configuration_valid',networkRequests:0});
});
test('host: bank keys, missing providers, project mismatch and unknown actions fail closed',async()=>{
 for(const patch of [{REWARD_BANK_ENCRYPTION_KEYS:'secret'},{REWARD_BANK_ACTIVE_KEY_ID:'key'},{SUPABASE_URL:'https://other.test'},{RESEND_API_KEY:''},{REWARD_NOTIFICATION_ADMIN_EMAILS:'not-an-email'}])assert.throws(()=>configuration({...source,...patch}));
 await assert.rejects(run({action:'arbitrary',source}));
 assert.equal(configuration({...source,SINOPAC_KEY:'unrelated'}).SINOPAC_KEY,undefined);
});
test('host: dispatch uses existing bounded claim engine without arbitrary destinations',async()=>{
 let calls=0;assert.deepEqual(await run({action:'dispatch',source,fetchImpl:async(url,options)=>{calls++;assert.equal(url,source.SUPABASE_URL+'/rest/v1/rpc/claim_reward_notifications');assert.equal(JSON.parse(options.body).p_limit,5);return new Response('[]');}}),{status:'complete',action:'dispatch',checked:0,accepted:0});assert.equal(calls,1);
});
test('host: reconcile same Taiwan day reuses key, midnight changes key, manual retry retains key',async()=>{
 const first=new Date('2026-10-19T00:00:00Z'),same=new Date('2026-10-19T15:59:59Z'),next=new Date('2026-10-19T16:00:00Z');
 assert.equal(dailyRunKey(source.SUPABASE_URL,first),dailyRunKey(source.SUPABASE_URL,same));assert.notEqual(dailyRunKey(source.SUPABASE_URL,first),dailyRunKey(source.SUPABASE_URL,next));
 let body;const result=await run({action:'reconcile',source,at:first,fetchImpl:async(url,options)=>{body=JSON.parse(options.body);assert.equal(url,source.SUPABASE_URL+'/rest/v1/rpc/run_reward_reconciliation');return new Response('{"status":"complete","checked":3,"findings":0}');}});
 assert.equal(result.runKey,body.p_request_key);assert.equal(result.checked,3);
 const retry=await run({action:'reconcile',source,at:next,runKey:result.runKey,fetchImpl:async(_,options)=>{assert.equal(JSON.parse(options.body).p_request_key,result.runKey);return new Response('{"status":"complete"}');}});assert.equal(retry.runKey,result.runKey);
});
test('host: reconciliation never calls providers and configuration has no payment secrets',async()=>{
 const env=configuration({...source,QPAY_API_KEY:'secret',CRON_SECRET:'secret'});assert.equal(env.QPAY_API_KEY,undefined);assert.equal(env.CRON_SECRET,undefined);
 let calls=0;await assert.rejects(run({action:'reconcile',source,fetchImpl:async()=>{calls++;return new Response('{}',{status:500});}}),/reconciliation_request_failed/);assert.equal(calls,1);
});

test('host: scheduled dispatch opts into the course credit RPC without altering notification dispatch', async () => {
 const calls = [];
 const enabled = {...source, COURSE_SHOPPING_CREDIT_ENABLED:'true'};
 const result = await run({action:'dispatch', source:enabled, fetchImpl:async (url, options) => {
  const rpc = new URL(url).pathname.split('/').pop();
  calls.push(rpc);
  if (rpc === 'claim_reward_notifications') return new Response('[]');
  assert.equal(rpc, 'grant_finished_course_shopping_credit');
  assert.deepEqual(JSON.parse(options.body), {});
  return new Response('{"status":"complete","granted":2}');
 }});
 assert.deepEqual(calls.sort(), ['claim_reward_notifications', 'grant_finished_course_shopping_credit']);
 assert.deepEqual(result.courseCredit, {status:'complete', granted:2});
 assert.equal(result.accepted, 0);
});

test('host: course dispatch sends the payer a single reminder and records provider acceptance', async () => {
 const enabled = {...source, COURSE_NOTIFICATIONS_ENABLED:'true', LINE_CHANNEL_ACCESS_TOKEN:'mock-line'};
 const id = '10000000-0000-4000-8000-000000000001';
 const token = '10000000-0000-4000-8000-000000000002';
 let claimed = false;
 let sent = 0;
 const result = await run({action:'dispatch', source:enabled, fetchImpl:async (url, options) => {
  const body = JSON.parse(options.body);
  if (url === 'https://api.line.me/v2/bot/message/push') {
   assert.equal(body.to, 'teacher-line');
   assert.match(body.messages[0].text, /課前提醒.*護膚課程/);
   assert.match(body.messages[0].text, /台北時間/);
   assert.match(body.messages[0].text, /轉知您代報名的參加者/);
   assert.match(body.messages[0].text, /https:\/\/zoom.us\/j\/123/);
   assert.equal(options.headers['X-Line-Retry-Key'], id);
   sent++;
   return new Response('{}');
  }
  const rpc = new URL(url).pathname.split('/').pop();
  if (rpc === 'claim_reward_notifications') return new Response('[]');
  if (rpc === 'claim_course_notification') {
   if (claimed) return new Response('null');
   claimed = true;
   assert.deepEqual(body, {p_line_available:true, p_email_from:'sender@example.test'});
   return Response.json({id, lease_token:token, key:id, channel:'line', target:'teacher-line',
    payload:{kind:'course', name:'護膚課程', automatic:true, delegated:true,
     starts_at:'2030-11-11T02:00:00Z', ends_at:'2030-11-11T04:00:00Z', zoom_url:'https://zoom.us/j/123'}});
  }
  assert.equal(rpc, 'complete_course_notification');
  assert.deepEqual(body, {p_id:id, p_token:token, p_result:'accepted'});
  return new Response('true');
 }});
 assert.equal(sent, 1);
 assert.deepEqual(result.courseNotifications, {checked:1, accepted:1});
});

test('host: course payment reminders require independent opt-in and keep the shared destination allowlist',async()=>{
 const calls=[];
 const result=await run({action:'dispatch',source:{...source,COURSE_PAYMENT_REMINDERS_ENABLED:'true',COURSE_STOREFRONT_ORIGIN:'https://preview.example.test'},fetchImpl:async(url)=>{
  const name=new URL(url).pathname.split('/').pop();calls.push(name);
  if(name==='claim_reward_notifications')return Response.json([]);
  assert.equal(name,'claim_course_payment_reminder');return Response.json(null);
 }});
 assert.deepEqual(calls.sort(),['claim_course_payment_reminder','claim_reward_notifications']);
 assert.deepEqual(result.coursePaymentReminders,{checked:0,accepted:0});
});
