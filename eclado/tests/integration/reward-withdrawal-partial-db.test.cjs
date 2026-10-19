const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {runRewardCheckoutDatabaseScenario}=require('./instructor-reward-checkout-db.test.cjs');
test('partial withdrawals: amount validation, one batch, concurrent requests, failed retry and remaining-wallet spending',
 {skip:!process.env.PGLITE_MODULE&&!process.env.EMBEDDED_POSTGRES_MODULE,timeout:180000},()=>runRewardCheckoutDatabaseScenario(async c=>{
 const {db,read,one,actor,teacher,student,admin,ordinaryQuote,ordinaryCreate,status,account}=c;
 for(const f of ['withdrawals','notifications','reconciliation','withdrawal-operations'])await db.exec(read(`supabase-instructor-reward-${f}.sql`));
 await db.exec("insert into public.backoffice_role_permissions(role,permission) values('admin','orders.write'),('super_admin','orders.write') on conflict do nothing");
 await db.exec(c.fn('supabase-backoffice-permissions.sql','has_backoffice_permission').replaceAll('requested_permission','p'));
 const query=async(sql,args=[])=>(await one(sql+' q',args)).q;
 const quote=amount=>amount===undefined?query('select public.quote_my_reward_withdrawal()'):query('select public.quote_my_reward_withdrawal($1::bigint)',[amount]);
 const request=(q,key=crypto.randomUUID())=>query('select public.request_my_reward_withdrawal($1,$2::jsonb)',[key,JSON.stringify(q)]);
 const manage=(id,action,version,details={})=>query('select public.manage_reward_withdrawal($1,$2,$3,$4,$5::jsonb)',[id,crypto.randomUUID(),action,version,JSON.stringify(details)]);
 const row=id=>one('select * from public.instructor_reward_withdrawals where id=$1',[id]);
 async function funds(){await actor(student);const items=[{product_id:1,variant_id:1,qty:99}],q=await ordinaryQuote(items),o=await ordinaryCreate(items,q);await actor(admin);await db.query('select public.confirm_admin_instructor_reward_payment($1,true)',[o.order_id]);await status(o.order_id,'delivered');await actor(teacher);}
 await db.exec('update public.student_pricing_feature_settings set enabled=true');
 for(let i=0;Number((await account()).balance)<30000&&i<8;i++)await funds();
 assert.ok(Number((await account()).balance)>=30000);
 const cipher={kid:'test',iv:'encrypted',tag:'encrypted',data:'cipher-only'},masked={bank_code:'807',bank_name:'測試銀行',branch:'隔離分行',holder:'師*',account:'******1234'};
 await db.query("select set_config('test.role','service_role',false)");await db.query('select public.save_reward_bank_profile($1,$2::jsonb,$3::jsonb,0)',[teacher,JSON.stringify(cipher),JSON.stringify(masked)]);await db.query("select set_config('test.role','authenticated',false)");await actor(teacher);
 const legacy=await request(await quote()),before=await row(legacy.id);
 await db.exec(read('supabase-instructor-reward-withdrawal-deductions.sql'));
 const migration=read('supabase-instructor-reward-withdrawal-partial.sql');
 // Existing duplicate records stop installation atomically, without rewriting history.
 await db.exec('begin');
 await db.query(`insert into public.instructor_reward_withdrawals(user_id,request_key,amount,net_amount,bank_cipher,bank_masked,bank_version,batch_date,scheduled_date)
 select user_id,$2,1000,985,bank_cipher,bank_masked,bank_version,batch_date,scheduled_date from public.instructor_reward_withdrawals where id=$1`,[legacy.id,crypto.randomUUID()]);
 await assert.rejects(db.exec(migration),/Existing duplicate effective withdrawals/);await db.exec('rollback');
 assert.equal((await one("select to_regclass('public.reward_withdrawal_single_batch_idx') idx")).idx,null);
 await db.exec(migration);await db.exec(migration);
 const financialFindings=async()=>(await db.query('select * from public.reward_financial_checks()')).rows.map(r=>JSON.stringify(r)).sort();
 const baselineFindings=await financialFindings();
 const after=await row(legacy.id);for(const key of Object.keys(before))assert.deepEqual(after[key],before[key],key);
 assert.equal((await query('select public.get_my_reward_withdrawals(20)')).withdrawal_batch.blocked,true);
 await actor(admin);await manage(legacy.id,'claim',1);await manage(legacy.id,'failed',2,{reason:'confirmed unpaid',confirmed_unpaid:true});await actor(teacher);
 assert.equal((await query('select public.get_my_reward_withdrawals(0)')).withdrawal_batch.blocked,false);
 const initial=Number((await account()).balance);
 for(const invalid of [null,0,-1,15,initial+1,'9007199254740992'])await assert.rejects(quote(invalid),e=>e.code==='22003');
 for(const invalid of [null,1.5,'1000',-1])await assert.rejects(request({amount:invalid}),e=>['22023','22003'].includes(e.code));
 for(const [amount,tax,premium,net]of [[16,0,0,1],[19999,0,0,19984],[20000,0,422,19563],[20001,2000,422,17564],[30000,3000,633,26352]]){
  const q=await quote(amount);assert.deepEqual([q.amount,q.income_tax,q.supplementary_premium,q.net_amount],[amount,tax,premium,net]);
 }
 await actor(student);await assert.rejects(quote(1000),e=>e.code==='42501');await actor(teacher);
 // A shopping hold changes the wallet version: an older partial quote must roll back.
 const stale=await quote(10000),purchase=await c.create(0,300,await c.walletQuote(0,300));
 await assert.rejects(request(stale),e=>e.code==='40001');await status(purchase.order_id,'cancelled');
 assert.equal(Number((await account()).balance),initial);
 const q=await quote(10000);assert.equal(q.selection_policy,'single_per_batch_v1');
 await assert.rejects(request({...q,net_amount:10000}),e=>e.code==='40001');
 // Two independently connected sessions compete with different request keys.
 const clients=await Promise.all([db.connect(),db.connect()]);let winner;
 try{
  for(const client of clients)await client.query("select set_config('test.uid',$1,false),set_config('test.access','admin',false)",[teacher]);
  const keys=[crypto.randomUUID(),crypto.randomUUID()];
  const results=await Promise.allSettled(clients.map((client,i)=>client.query('select public.request_my_reward_withdrawal($1,$2::jsonb) q',[keys[i],JSON.stringify(q)])));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1,JSON.stringify(results.map(r=>r.status==='rejected'?{code:r.reason.code,message:r.reason.message}:r.status)));assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'55000');
  const i=results.findIndex(r=>r.status==='fulfilled');winner=results[i].value.rows[0].q;
  assert.equal((await request(q,keys[i])).id,winner.id); // Retry original success even though batch is occupied.
 }finally{for(const client of clients)await client.end();}
 assert.equal(Number((await account()).balance),initial-10000);assert.equal(Number((await account()).withdrawal_reserved_balance),10000);
 await assert.rejects(quote(1000),e=>e.code==='55000');await assert.rejects(request(q),e=>e.code==='55000');
 await actor(admin);await manage(winner.id,'claim',1);await actor(teacher);await assert.rejects(quote(1000),e=>e.code==='55000');
 // Actual wallet checkout can spend the remaining balance while withdrawal stays reserved.
 const shoppingQuote=await c.walletQuote(0,300),shopping=await c.create(0,300,shoppingQuote);
 assert.equal(Number((await account()).balance),initial-10300);assert.equal(Number((await account()).withdrawal_reserved_balance),10000);
 await status(shopping.order_id,'cancelled');assert.equal(Number((await account()).balance),initial-10000);
 await actor(admin);await manage(winner.id,'unknown',2,{reason:'bank result not confirmed'});await actor(teacher);await assert.rejects(quote(1000),e=>e.code==='55000');
 await actor(admin);await manage(winner.id,'failed',3,{reason:'bank confirmed unpaid',confirmed_unpaid:true});await actor(teacher);assert.equal(Number((await account()).balance),initial);
 // Released slot accepts a new amount; confirmed payment permanently occupies this batch.
 const paidQuote=await quote(20000),paid=await request(paidQuote);await actor(admin);await manage(paid.id,'claim',1);await manage(paid.id,'paid',2,{transfer_date:'2026-10-18',reference:'MOCK-PARTIAL',amount:paidQuote.net_amount});await actor(teacher);
 assert.equal(Number((await account()).balance),initial-20000);assert.equal(Number((await account()).withdrawal_reserved_balance),0);
 await assert.rejects(quote(1000),e=>e.code==='55000');assert.equal((await query('select public.get_my_reward_withdrawals(20)')).withdrawal_batch.blocked,true);
 // Database constraint also blocks a direct duplicate insert, bypassing the RPC gate.
 await assert.rejects(db.query(`insert into public.instructor_reward_withdrawals(user_id,request_key,amount,net_amount,bank_cipher,bank_masked,bank_version,batch_date,scheduled_date)
 select user_id,$2,1000,985,bank_cipher,bank_masked,bank_version,batch_date,scheduled_date from public.instructor_reward_withdrawals where id=$1`,[paid.id,crypto.randomUUID()]),e=>e.code==='23505');
 // Isolated clock shift only: preserve the real monthly schedule logic for next-batch eligibility.
 const schedule=c.fn('supabase-instructor-reward-nominal-batch-schedule.sql','reward_withdrawal_schedule').replace('local_at timestamp:=p_at',"local_at timestamp:=(p_at+interval '1 month')");
 await db.exec(schedule);assert.equal((await query('select public.get_my_reward_withdrawals(0)')).withdrawal_batch.blocked,false);
 const next=await quote(1000);assert.notEqual(next.batch_date,paidQuote.batch_date);await request(next);
 assert.deepEqual(await financialFindings(),baselineFindings,'No new financial findings; baseline includes deliberate late-payment exceptions');
 const acl=await one("select has_function_privilege('anon','public.quote_my_reward_withdrawal(bigint)','execute') anon,has_function_privilege('authenticated','public.quote_my_reward_withdrawal(bigint)','execute') member,has_function_privilege('service_role','public.quote_my_reward_withdrawal(bigint)','execute') service");assert.deepEqual(acl,{anon:false,member:true,service:false});
 await db.exec(read('supabase-instructor-reward-withdrawal-deductions-verify.sql'));await db.exec(read('supabase-instructor-reward-withdrawal-partial-verify.sql'));
 console.log('PASS selected amount, exact hold/refund, real remaining-balance shopping, two-session batch race, idempotency, all occupied statuses, next month and reconciliation');
 }));
