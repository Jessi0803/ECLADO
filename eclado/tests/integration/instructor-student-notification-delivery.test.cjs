const {test}=require('node:test'),assert=require('node:assert/strict');
const {instructorStudentNoticeMessage:message}=require('../../api/_instructor-student-notice');
const {deliverRewardNotice}=require('../../api/_reward-notification-delivery');
const {dispatchRewards}=require('../../api/reward-notification-worker')._private;
const {run}=require('../../scripts/reward-worker-host.cjs');
const payload={kind:'instructor_student',template_version:1,event_type:'bind',student_name:'陳小美',instructor_name:'李老師',previous_instructor_name:'王老師'};
const env={SUPABASE_URL:'https://aaaaaaaaaaaaaaaaaaaa.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'mock',LINE_CHANNEL_ACCESS_TOKEN:'mock',RESEND_API_KEY:'mock',ORDER_EMAIL_FROM:'local@example.test',INSTRUCTOR_STUDENT_NOTIFICATIONS_ENABLED:'true'};
test('all seven recipient templates; new teacher copy is identical for bind and rebind',()=>{
 assert.deepEqual(message(payload,'teacher'),message({...payload,event_type:'rebind'},'teacher'));
 assert.match(message(payload,'teacher').text,/後續符合返饋條件的學生訂單，將依規則計算返饋金。/);
 assert.match(message(payload,'student').text,/您已綁定師資「李老師」/);
 assert.match(message({...payload,event_type:'rebind'},'student').text,/由「王老師」更換為「李老師」/);
 assert.match(message({...payload,event_type:'unbind'},'student').text,/您與師資「王老師」的綁定已解除/);
 for(const event_type of ['rebind','unbind'])assert.doesNotMatch(message({...payload,event_type},'former_teacher').text,/李老師/);
 for(const audience of ['admin','other'])assert.throws(()=>message(payload,audience));
 assert.throws(()=>message({...payload,event_type:'unbind'},'teacher'));
 assert.throws(()=>message({...payload,template_version:2},'student'));
});
test('binding LINE and branded Email use the same approved text and stable provider keys',async()=>{
 for(const channel of ['line','email']){
 let body;const result=await deliverRewardNotice({id:'local',channel,target:'mock',key:'11111111-1111-4111-8111-111111111111',audience:'teacher',payload:{...payload,student_name:'<script>測試</script>'}},{env,fetchImpl:async(_,args)=>{body=JSON.parse(args.body);return new Response('{"id":"accepted"}');}});
 assert.equal(result.result,'accepted');const text=channel==='line'?body.messages[0].text:body.text;assert.match(text,/新增學生綁定/);
 if(channel==='email'){assert.ok(!body.html.includes('<script>'));assert.ok(body.html.includes('&lt;script&gt;'));}
 }
});
test('one shared batch cap; binding completion uses its own queue; host allows only enabled binding RPCs',async()=>{
 const source={...env,REWARD_WORKER_ENABLED:'true',REWARD_WORKER_PROJECT_REF:'aaaaaaaaaaaaaaaaaaaa',REWARD_NOTIFICATION_ADMIN_EMAILS:'admin@example.test'};
 const requests=[];
 const fetchImpl=async(url,args)=>{
 const body=JSON.parse(args.body);requests.push([url,body]);
 if(url.endsWith('/claim_reward_notifications'))return Response.json(Array.from({length:3},(_,i)=>({id:`reward${i}`,lease_token:'token',channel:'line',target:'mock',key:'key',audience:'teacher',payload:{event_type:'requested',at:'2026-11-02',withdrawal_id:'w',amount:100,fee:15,net_amount:85}})));
 if(url.endsWith('/claim_instructor_student_notifications')){assert.equal(body.p_limit,2);return Response.json(Array.from({length:2},(_,i)=>({id:`binding${i}`,lease_token:'token',channel:'line',target:'mock',key:'key',audience:'teacher',payload})));}
 if(url.includes('/complete_'))return Response.json(true);
 return Response.json({id:'accepted'});
 };
 const result=await run({action:'dispatch',source,fetchImpl});assert.equal(result.checked,5);assert.equal(result.accepted,5);
 assert.equal(requests.filter(([url])=>url.endsWith('/complete_instructor_student_notification')).length,2);
 assert.equal(requests.filter(([url])=>url.endsWith('/complete_reward_notification')).length,3);
 const disabled=[];await dispatchRewards({env:{...env,INSTRUCTOR_STUDENT_NOTIFICATIONS_ENABLED:'false'},fetchImpl:async(url)=>{disabled.push(url);return Response.json([]);}});assert.equal(disabled.length,1);
});
