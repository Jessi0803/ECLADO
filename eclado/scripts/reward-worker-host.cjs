// Host adapter only: no HTTP listener, dotenv, bank secrets, or new financial logic.
const crypto=require('node:crypto');
const {dispatchRewards}=require('../api/reward-notification-worker')._private;
const ALLOWED=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SERVICE_KEY','LINE_CHANNEL_ACCESS_TOKEN','RESEND_API_KEY','ORDER_EMAIL_FROM','REWARD_NOTIFICATION_ADMIN_EMAILS'];
function configuration(source){
 if(source.REWARD_BANK_ENCRYPTION_KEYS||source.REWARD_BANK_ACTIVE_KEY_ID)throw Error('bank_keys_forbidden');
 const env=Object.fromEntries(ALLOWED.filter(k=>source[k]).map(k=>[k,source[k]]));
 const ref=String(source.REWARD_WORKER_PROJECT_REF||'');
 if(!/^[a-z0-9]{20}$/.test(ref)||env.SUPABASE_URL!==`https://${ref}.supabase.co`)throw Error('project_configuration');
 if(!(env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SERVICE_KEY))throw Error('service_configuration');
 if(!env.RESEND_API_KEY||!env.ORDER_EMAIL_FROM||!env.REWARD_NOTIFICATION_ADMIN_EMAILS)throw Error('email_configuration');
 const recipients=env.REWARD_NOTIFICATION_ADMIN_EMAILS.split(',').map(s=>s.trim()).filter(Boolean);
 if(!recipients.length||recipients.some(s=>!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)))throw Error('recipient_configuration');
 return env;
}
// Stable per project and Taiwan date: same-day timeouts reuse the same DB run key.
function dailyRunKey(projectUrl,at){
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
 const bytes=crypto.createHash('sha1').update(`eclado-reward-reconciliation-v1:${projectUrl}:${day}`).digest().subarray(0,16);
 bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
 const hex=bytes.toString('hex');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
async function run({action,source=process.env,fetchImpl=fetch,at=new Date(),runKey}={}){
 if(!['check','dispatch','reconcile'].includes(action))throw Error('action_configuration');
 if(action!=='check'&&source.REWARD_WORKER_ENABLED!=='true')return {status:'disabled',action};
 const env=configuration(source);
 if(action==='check')return {status:'configuration_valid',networkRequests:0};
 const rpcRoot=`${env.SUPABASE_URL}/rest/v1/rpc/`;
 const rpcNames=new Set(['claim_reward_notifications','complete_reward_notification','run_reward_reconciliation']);
 const restrictedFetch=async(url,options)=>{
  const target=String(url);
  const rpc=target.startsWith(rpcRoot)&&rpcNames.has(target.slice(rpcRoot.length));
  const provider=action==='dispatch'&&['https://api.line.me/v2/bot/message/push','https://api.resend.com/emails'].includes(target);
  if(!rpc&&!provider)throw Error('destination_forbidden');
  return fetchImpl(url,options);
 };
 if(action==='dispatch')return {status:'complete',action,...await dispatchRewards({env,fetchImpl:restrictedFetch,limit:5})};
 const key=runKey||dailyRunKey(env.SUPABASE_URL,at);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key))throw Error('run_key_configuration');
 const service=env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SERVICE_KEY;
 const response=await restrictedFetch(rpcRoot+'run_reward_reconciliation',{method:'POST',signal:AbortSignal.timeout(5000),headers:{apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'},body:JSON.stringify({p_request_key:key})});
 if(!response.ok)throw Error('reconciliation_request_failed');
 const report=await response.json();
 return {status:report.status||'unknown',action,runKey:key,checked:report.checked||0,findings:report.findings||0};
}
if(require.main===module){
 const action=process.argv[2];
 run({action,runKey:process.argv[3]}).then(result=>{console.info(JSON.stringify(result));if(action==='reconcile'&&!['complete','completed','disabled'].includes(result.status))process.exitCode=1;}).catch(()=>{console.error(JSON.stringify({status:'interrupted',action:['check','dispatch','reconcile'].includes(action)?action:'invalid'}));process.exitCode=1;});
}
module.exports={run,configuration,dailyRunKey};
