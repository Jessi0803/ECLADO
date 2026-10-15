const {test}=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {runRewardCheckoutDatabaseScenario}=require('./instructor-reward-checkout-db.test.cjs');
test('withdrawal queue: full batch totals, filtered pagination, service-only audited export and ACL',
 {skip:!process.env.EMBEDDED_POSTGRES_MODULE,timeout:180000},()=>runRewardCheckoutDatabaseScenario(async c=>{
 const {db,one,read,actor,teacher,student,admin}=c;
 assert.match((await one('select version() v')).v,/PostgreSQL 17\.6/);
 await db.exec(read('supabase-instructor-reward-withdrawals.sql'));
 await db.exec(read('supabase-instructor-reward-withdrawal-operations.sql'));
 await db.exec(read('supabase-instructor-reward-withdrawal-operations.sql'));
 await db.exec(c.fn('supabase-backoffice-permissions.sql','has_backoffice_permission').replaceAll('requested_permission','p'));
 const queue=async(offset=0,batch=null,status='',search='')=>(await one('select public.get_admin_reward_withdrawal_queue($1,$2,$3,$4) q',[offset,batch,status,search])).q;
 const exportBatch=async(id=admin,batch='2026-11-10')=>(await one('select public.export_reward_withdrawal_batch($1,$2) q',[id,batch])).q;
 const ids=[];
 // Isolated query fixtures, no bank calls or financial balance changes.
 for(let i=0;i<29;i++){
  const id=crypto.randomUUID(),status=i<25?'pending':['processing','paid','failed','unknown'][i-25];ids.push(id);
  await db.query(`insert into public.instructor_reward_withdrawals(id,user_id,request_key,amount,net_amount,bank_cipher,bank_masked,bank_version,batch_date,scheduled_date,status,processor_id,processing_key,transfer_date,transfer_reference,transferred_amount,fee_charged,failure_reason)
  values($1,$2,$3,1000,985,'{"kid":"isolated","data":"cipher-only"}','{"bank_code":"007","account":"******0012"}',1,'2026-11-10','2026-11-10',$4,$5,$6,$7,$8,$9,$10,$11)`,
  [id,teacher,crypto.randomUUID(),status,status==='pending'?null:admin,status==='pending'?null:crypto.randomUUID(),status==='paid'?'2026-11-10':null,status==='paid'?'ISOLATED':null,status==='paid'?985:null,status==='paid'?15:0,status==='failed'?'not paid':null]);
 }
 await actor(admin);let q=await queue(0,'2026-11-10');assert.equal(q.total,29);assert.equal(q.withdrawals.length,20);assert.deepEqual(q.batch_summary,{batch_date:'2026-11-10',count:26,amount:26000,fee:390,net_amount:25610});
 const page2=await queue(20,'2026-11-10');assert.equal(page2.withdrawals.length,9);assert.equal(new Set([...q.withdrawals,...page2.withdrawals].map(w=>w.id)).size,29);
 q=await queue(0,'2026-11-10','paid');assert.equal(q.total,1);assert.equal(q.batch_summary.count,26);assert.ok(!JSON.stringify(q).includes('cipher-only'));
 const name=(await one('select name from public.profiles where id=$1',[teacher])).name;
 assert.equal((await queue(0,null,'',name)).total,29);assert.equal((await queue(0,null,'',ids[0])).total,1);assert.equal((await queue(0,'2026-12-10')).total,0);assert.equal((await queue(0,null,'','%')).total,0);
 await assert.rejects(queue(0,null,'forged'),e=>e.code==='22023');await assert.rejects(queue(-1),e=>e.code==='22023');await assert.rejects(queue(0,'2026-11-11'),e=>e.code==='22023');
 const before=await one('select (select count(*) from public.instructor_reward_ledger)::int ledger,(select sum(balance) from public.instructor_reward_accounts) balance,(select count(*) from public.instructor_reward_withdrawal_events)::int events');
 await db.query("select set_config('test.role','service_role',false)");let result=await exportBatch();assert.equal(result.rows.length,26);assert.equal(result.net_amount,'25610');assert.ok(result.rows.every(w=>w.cipher.data==='cipher-only'));assert.equal(new Set(result.rows.map(w=>w.id)).size,26);
 const audit=await one('select * from public.instructor_reward_withdrawal_exports where id=$1',[result.export_id]);assert.equal(audit.actor_user_id,admin);assert.equal(audit.row_count,26);assert.equal(audit.manifest.length,26);assert.ok(!JSON.stringify(audit).includes('cipher-only'));assert.ok(audit.manifest.every(w=>['pending','processing'].includes(w.status)));
 const connections=await Promise.all([db.connect(),db.connect()]);
 for(const client of connections)await client.query("select set_config('test.role','service_role',false)");
 const parallel=await Promise.all(connections.map(client=>client.query('select public.export_reward_withdrawal_batch($1,$2) q',[admin,'2026-11-10'])));
 assert.notEqual(parallel[0].rows[0].q.export_id,parallel[1].rows[0].q.export_id);for(const r of parallel)assert.equal(r.rows[0].q.rows.length,26);
 assert.equal((await one("select deadlocks from pg_stat_database where datname=current_database()")).deadlocks,0);
 await assert.rejects(exportBatch(student),e=>e.code==='42501');await assert.rejects(exportBatch(admin,'2026-11-11'),e=>e.code==='22023');await assert.rejects(db.query('update public.instructor_reward_withdrawal_exports set row_count=0'),e=>e.code==='42501');
 assert.deepEqual(await one('select (select count(*) from public.instructor_reward_ledger)::int ledger,(select sum(balance) from public.instructor_reward_accounts) balance,(select count(*) from public.instructor_reward_withdrawal_events)::int events'),before);
 await db.query("select set_config('test.role','authenticated',false)");await assert.rejects(exportBatch(),e=>e.code==='42501');
 await db.exec('set role authenticated');await assert.rejects(db.query('select * from public.instructor_reward_withdrawal_exports'),e=>e.code==='42501');await assert.rejects(exportBatch(),e=>e.code==='42501');await db.exec('reset role');
 await actor(student);await assert.rejects(queue(),e=>e.code==='42501');
 // Removing manage must block forged API calls as well as the hidden UI.
 await db.query("delete from public.backoffice_role_permissions where role=(select role from public.admin_users where user_id='11111111-1111-4111-8111-111111111111') and permission='rewards.withdrawals.manage'");await db.query("select set_config('test.role','service_role',false)");await assert.rejects(exportBatch(),e=>e.code==='42501');
 const verification=await db.exec(read('supabase-instructor-reward-withdrawal-operations-verify.sql'));for(const [name,value] of Object.entries(verification.find(r=>r.rows?.[0]?.verification).rows[0].verification))assert.equal(value,true,name);
 const acl=await one("select has_function_privilege('anon','public.get_admin_reward_withdrawal_queue(integer,date,text,text)','execute') anon_queue,has_function_privilege('authenticated','public.export_reward_withdrawal_batch(uuid,date)','execute') member_export,has_function_privilege('service_role','public.export_reward_withdrawal_batch(uuid,date)','execute') service_export");assert.deepEqual(acl,{anon_queue:false,member_export:false,service_export:true});
 console.log('PASS PostgreSQL 17.6 queue, 29-row pagination, 26-row immutable snapshot export, audit, ACL and unchanged money');
 }));
