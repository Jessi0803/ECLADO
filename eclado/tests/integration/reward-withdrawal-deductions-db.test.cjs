const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {runRewardCheckoutDatabaseScenario}=require('./instructor-reward-checkout-db.test.cjs');
test('deductions: boundaries, legacy snapshots, real net payments, export and financial reconciliation',
 {skip:!process.env.PGLITE_MODULE&&!process.env.EMBEDDED_POSTGRES_MODULE,timeout:180000},()=>runRewardCheckoutDatabaseScenario(async c=>{
 const {db,read,one,actor,teacher,student,admin,ordinaryQuote,ordinaryCreate,status,account}=c;
 for(const f of ['withdrawals','notifications','reconciliation','withdrawal-operations'])await db.exec(read(`supabase-instructor-reward-${f}.sql`));
 await db.exec("insert into public.backoffice_role_permissions(role,permission) values('admin','orders.write'),('super_admin','orders.write') on conflict do nothing");
 await db.exec(c.fn('supabase-backoffice-permissions.sql','has_backoffice_permission').replaceAll('requested_permission','p'));
 const query=async(sql,args=[])=>(await one(sql+' q',args)).q;
 const quote=()=>query('select public.quote_my_reward_withdrawal()');
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
 const migration=read('supabase-instructor-reward-withdrawal-deductions.sql');await db.exec(migration);await db.exec(migration);
 const after=await row(legacy.id);for(const key of Object.keys(before))assert.deepEqual(after[key],before[key],key);assert.equal(after.income_tax,0);assert.equal(after.deduction_policy_version,'legacy_fee_only_v1');
 await actor(admin);await manage(legacy.id,'claim',1);await manage(legacy.id,'failed',2,{reason:'confirmed unpaid',confirmed_unpaid:true});
 for(const [gross,tax,premium,net]of [[19999,0,0,19984],[20000,0,422,19563],[20001,2000,422,17564],[20009,2000,422,17572],[20010,2001,422,17572],[30000,3000,633,26352],[20166,2016,426,17709]]){
  const q=await query('select public.calculate_reward_withdrawal_deductions($1)',[gross]);assert.deepEqual([q.income_tax,q.supplementary_premium,q.net_amount],[tax,premium,net],String(gross));assert.equal(q.deduction_snapshot.basis,gross);
 }
 await actor(teacher);const q=await quote();assert.equal(q.deduction_policy_version,'tw_withdrawal_v2');assert.ok(q.income_tax>0);assert.equal(q.net_amount,q.amount-15-q.income_tax-q.supplementary_premium);
 assert.equal((await query('select public.get_my_reward_withdrawals(0)')).withdrawal_estimate.net_amount,q.net_amount);
 await assert.rejects(request({...q,income_tax:0}),e=>e.code==='40001');
 const key=crypto.randomUUID(),w=await request(q,key);assert.equal((await request(q,key)).id,w.id);assert.equal(Number((await account()).balance),0);
 const saved=await row(w.id);assert.equal(saved.income_tax,q.income_tax);assert.deepEqual(saved.deduction_snapshot,q.deduction_snapshot);
 await assert.rejects(db.query('update public.instructor_reward_withdrawals set income_tax=0 where id=$1',[w.id]),e=>e.code==='42501');
 assert.equal((await query('select public.reward_withdrawal_projection($1)',[w.id])).supplementary_premium,q.supplementary_premium);
 const notice=(await one("select payload from public.instructor_reward_notification_outbox where withdrawal_id=$1 and audience='teacher' and event_type='requested'",[w.id])).payload;assert.equal(notice.income_tax,q.income_tax);assert.equal(notice.net_amount,q.net_amount);
 await actor(admin);const queue=await query("select public.get_admin_reward_withdrawal_queue(0,$1,'','')",[q.batch_date]);assert.equal(queue.batch_summary.net_amount,q.net_amount);assert.equal(queue.batch_summary.income_tax,q.income_tax);
 await db.query("select set_config('test.role','service_role',false)");const exported=await query('select public.export_reward_withdrawal_batch($1,$2)',[admin,q.batch_date]);assert.equal(Number(exported.rows[0].net_amount),q.net_amount);assert.equal(Number(exported.rows[0].income_tax),q.income_tax);
 const manifest=(await one('select manifest from public.instructor_reward_withdrawal_exports where id=$1',[exported.export_id])).manifest;assert.equal(manifest[0].income_tax,q.income_tax);
 await db.query("select set_config('test.role','authenticated',false)");await actor(admin);await manage(w.id,'claim',1);
 await assert.rejects(manage(w.id,'paid',2,{transfer_date:'2026-10-12',reference:'mock',amount:q.amount-15}),e=>e.code==='22023');
 await manage(w.id,'paid',2,{transfer_date:'2026-10-12',reference:'mock-no-bank',amount:q.net_amount});assert.equal((await row(w.id)).transferred_amount,q.net_amount);assert.equal(Number((await account()).withdrawal_reserved_balance),0);
 assert.equal((await db.query("select * from public.reward_financial_checks() where rule='withdrawal_amount'")).rows.length,0);
 // A failed taxed withdrawal must return the full gross amount, not only net.
 for(let i=0;Number((await account()).balance)<30000&&i<8;i++)await funds();const failedQuote=await quote(),failed=await request(failedQuote);await actor(admin);await manage(failed.id,'claim',1);await manage(failed.id,'failed',2,{reason:'bank confirmed unpaid',confirmed_unpaid:true});assert.ok(failedQuote.income_tax>0);assert.equal(Number((await account()).balance),failedQuote.amount);assert.equal((await row(failed.id)).fee_charged,0);
 assert.equal((await one("select has_function_privilege('authenticated','public.calculate_reward_withdrawal_deductions(bigint)','execute') allowed")).allowed,false);
 await db.exec(read('supabase-instructor-reward-withdrawal-deductions-verify.sql'));
 console.log('PASS frozen deductions, threshold rounding, full-gross accounting, net transfer, notice, batch, CSV manifest and legacy preservation');
 }));
