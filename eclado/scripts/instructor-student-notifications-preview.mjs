// Disposable PGlite + actual binding RPC/worker/templates. Never loads .env or sends provider HTTP.
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {bindingNotificationFixture}=require('../tests/integration/instructor-student-notifications-db.test.cjs');
const {instructorStudentNoticeMessage}=require('../api/_instructor-student-notice.js');
const {dispatchRewards}=require('../api/reward-notification-worker.js')._private;
let c;
async function reset(){const fresh=await bindingNotificationFixture();try{await fresh.actor();let previous=await fresh.bind('bind',fresh.teacher);previous=await fresh.bind('rebind',fresh.teacher2,previous.context.binding_id);await fresh.bind('unbind',null,previous.context.binding_id);}catch(e){await fresh.db.close();throw e;}const old=c;c=fresh;if(old)await old.db.close();}
await reset();
const port=Number(process.env.BINDING_PREVIEW_PORT||5196),origin=`http://127.0.0.1:${port}`;
const student={id:c.student,type:'pro',name:'陳小美'},members=[student,{id:c.teacher,type:'instructor',name:'王老師'},{id:c.teacher2,type:'instructor',name:'李老師'}];
const calls={get_admin_student_pricing_settings:()=>c.rpc('get_admin_student_pricing_settings'),get_admin_instructor_student_member:a=>c.rpc('get_admin_instructor_student_member',[a.p_member_id]),save_instructor_student_binding:a=>c.rpc('save_instructor_student_binding',[a.p_student_id,a.p_instructor_id,a.p_expected_binding_id,a.p_action]),get_admin_instructor_student_notifications:a=>c.rpc('get_admin_instructor_student_notifications',[a.p_student_id,a.p_offset||0])};
const html=`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>師生綁定通知｜本機驗收</title></head><body><div id="root"></div><script type="module" src="/scripts/local-preview/instructor-student-notifications.jsx"></script></body></html>`;
const bootstrap=`const originalFetch=window.fetch.bind(window);window.fetch=async(input,options)=>{const u=new URL(typeof input==='string'?input:input.url,location.href);if(u.pathname.startsWith('/rest/v1/rpc/')){const response=await originalFetch('/__binding/rpc/'+u.pathname.split('/').pop(),{method:'POST',headers:{'Content-Type':'application/json'},body:options?.body||'{}'});if(u.pathname.endsWith('/save_instructor_student_binding')&&response.ok)window.dispatchEvent(new Event('binding-change'));return response;}if(u.origin!==location.origin)throw Error('此預覽禁止對外連線');return originalFetch(input,options);};`;
let queue=Promise.resolve();
const plugin={name:'isolated-binding-notices',transformIndexHtml:()=>[{tag:'script',children:bootstrap,injectTo:'head-prepend'}],configureServer(server){server.middlewares.use((req,res,next)=>{
 res.setHeader('Content-Security-Policy',"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:*;");
 const url=new URL(req.url,origin);
 if(url.pathname==='/__binding-notices'){server.transformIndexHtml(url.pathname,html).then(body=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(body);});return;}
 if(!url.pathname.startsWith('/__binding/'))return next();
 const task=async()=>{try{
 let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16384)throw Error('Request too large');}const a=raw?JSON.parse(raw):{};let result;
 await c.actor();
 if(url.pathname==='/__binding/state'&&req.method==='GET'){
 const notices=(await c.db.query('select id,event_type,audience,payload,status,channel,line_attempts,email_attempts from public.instructor_student_notification_outbox order by created_at,id')).rows;
 result={student,members,notices:notices.map(({payload,...n})=>({...n,message:instructorStudentNoticeMessage(payload,n.audience)}))};
 }else if(url.pathname==='/__binding/reset'&&req.method==='POST'){await reset();result={reset:true};
 }else if(url.pathname.startsWith('/__binding/rpc/')&&req.method==='POST'){
 const fn=calls[url.pathname.split('/').pop()];if(!fn)throw Error('Unsupported local RPC');result=await fn(a);
 }else if(url.pathname==='/__binding/dispatch'&&req.method==='POST'){
 const env={SUPABASE_URL:'http://isolated.local',SUPABASE_SERVICE_ROLE_KEY:'local-only',LINE_CHANNEL_ACCESS_TOKEN:'local-only',RESEND_API_KEY:'local-only',ORDER_EMAIL_FROM:'ECLADO <local@example.test>',INSTRUCTOR_STUDENT_NOTIFICATIONS_ENABLED:'true'};
 result=await dispatchRewards({env,fetchImpl:async(target,opts)=>{
 const args=JSON.parse(opts.body);
 if(target==='http://isolated.local/rest/v1/rpc/claim_reward_notifications')return Response.json([]);
 if(target==='http://isolated.local/rest/v1/rpc/claim_instructor_student_notifications'){await c.actor(null,'service_role');return Response.json(await c.rpc('claim_instructor_student_notifications',[args.p_limit,[],args.p_email_from]));}
 if(target==='http://isolated.local/rest/v1/rpc/complete_instructor_student_notification'){await c.actor(null,'service_role');return Response.json(await c.rpc('complete_instructor_student_notification',[args.p_id,args.p_token,args.p_result,args.p_provider_id]));}
 if(target==='https://api.line.me/v2/bot/message/push')return new Response('{}',{status:a.scenario==='line_rejected'?400:a.scenario==='line_server_error'?500:200});
 if(target==='https://api.resend.com/emails')return Response.json({id:'local-email-accepted'});
 throw Error('External destination forbidden');
 }});
 }else{res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(result));
 }catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({code:e.code||'LOCAL_ERROR',message:e.message}));}};
 queue=queue.then(task,task);
 });}};
const server=await createServer({root:fileURLToPath(new URL('..',import.meta.url)),configFile:false,envFile:false,plugins:[plugin],define:{'import.meta.env.VITE_ECLADO_ENV':JSON.stringify('local'),'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(origin),'import.meta.env.VITE_SUPABASE_ANON_KEY':JSON.stringify('local-only-public-placeholder'),'import.meta.env.VITE_PAYMENT_MODE':JSON.stringify('disabled')},server:{host:'127.0.0.1',port,strictPort:true}});
await server.listen();console.log(`LOCAL BINDING NOTIFICATIONS ${origin}/__binding-notices`);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();await c.db.close();process.exit(0);});
