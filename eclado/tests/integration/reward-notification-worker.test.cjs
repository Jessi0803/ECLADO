const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rewardNoticeMessage, deliverRewardNotice } = require('../../api/_reward-notification-delivery');
const handler = require('../../api/reward-notification-worker');
const { dispatchRewards, authorized } = handler._private;
const env = { LINE_CHANNEL_ACCESS_TOKEN: 'mock-line', RESEND_API_KEY: 'mock-resend', ORDER_EMAIL_FROM: 'ECLADO <sender@example.test>', SUPABASE_URL: 'http://localhost.test', SUPABASE_SERVICE_ROLE_KEY: 'mock-service', REWARD_NOTIFICATION_ADMIN_EMAILS: 'admin@example.test' };
const job = { id: 'notice', lease_token: 'lease', key: '11111111-1111-4111-8111-111111111111', channel: 'line', target: 'mock-line-user', audience: 'teacher', payload: { event_type: 'requested', withdrawal_id: 'withdrawal', user_id: 'teacher', at: '2026-10-13T01:00:00Z', amount: 1000, fee: 15, net_amount: 985, scheduled_date: '2026-11-10' } };
test('templates expose only explicit safe fields for all five events', () => {
 for (const event_type of ['requested','paid','failed','unknown','correction']) {
  const m = rewardNoticeMessage({ ...job.payload, event_type, transferred_amount: 985, transfer_date:'2026-11-10', returned_amount:1000, bank_cipher:'secret', account:'12345678901234', reason:'private diagnostics', reference:'private-reference' }, 'teacher');
  assert.doesNotMatch(JSON.stringify(m),/secret|12345678901234|private/);
 }
 assert.match(rewardNoticeMessage({...job.payload,event_type:'unknown'},'teacher').text,/尚未確認成功或失敗/);
 assert.match(rewardNoticeMessage({...job.payload,event_type:'failed',returned_amount:1000},'teacher').text,/未收手續費/);
});
test('LINE accepts stable retry key; documented accepted 409 is success', async () => {
 let args;const r=await deliverRewardNotice(job,{env,fetchImpl:async(url,a)=>{args=a;return new Response('{}',{status:409,headers:{'x-line-accepted-request-id':'accepted-request'}});}});
 assert.equal(r.result,'accepted');assert.equal(args.headers['X-Line-Retry-Key'],job.key);assert.equal(JSON.parse(args.body).to,job.target);
});
for(const code of [400,429,500])test(`confirmed LINE ${code} policy requests Email fallback`,async()=>{
 assert.equal((await deliverRewardNotice(job,{env,fetchImpl:async()=>new Response('{}',{status:code})})).result,code===500?'line_server_error':code===429?'line_rate_limited':'line_rejected');
});
test('network failure and timeout remain ambiguous; no immediate cross-channel call',async()=>{
 let calls=0;const r=await deliverRewardNotice(job,{env,fetchImpl:async()=>{calls++;throw new Error('includes secret recipient');}});
 assert.equal(r.result,'ambiguous');assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(r),/secret/);
 const timeout=await deliverRewardNotice(job,{env,timeoutMs:5,fetchImpl:async(_,a)=>new Promise((_,reject)=>a.signal.addEventListener('abort',()=>reject(new Error('aborted'))))});assert.equal(timeout.result,'ambiguous');
});
test('Email stable key, branded escaping, provider acceptance and safe error classification',async()=>{
 let body;const r=await deliverRewardNotice({...job,channel:'email',target:'teacher@example.test',payload:{...job.payload,withdrawal_id:'<script>bad</script>'}},{env,fetchImpl:async(_,a)=>{body=JSON.parse(a.body);assert.equal(a.headers['Idempotency-Key'],job.key);return new Response('{"id":"email_1"}');}});
 assert.equal(r.result,'accepted');assert.ok(body.html.includes('&lt;script&gt;'));assert.ok(!body.html.includes('<script>'));
 for(const [status,result]of[[400,'permanent'],[429,'transient'],[500,'ambiguous']])assert.equal((await deliverRewardNotice({...job,channel:'email'},{env,fetchImpl:async()=>new Response('{}',{status})})).result,result);
});
test('missing provider credentials do not make HTTP calls',async()=>{
 assert.equal((await deliverRewardNotice(job,{env:{},fetchImpl:()=>{throw new Error('must not call');}})).result,'line_unavailable');
 assert.equal((await deliverRewardNotice({...job,channel:'email'},{env:{},fetchImpl:()=>{throw new Error('must not call');}})).result,'configuration');
});
test('worker only claims canonical DB jobs and completes with fenced token',async()=>{
 const calls=[];const fetchImpl=async(url,a)=>{calls.push({url,args:JSON.parse(a.body)});
  if(url.endsWith('claim_reward_notifications'))return new Response(JSON.stringify([job]));
  if(url.endsWith('complete_reward_notification'))return new Response('true');
  return new Response('{}',{headers:{'x-line-request-id':'line_1'}});
 };
 const r=await dispatchRewards({env,fetchImpl,limit:1000});assert.equal(r.accepted,1);assert.equal(calls[0].args.p_limit,5);assert.equal(calls[2].args.p_token,'lease');assert.deepEqual(calls[0].args.p_admin_emails,['admin@example.test']);
});
test('worker accepts the Vercel SUPABASE_SERVICE_KEY alias',async()=>{
 const aliasEnv={...env,SUPABASE_SERVICE_KEY:'preview-service'};delete aliasEnv.SUPABASE_SERVICE_ROLE_KEY;
 const headers=[];const fetchImpl=async(url,a)=>{headers.push(a.headers);
  if(url.endsWith('claim_reward_notifications'))return new Response('[]');
  return new Response('true');
 };
 const result=await dispatchRewards({env:aliasEnv,fetchImpl});
 assert.deepEqual(result,{checked:0,accepted:0});
 assert.equal(headers[0].apikey,'preview-service');
 assert.equal(headers[0].Authorization,'Bearer preview-service');
});
test('worker interruption after provider accepts is not swallowed as confirmed completion',async()=>{
 await assert.rejects(dispatchRewards({env,fetchImpl:async(url)=>{
  if(url.endsWith('claim_reward_notifications'))return new Response(JSON.stringify([job]));
  if(url.endsWith('complete_reward_notification'))return new Response('{}',{status:503});return new Response('{}');
 }}),/database_request_failed/);
});
test('worker refuses environments containing bank decryption credentials',async()=>{
 await assert.rejects(dispatchRewards({env:{...env,REWARD_BANK_ENCRYPTION_KEYS:'must-not-be-loaded'},fetchImpl:()=>{throw new Error('must not call');}}),/worker_requires_isolated_secrets/);
});
test('worker endpoint refuses anonymous/member credentials and no arbitrary content is sent',async()=>{
 const before=process.env.CRON_SECRET;process.env.CRON_SECRET='mock-cron';
 try{let status;const res={setHeader(){},status(c){status=c;return this;},json(){return this;}};
 await handler({method:'POST',headers:{authorization:'Bearer member'},body:{action:'dispatch',target:'victim@example.test'}},res);assert.equal(status,401);
 assert.equal(authorized({headers:{authorization:'Bearer mock-cron'}},'mock-cron'),true);assert.equal(authorized({headers:{}},''),false);
 }finally{if(before===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=before;}
});
test('authorized empty worker ticks and interruptions record safe execution metadata',async()=>{
 const names=['CRON_SECRET','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','REWARD_NOTIFICATION_ADMIN_EMAILS','REWARD_BANK_ENCRYPTION_KEYS','REWARD_BANK_ACTIVE_KEY_ID'];
 const previous=Object.fromEntries(names.map(n=>[n,process.env[n]])),originalFetch=global.fetch,originalInfo=console.info;
 const logs=[];console.info=(...args)=>logs.push(args.join(' '));
 Object.assign(process.env,{CRON_SECRET:'mock-cron',SUPABASE_URL:'http://mock.test',SUPABASE_SERVICE_ROLE_KEY:'mock-service',REWARD_NOTIFICATION_ADMIN_EMAILS:'admin@example.test',REWARD_BANK_ENCRYPTION_KEYS:'',REWARD_BANK_ACTIVE_KEY_ID:''});
 try{
  let code,body;const res={setHeader(){},status(v){code=v;return this;},json(v){body=v;return this;}};
  global.fetch=async()=>new Response('[]');
  await handler({method:'POST',headers:{authorization:'Bearer mock-cron'},body:{action:'dispatch',target:'victim@example.test'}},res);
  assert.equal(code,200);assert.deepEqual(body,{checked:0,accepted:0});assert.ok(logs.some(s=>s.includes('finishedAt')));
  global.fetch=async()=>{throw new Error('secret bank account / private@example.test');};
  await handler({method:'POST',headers:{authorization:'Bearer mock-cron'},body:{action:'dispatch'}},res);
  assert.equal(code,503);assert.ok(logs.some(s=>s.includes('interrupted')));assert.doesNotMatch(JSON.stringify({logs,body}),/victim|mock-service|private@example|secret bank/);
 }finally{global.fetch=originalFetch;console.info=originalInfo;for(const n of names)if(previous[n]===undefined)delete process.env[n];else process.env[n]=previous[n];}
});
