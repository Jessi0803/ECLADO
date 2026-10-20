// Disposable local manual acceptance. Never loads .env or contacts external services.
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {mockEcladoApis,mockProducts} from '../tests/support/eclado-mocks.ts';
import {createRequire} from 'node:module';
import crypto from 'node:crypto';
const require=createRequire(import.meta.url);
const {normalizeBank,maskBank,encryptBank,decryptBank}=require('../api/_reward-bank-crypto.js');
const {dispatchRewards}=require('../api/reward-notification-worker.js')._private;
if(!process.env.EMBEDDED_POSTGRES_MODULE)throw new Error('Set EMBEDDED_POSTGRES_MODULE to the local PostgreSQL 17.6 adapter; no remote database is supported.');
process.env.REWARD_BANK_ACTIVE_KEY_ID='local-only';
process.env.REWARD_BANK_ENCRYPTION_KEYS=JSON.stringify({'local-only':crypto.randomBytes(32).toString('base64')});
await require('../tests/integration/instructor-reward-checkout-db.test.cjs').runRewardCheckoutDatabaseScenario(async c=>{
const {db,read,one,actor,ordinaryQuote,ordinaryCreate,status}=c;
await db.exec(read('supabase-instructor-reward-redemption-export.sql'));
await db.exec(read('supabase-instructor-reward-withdrawals.sql'));
await db.exec(read('supabase-instructor-reward-withdrawal-operations.sql'));
await db.exec('alter table public.profiles add column email text,add column line_user_id text');
await db.exec(read('supabase-instructor-reward-notifications.sql'));
await db.exec(read('supabase-instructor-reward-reconciliation.sql'));
await db.exec('alter table public.backoffice_role_permissions drop constraint backoffice_role_permissions_permission_check');
await db.exec("insert into public.backoffice_role_permissions(role,permission) values('super_admin','orders.read'),('super_admin','orders.write'),('super_admin','members.read'),('super_admin','notifications.send'),('admin','orders.read'),('admin','members.read'),('admin','rewards.withdrawals.read') on conflict do nothing;delete from public.backoffice_role_permissions where role='admin' and permission in('rewards.withdrawals.manage','notifications.send')");
await db.exec(c.fn('supabase-backoffice-permissions.sql','has_backoffice_permission').replaceAll('requested_permission','p'));
const localPort=Number(process.env.REWARD_ACCEPTANCE_PORT||5181);if(!Number.isInteger(localPort)||localPort<1024||localPort>65535)throw new Error('Invalid local port');
const host=`http://127.0.0.1:${localPort}`,teacher='55555555-5555-4555-8555-555555555555',student='22222222-2222-4222-8222-222222222222',admin='11111111-1111-4111-8111-111111111111';
let role='teacher',routes=[],scripts=[],state;
let inbox=[],incomeOrders=[],providerMode='success';
let queue=Promise.resolve();
const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
const readonly='44444444-4444-4444-8444-444444444444';
await db.query('insert into auth.users values($1)',[teacher]);
await db.query("insert into public.profiles(id,role,name,email,line_user_id) values($1,'instructor','驗收老師','teacher@example.test','fake-line-local')",[teacher]);
await db.query("insert into public.admin_users values($1,true,'admin')",[readonly]);
await actor(admin);
await db.query("select public.set_instructor_student_price_type($1,'student_2',0)",[teacher]);
const binding=await one('select id from public.instructor_student_bindings where student_id=$1 and ended_at is null',[student]);
await db.query('select public.save_instructor_student_binding($1,$2,$3,$4)',[student,teacher,binding?.id||null,binding?'rebind':'bind']);
await db.exec("update public.products set instructor_price_multiplier=0.949 where id=1;update public.product_variants set stock=100000 where id=1");
async function seed(amount){const qty=amount===15||amount===16?amount:10;await db.query("update public.products set instructor_price_multiplier=$1 where id=1",[amount===15||amount===16?0.949:0.95-amount/qty/800]);await actor(student);await db.exec('update public.student_pricing_feature_settings set enabled=true');try{const items=[{product_id:1,variant_id:1,qty}],q=await ordinaryQuote(items),order=await ordinaryCreate(items,q);await actor(admin);await db.query('select public.confirm_admin_instructor_reward_payment($1,true)',[order.order_id]);await status(order.order_id,'delivered');incomeOrders.push(order.order_id);return order;}finally{await db.exec('update public.student_pricing_feature_settings set enabled=false');}}
await seed(1000);
const whitelist=new Set(['export_admin_reward_redemptions','get_my_reward_withdrawals','quote_my_reward_withdrawal','request_my_reward_withdrawal','get_admin_reward_withdrawals','get_admin_reward_withdrawal_queue','manage_reward_withdrawal','get_my_reward_credit','get_my_instructor_reward_report','get_admin_instructor_reward_report','get_admin_instructor_reward_accounts','get_admin_reward_notifications','get_admin_reward_reconciliation','run_reward_reconciliation','retry_reward_notification','queue_reward_correction_notice']);
const serviceNames=new Set(['export_reward_withdrawal_batch','save_reward_bank_profile','read_reward_bank_cipher','claim_reward_notifications','complete_reward_notification']);
async function realRPC(name,args,service=false){
 if(!(service?serviceNames:whitelist).has(name))throw new Error('Local RPC is not allowed');
 const signature=await one("select proargnames,pronargs from pg_proc where pronamespace='public'::regnamespace and proname=$1",[name]);
 const names=(signature.proargnames||[]).slice(0,signature.pronargs),used=names.filter(n=>Object.hasOwn(args,n));
 if(Object.keys(args).some(n=>!names.includes(n)))throw new Error('Unknown RPC argument');
 await db.exec('begin');try{
 await db.query("select set_config('test.uid',$1,true),set_config('test.role',$2,true)",[uid(),service?'service_role':'authenticated']);
 await db.exec(service?'set local role service_role':'set local role authenticated');
 const value=(await one(`select public.${name}(${used.map((n,i)=>n+' => $'+(i+1)).join(',')}) q`,used.map(n=>args[n]))).q;
 await db.exec('commit');return value;
 }catch(e){await db.exec('rollback');throw e;}
}
const workerEnv={SUPABASE_URL:'http://isolated.test',SUPABASE_SERVICE_ROLE_KEY:'fake-local-only',LINE_CHANNEL_ACCESS_TOKEN:'fake-local-only',RESEND_API_KEY:'fake-local-only',REWARD_NOTIFICATION_ADMIN_EMAILS:'admin@example.test',ORDER_EMAIL_FROM:'Local <local@example.test>'};
async function fakeFetch(url,opts){
 if(url.startsWith('http://isolated.test/rest/v1/rpc/')){const value=await serial(()=>realRPC(url.split('/').pop(),JSON.parse(opts.body),true));return new Response(JSON.stringify(value));}
 if(!['https://api.line.me/v2/bot/message/push','https://api.resend.com/emails'].includes(url))throw new Error('External network blocked');
 const channel=url.includes('line.me')?'LINE':'Email';inbox.push({at:new Date().toISOString(),channel,mode:providerMode,body:JSON.parse(opts.body),key:opts.headers?.['X-Line-Retry-Key']||opts.headers?.['Idempotency-Key']});
 if(channel==='LINE'&&providerMode==='timeout')throw new Error('Simulated timeout');
 if(channel==='LINE'&&providerMode==='5xx')return new Response('{}',{status:500});
 if(providerMode==='email-fail'&&channel==='Email')return new Response('{}',{status:400});
 return new Response(JSON.stringify({id:crypto.randomUUID()}),{status:200});
}
const uid=()=>role==='teacher'?teacher:role==='readonly'?readonly:admin;
const user=()=>({id:uid(),email:`${role}@example.test`,user_metadata:{name:role==='teacher'?'示範老師':'示範管理員'},app_metadata:{provider:'email'},aud:'authenticated',role:'authenticated',created_at:'2026-10-01T00:00:00Z'});
const permissions=['orders.read','orders.write','members.read','members.write','catalog.read','catalog.write','instructor_students.manage','member_pricing.manage','rewards.withdrawals.read','notifications.send',...(role==='readonly'?[]:['rewards.withdrawals.manage'])];
function matcher(pattern){return new RegExp('^'+pattern.split('**').map(p=>p.split('*').map(s=>s.replace(/[.+?^${}()|[\]\\]/g,'\\$&')).join('[^/]*')).join('.*')+'$');}
const register=(pattern,handler)=>routes.push({pattern:matcher(pattern),handler});
async function setup(){routes=[];scripts=[];await mockEcladoApis({route:async(pattern,handler)=>register(pattern,handler),addInitScript:async(fn,arg)=>scripts.push(`(${fn.toString()})(${JSON.stringify(arg)})`)},{authUser:user(),adminAccess:role!=='teacher',backofficeAccess:role==='teacher'?{role:'',permissions:[]}:{role:'admin',permissions:permissions.filter(p=>role!=='readonly'||!p.endsWith('write')&&!p.endsWith('manage'))},profiles:[{id:teacher,email:'teacher@example.test',name:'示範老師',role:'instructor'},{id:student,email:'student@example.test',name:'示範學生',role:'pro'},{id:admin,email:'admin@example.test',name:'示範管理員',role:'consumer'}],products:mockProducts.filter(p=>p.id!==9).map(p=>({...p,image_url:'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#eee"/><text x="35" y="105" fill="#555">DEMO PRODUCT</text></svg>')})),promotions:[],shoppingCreditByMember:{[teacher]:{available_balance:300,entries:[]}},paymentMode:'mock'});
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
for(const name of whitelist)register('**/rest/v1/rpc/'+name,async r=>{try{return json(r,await serial(()=>realRPC(name,r.request().postDataJSON()||{})));}catch(e){return json(r,{code:e.code||'22023',message:e.message},400);}});
register('**/api/reward-bank',async r=>{try{const a=r.request().postDataJSON();const result=await serial(async()=>{
if(a.action==='export')return {csv:require('../api/_reward-withdrawal-csv.js').withdrawalCsv(await realRPC('export_reward_withdrawal_batch',{p_actor:uid(),p_batch_date:a.batchDate},true))};
if(a.action==='save'){const bank=normalizeBank(a.bank);return realRPC('save_reward_bank_profile',{p_actor:uid(),p_cipher:encryptBank(uid(),bank),p_masked:maskBank(bank),p_expected_version:a.expectedVersion},true);}
if(!['read','snapshot'].includes(a.action))throw new Error('Invalid bank action');
const row=await realRPC('read_reward_bank_cipher',{p_actor:uid(),p_withdrawal_id:a.action==='snapshot'?a.withdrawalId:null},true);return row?{bank:decryptBank(row.user_id,row.cipher),version:row.version}:null;
});if(a.action==='export')return r.fulfill({status:200,contentType:'text/csv; charset=utf-8',body:result.csv});return json(r,result);}catch(e){return json(r,{error:e.message},400);}});

}
await setup();
const bootstrap=()=>`(()=>{const realFetch=window.fetch.bind(window);window.fetch=async(input,opts)=>{const raw=typeof input==='string'?input:input.url;const u=new URL(raw,location.href);if(u.origin===location.origin&&!u.pathname.startsWith('/api/'))return realFetch(input,opts);const target='/__preview/mock?url='+encodeURIComponent(u.href);if(input instanceof Request)return realFetch(new Request(target,input),opts);return realFetch(target,opts);};${scripts.join(';')};document.addEventListener('DOMContentLoaded',()=>{const bar=document.createElement('div');bar.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;background:#672d00;color:white;padding:10px;font:13px sans-serif;display:flex;gap:12px;flex-wrap:wrap';bar.innerHTML='🧪 PostgreSQL 本機驗收｜假登入／假匯款／假訊息 <a style="color:#fff" href="/__preview/switch?role=teacher">老師</a> <a style="color:#fff" href="/__preview/switch?role=admin">管理員</a> <a style="color:#fff" href="/__preview/switch?role=readonly">唯讀管理員</a> <a style="color:#fff" href="/checkout">結帳</a> <a style="color:#fff" href="/__acceptance">驗收控制台／模擬收件匣</a>';document.body.prepend(bar);const style=document.createElement('style');style.textContent='.site-nav,.mobile-topbar,.app-sidebar,.detail-panel{top:var(--preview-bar-height)!important}.app-sidebar{height:calc(100dvh - var(--preview-bar-height))!important}.site-mobile-menu{top:calc(var(--preview-bar-height) + 68px)!important}';document.head.append(style);const resize=()=>{const h=bar.getBoundingClientRect().height;document.documentElement.style.setProperty('--preview-bar-height',h+'px');document.body.style.paddingTop=h+'px';};new ResizeObserver(resize).observe(bar);resize();});document.addEventListener('click',e=>{const a=e.target.closest?.('a[href]');if(a&&new URL(a.href,location.href).origin!==location.origin){e.preventDefault();alert('模擬驗收不開啟外部網站。');}},true);})();`;
const plugin={name:'rewards-preview-only',enforce:'pre',transformIndexHtml:{order:'pre',handler:()=>[{tag:'script',children:bootstrap(),injectTo:'head-prepend'}]},configureServer(server){server.middlewares.use(async(req,res,next)=>{res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:${localPort}; img-src 'self' data:; form-action 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'`);res.setHeader('Cache-Control','no-store');const u=new URL(req.url,host);if(u.pathname==='/__preview/switch'){if(u.pathname.endsWith('switch'))role=['teacher','admin','readonly'].includes(u.searchParams.get('role'))?u.searchParams.get('role'):'teacher';await setup();res.writeHead(302,{Location:role==='teacher'?'/account':'/admin'});res.end();return;}if(u.pathname==='/__acceptance/action'){
if(req.method!=='POST'||req.headers.origin!==host){res.writeHead(403);res.end();return;}
let raw='';for await(const part of req)raw+=part;const a=JSON.parse(raw);
try{let result;if(a.action==='dispatch')result=await dispatchRewards({env:workerEnv,fetchImpl:fakeFetch});
else result=await serial(async()=>{
if(a.action==='mode'){if(!['success','5xx','timeout','email-fail'].includes(a.value))throw new Error('Invalid mode');providerMode=a.value;return providerMode;}
if(a.action==='income'){const qty=Number(a.qty);if(![15,16,200,1000].includes(qty))throw new Error('Use income amount 15, 16, 200 or 1000');return seed(qty);}
if(a.action==='return'){const id=incomeOrders.at(-1);if(!id)throw new Error('No local income order');await actor(admin);await status(id,'returned');return id;}
if(a.action==='due'){await db.exec("update public.instructor_reward_notification_outbox set next_retry_at=now() where status='retry'");return 'Only local retry clock advanced';}
throw new Error('Unknown local action');});res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));}catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}return;}
if(u.pathname==='/__acceptance/state'){
const result=await serial(async()=>({providerMode,incomeOrders,inbox,account:await one('select * from public.instructor_reward_accounts where user_id=$1',[teacher]),feature:await one('select enabled from public.student_pricing_feature_settings'),withdrawals:(await db.query('select id,status,amount,fee,net_amount,version from public.instructor_reward_withdrawals where user_id=$1 order by created_at desc',[teacher])).rows}));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;}
if(u.pathname==='/__acceptance'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(`<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>本機驗收控制台</title><style>body{font:16px system-ui;max-width:1000px;margin:30px auto;padding:20px}button,a,input,select{margin:6px;padding:8px}pre{white-space:pre-wrap;background:#eee;padding:20px}</style><h1>階段 5＋6｜隔離 PostgreSQL 驗收</h1><p>真正 SQL／Ledger／RLS；登入、銀行與 LINE／Email 全部模擬。資料關閉後丟棄。既有測試基線可能有 payment_unknown，請依驗收老師 UUID 辨識。</p><a href="/__preview/switch?role=teacher">老師</a><a href="/__preview/switch?role=admin">管理員</a><a href="/__preview/switch?role=readonly">唯讀管理員</a><p>假銀行資料：807／驗收銀行／測試分行／驗收老師／12345678901234。年度行事曆只排除週末，非正式銀行休假資料。</p><button onclick="act('dispatch')">執行一次通知 worker</button><button onclick="act('due')">提前本機重試時鐘</button><select id="mode"><option>success</option><option>5xx</option><option>timeout</option><option>email-fail</option></select><button onclick="act('mode',{value:document.querySelector('#mode').value})">設定提供者結果</button><p><input id="qty" value="200" type="number"><button onclick="act('income',{qty:Number(document.querySelector('#qty').value)})">建立指定收入（15／16／200／1000）</button><button onclick="act('return')">整筆退回最近建立的本機收入訂單</button><button onclick="refresh()">更新收件匣／帳務狀態</button></p><p>同一筆申請通知含老師及管理員；首次 worker 會展開管理員收件人，請再按一次。5xx 備援 Email 亦需下一次 worker。</p><pre id="state"></pre><script>async function refresh(){document.querySelector('#state').textContent=JSON.stringify(await(await fetch('/__acceptance/state')).json(),null,2)}async function act(action,args={}){const r=await fetch('/__acceptance/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...args})});if(!r.ok)alert(JSON.stringify(await r.json()));await refresh()}refresh()</script></html>`);return;}
if(u.pathname!=='/__preview/mock')return next();if(req.method==='POST'&&req.headers.origin!==host){res.writeHead(403);res.end();return;}const original=u.searchParams.get('url')||'';let body='';for await(const part of req)body+=part;const route={request:()=>({url:()=>original,method:()=>req.method,headers:()=>req.headers,postDataJSON:()=>body?JSON.parse(body):null}),fulfill:async({status=200,contentType='application/json',body=''})=>{res.writeHead(status,{'Content-Type':contentType});res.end(body);},abort:async()=>{res.writeHead(403);res.end();}};try{const match=[...routes].reverse().find(r=>r.pattern.test(original));if(match)await match.handler(route);else await route.fulfill({status:404,body:JSON.stringify({code:'PGRST202',message:'未提供此畫面模擬接點'})});}catch{if(!res.headersSent)res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({message:'模擬資料操作失敗'}));}});}};
// Do not evaluate the product Vite config: it calls loadEnv and could load cloud credentials.
const localConfig={root:fileURLToPath(new URL('..',import.meta.url)),plugins:[{name:'acceptance-local-routes',configureServer(server){server.middlewares.use((req,res,next)=>{const path=(req.url||'').split('?')[0];if(path==='/admin')req.url='/admin.html';next();});}}]};
const server=await createServer({...localConfig,configFile:false,envFile:false,plugins:[plugin,...(localConfig.plugins||[])],server:{host:'127.0.0.1',port:localPort,strictPort:true}});await server.listen();console.log('LOCAL ACCEPTANCE: '+host+'/__acceptance');
await new Promise(resolve=>{for(const sig of ['SIGINT','SIGTERM'])process.once(sig,resolve);});await server.close();
});
