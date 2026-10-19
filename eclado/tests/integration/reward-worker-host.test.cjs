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
