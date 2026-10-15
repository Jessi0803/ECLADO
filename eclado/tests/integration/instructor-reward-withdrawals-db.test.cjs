const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {runRewardCheckoutDatabaseScenario}=require('./instructor-reward-checkout-db.test.cjs');
test('5: encrypted bank snapshots, full withdrawals, immutable manual transfer and wallet concurrency',
 {skip:!process.env.PGLITE_MODULE&&!process.env.EMBEDDED_POSTGRES_MODULE,timeout:180000},()=>runRewardCheckoutDatabaseScenario(async c=>{
 const {db,read,one,actor,teacher,student,admin,ordinaryQuote,ordinaryCreate,status,account,walletQuote,create}=c;
 await db.exec(read('supabase-instructor-reward-withdrawals.sql'));
 // Reproduce the pre-production calendar shape and verify the cleanup migration
 // without relying on or preserving disposable test data.
 await db.exec("create table public.instructor_reward_bank_calendar_versions(id bigint generated always as identity primary key);alter table public.instructor_reward_withdrawals add column calendar_versions jsonb not null default '{}';create function public.publish_reward_bank_calendar(integer,date[],text) returns void language plpgsql as 'begin null; end'");
 const requestSignature="'public.request_my_reward_withdrawal(uuid,jsonb)'::regprocedure";
 const oldRequest=(await one(`select pg_get_functiondef(${requestSignature}) definition`)).definition
  .replace('batch_date,scheduled_date)','batch_date,scheduled_date,calendar_versions)')
  .replace("(q->>'scheduled_date')::date from", "(q->>'scheduled_date')::date,q->'calendar_versions' from");
 assert.match(oldRequest,/calendar_versions/);await db.exec(oldRequest);
 const requestAccess=await one(`select proowner,proacl::text acl from pg_proc where oid=${requestSignature}`);
 await db.exec(read('supabase-instructor-reward-nominal-batch-schedule.sql'));
 assert.deepEqual(await one(`select proowner,proacl::text acl from pg_proc where oid=${requestSignature}`),requestAccess);
 await db.exec(read('supabase-instructor-reward-nominal-batch-schedule.sql'));
 const nominalVerify=await db.exec(read('supabase-instructor-reward-nominal-batch-schedule-verify.sql'));
 assert.equal((Array.isArray(nominalVerify)?nominalVerify.find(r=>r.rows?.[0]?.verification):nominalVerify).rows[0].verification.calendar_artifacts_removed,true);
 await db.exec("insert into public.backoffice_role_permissions(role,permission) values('admin','orders.write'),('super_admin','orders.write') on conflict do nothing");
 await db.exec(c.fn('supabase-backoffice-permissions.sql','has_backoffice_permission').replaceAll('requested_permission','p'));
 const query=(sql,args=[])=>one(sql+' q',args).then(r=>r.q);
 const quote=()=>query('select public.quote_my_reward_withdrawal()');
 const request=(q,key=crypto.randomUUID())=>query('select public.request_my_reward_withdrawal($1,$2::jsonb)',[key,JSON.stringify(q)]);
 const manage=(id,action,version,details={},key=crypto.randomUUID())=>query('select public.manage_reward_withdrawal($1,$2,$3,$4,$5::jsonb)',[id,key,action,version,JSON.stringify(details)]);
 const row=id=>one('select * from public.instructor_reward_withdrawals where id=$1',[id]);
 const consistent=async()=>{const a=await account(),d=await one('select sum(balance_delta)::bigint b,sum(reserved_delta)::bigint s,sum(withdrawal_reserved_delta)::bigint w from public.instructor_reward_ledger where instructor_id=$1',[teacher]);assert.equal(Number(a.balance),Number(d.b));assert.equal(Number(a.reserved_balance),Number(d.s));assert.equal(Number(a.withdrawal_reserved_balance),Number(d.w));
 const bad=await one(`select count(*)::int n from(select balance_after,withdrawal_reserved_after,sum(balance_delta) over(order by id) b,sum(withdrawal_reserved_delta) over(order by id) w from public.instructor_reward_ledger where instructor_id=$1) t where balance_after<>b or withdrawal_reserved_after<>w`,[teacher]);assert.equal(bad.n,0);};
 // Real student income, not edits of financial balances.
 async function funds(qty){await actor(student);const items=[{product_id:1,variant_id:1,qty}],q=await ordinaryQuote(items),o=await ordinaryCreate(items,q);await actor(admin);await db.query('select public.confirm_admin_instructor_reward_payment($1,true)',[o.order_id]);await status(o.order_id,'delivered');await actor(teacher);return o;}
 await db.exec('update public.student_pricing_feature_settings set enabled=true');
 await assert.rejects(quote(),e=>e.code==='22003');
 const income=await funds(10);await assert.rejects(quote(),/銀行資料/);
 const masked={bank_code:'807',bank_name:'隔離銀行',branch:'隔離分行',holder:'師*',account:'******1234'};
 const cipher={kid:'test',iv:'encrypted-iv',tag:'encrypted-tag',data:'ciphertext-only'};
 await db.query("select set_config('test.role','service_role',false)");
 await db.query('select public.save_reward_bank_profile($1,$2::jsonb,$3::jsonb,0)',[teacher,JSON.stringify(cipher),JSON.stringify(masked)]);
 await db.query("select set_config('test.role','authenticated',false)");
 const before=(await query("select public.reward_withdrawal_schedule('2026-11-09 23:59:59+08')"));assert.equal(before.batch_date,'2026-11-10');assert.equal(before.scheduled_date,'2026-11-10');assert.equal(Object.hasOwn(before,'calendar_versions'),false);
 assert.equal((await query("select public.reward_withdrawal_schedule('2026-11-10 00:00:00+08')")).batch_date,'2026-12-10');
 const weekend=await query("select public.reward_withdrawal_schedule('2026-10-09 00:00:00+08')");assert.equal(weekend.scheduled_date,'2026-10-10');
 await actor(teacher);let q=await quote();const amount=Number(q.amount),key=crypto.randomUUID(),w=await request(q,key);
 assert.equal((await row(w.id)).amount,amount);assert.equal((await row(w.id)).net_amount,amount-15);assert.equal(Number((await account()).balance),0);
 assert.equal((await request(q,key)).id,w.id);await assert.rejects(request(q),e=>e.code==='22003');await consistent();
 await assert.rejects(db.query('delete from auth.users where id=$1',[teacher]),/reward balance or pending/);
 // Updating teacher bank later must not change the encrypted request snapshot.
 await db.query("select set_config('test.role','service_role',false)");await db.query('select public.save_reward_bank_profile($1,$2::jsonb,$3::jsonb,1)',[teacher,JSON.stringify({...cipher,data:'new-cipher'}),JSON.stringify({...masked,account:'******5678'})]);await db.query("select set_config('test.role','authenticated',false)");
 assert.equal((await row(w.id)).bank_cipher.data,'ciphertext-only');
 await db.query("update public.profiles set role='pro' where id=$1",[teacher]);await assert.rejects(quote(),e=>e.code==='42501');
 await actor(admin);let claimed=await manage(w.id,'claim',1);assert.equal(claimed.status,'processing');
 await manage(w.id,'unknown',2,{reason:'查帳中'});assert.equal(Number((await account()).withdrawal_reserved_balance),amount);
 const paidDetails={transfer_date:'2026-10-12',reference:'isolated-bank-reference',amount:amount-15},paidKey=crypto.randomUUID();
 await manage(w.id,'paid',3,paidDetails,paidKey);await manage(w.id,'paid',3,paidDetails,paidKey);
 assert.equal(Number((await account()).withdrawal_reserved_balance),0);assert.equal((await row(w.id)).fee_charged,15);
 await assert.rejects(manage(w.id,'paid',4,paidDetails),e=>e.code==='55000');
 await manage(w.id,'correction',4,{reason:'追加備註，不修改銀行結果'});assert.equal((await row(w.id)).transfer_reference,paidDetails.reference);await consistent();
 await db.query("update public.profiles set role='instructor' where id=$1",[teacher]);
 await status(income.order_id,'returned');assert.equal(Number((await account()).balance),-amount);await actor(teacher);await assert.rejects(quote(),e=>e.code==='22003');
 const secondIncome=await funds(30);q=await quote();const failed=await request(q);await actor(admin);await manage(failed.id,'claim',1);
 await assert.rejects(manage(failed.id,'failed',2,{reason:'沒有確認'}),e=>e.code==='22023');
 await manage(failed.id,'failed',2,{reason:'銀行明確未付款',confirmed_unpaid:true});assert.equal(Number((await account()).balance),Number(q.amount));assert.equal((await row(failed.id)).fee_charged,0);
 await assert.rejects(manage(failed.id,'claim',3),e=>e.code==='55000');await consistent();
 // Exact 15/16 boundaries from real purchases on a fresh instructor account,
 // with a one-dollar per-item margin; every balance originates in Ledger.
 await db.exec('begin');
 const boundaryTeacher='55555555-5555-4555-8555-555555555555';
 await db.query('insert into auth.users values($1)',[boundaryTeacher]);await db.query("insert into public.profiles(id,role,name) values($1,'instructor','門檻老師')",[boundaryTeacher]);
 await db.query("insert into public.instructor_student_settings(instructor_id,student_price_type) values($1,'student_2')",[boundaryTeacher]);
 await actor(admin);const binding=await one('select id from public.instructor_student_bindings where student_id=$1 and ended_at is null',[student]);
 await db.query("select public.save_instructor_student_binding($1,$2,$3,'rebind')",[student,boundaryTeacher,binding.id]);
 await db.exec('update public.products set instructor_price_multiplier=0.949 where id=1');
 await db.query("select set_config('test.role','service_role',false)");await db.query('select public.save_reward_bank_profile($1,$2::jsonb,$3::jsonb,0)',[boundaryTeacher,JSON.stringify(cipher),JSON.stringify(masked)]);await db.query("select set_config('test.role','authenticated',false)");
 await db.exec('savepoint boundary_income');
 async function boundaryIncome(qty){await actor(student);const items=[{product_id:1,variant_id:1,qty}],price=await ordinaryQuote(items),o=await ordinaryCreate(items,price);await actor(admin);await db.query('select public.confirm_admin_instructor_reward_payment($1,true)',[o.order_id]);await status(o.order_id,'delivered');await actor(boundaryTeacher);}
 await boundaryIncome(15);assert.equal(Number((await one('select balance from public.instructor_reward_accounts where user_id=$1',[boundaryTeacher])).balance),15);
 await db.exec('savepoint reject_boundary');await assert.rejects(quote(),e=>e.code==='22003');await db.exec('rollback to reject_boundary');await db.exec('rollback to boundary_income');
 await boundaryIncome(16);const bq=await quote();assert.equal(Number(bq.amount),16);assert.equal(Number(bq.net_amount),1);const bw=await request(bq);assert.equal((await row(bw.id)).net_amount,1);
 await actor(admin);await manage(bw.id,'claim',1);await manage(bw.id,'paid',2,{transfer_date:'2026-10-12',reference:'boundary-1',amount:1});
 await db.query('delete from auth.users where id=$1',[boundaryTeacher]);assert.equal((await row(bw.id)).bank_cipher.data,'ciphertext-only');assert.equal((await one('select count(*)::int n from public.instructor_reward_bank_profiles where user_id=$1',[boundaryTeacher])).n,0);
 await db.exec('rollback');
 await actor(teacher);q=await quote();await assert.rejects(request({...q,amount:Number(q.amount)-1}),e=>e.code==='40001');
 const beforeRollback=await account();await db.exec("create function public.test_withdrawal_failure() returns trigger language plpgsql as $$begin if new.event_type='withdraw_reserve' then raise exception 'withdraw ledger injection';end if;return new;end$$;create trigger test_withdrawal_failure before insert on public.instructor_reward_ledger for each row execute function public.test_withdrawal_failure()");
 await assert.rejects(request(q),/withdraw ledger injection/);assert.deepEqual(await account(),beforeRollback);await db.exec('drop trigger test_withdrawal_failure on public.instructor_reward_ledger;drop function public.test_withdrawal_failure()');
 if(process.env.EMBEDDED_POSTGRES_MODULE){
 const left=await db.connect(),right=await db.connect();for(const client of[left,right])await client.query("select set_config('test.uid',$1,false),set_config('test.access','admin',false)",[teacher]);
 q=await quote();const results=await Promise.allSettled([left,right].map(client=>client.query('select public.request_my_reward_withdrawal($1,$2::jsonb) q',[crypto.randomUUID(),JSON.stringify(q)])));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const won=results.find(r=>r.status==='fulfilled').value.rows[0].q;
 await actor(admin);await manage(won.id,'claim',1);await manage(won.id,'failed',2,{reason:'隔離測試未匯款',confirmed_unpaid:true});await actor(teacher);await consistent();
 q=await quote();const wallet=await walletQuote(0,300);const race=await Promise.allSettled([left.query('select public.request_my_reward_withdrawal($1,$2::jsonb) q',[crypto.randomUUID(),JSON.stringify(q)]),right.query(`select public.create_order_with_wallets($1::jsonb,'老師','地址','0900000000','teacher@example.test','','card','delivery','','personal',null,null,0::bigint,300::bigint,$2::jsonb) q`,[JSON.stringify([{product_id:1,variant_id:1,qty:10}]),JSON.stringify(wallet)])]);
 assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
 for(let i=0;i<race.length;i++)if(race[i].status==='fulfilled'){const value=race[i].value.rows[0].q;if(i===0){await actor(admin);await manage(value.id,'claim',1);await manage(value.id,'failed',2,{reason:'隔離未付款',confirmed_unpaid:true});}else await status(value.order_id,'cancelled');}
 await actor(teacher);await consistent();
 q=await quote();const rr=await Promise.allSettled([left.query('select public.request_my_reward_withdrawal($1,$2::jsonb) q',[crypto.randomUUID(),JSON.stringify(q)]),right.query("update public.orders set status='returned' where id=$1",[secondIncome.order_id])]);assert.equal(rr[1].status,'fulfilled');
 if(rr[0].status==='fulfilled'){const value=rr[0].value.rows[0].q;await actor(admin);await manage(value.id,'claim',1);await manage(value.id,'failed',2,{reason:'隔離未付款',confirmed_unpaid:true});}
 await consistent();
 // New income racing a withdrawal may invalidate the entire confirmed quote.
 await funds(30);await actor(student);const freshItems=[{product_id:1,variant_id:1,qty:10}],freshQ=await ordinaryQuote(freshItems),fresh=await ordinaryCreate(freshItems,freshQ);
 await actor(admin);await db.query('select public.confirm_admin_instructor_reward_payment($1,true)',[fresh.order_id]);await actor(teacher);q=await quote();
 const creditRace=await Promise.allSettled([left.query('select public.request_my_reward_withdrawal($1,$2::jsonb) q',[crypto.randomUUID(),JSON.stringify(q)]),right.query("update public.orders set status='delivered' where id=$1",[fresh.order_id])]);
 assert.equal(creditRace[1].status,'fulfilled');if(creditRace[0].status==='fulfilled'){const v=creditRace[0].value.rows[0].q;await actor(admin);await manage(v.id,'claim',1);await manage(v.id,'failed',2,{reason:'隔離未付款',confirmed_unpaid:true});}else assert.equal(creditRace[0].reason.code,'40001');await consistent();
 await actor(teacher);q=await quote();const competing=await request(q);
 const otherAdmin='77777777-7777-4777-8777-777777777777';await db.query("insert into public.admin_users values($1,true,'admin')",[otherAdmin]);
 await left.query("select set_config('test.uid',$1,false)",[admin]);await right.query("select set_config('test.uid',$1,false)",[otherAdmin]);
 const claims=await Promise.allSettled([left,right].map(client=>client.query("select public.manage_reward_withdrawal($1,$2,'claim',1,'{}') q",[competing.id,crypto.randomUUID()])));assert.equal(claims.filter(r=>r.status==='fulfilled').length,1);
 const processor=(await row(competing.id)).processor_id;await actor(processor);await manage(competing.id,'failed',2,{reason:'隔離未付款',confirmed_unpaid:true});await consistent();
 assert.equal((await one('select deadlocks::int n from pg_stat_database where datname=current_database()')).n,0);
 console.log('PASS stage 5 independent withdrawal/withdrawal, withdrawal/shopping, withdrawal/reversal sessions; deadlocks=0');
 }
 await actor(teacher);const own=await query('select public.get_my_reward_withdrawals(0)');assert.ok(!JSON.stringify(own).includes('ciphertext'));assert.ok(!JSON.stringify(own).includes('bank_cipher'));
 await db.exec('set role authenticated');await assert.rejects(db.query('select * from public.instructor_reward_withdrawals'),e=>e.code==='42501');await assert.rejects(db.query('select public.read_reward_bank_cipher($1,null)',[teacher]),e=>e.code==='42501');await db.exec('reset role');
 for(const role of ['consumer','pending','pro','distributor','staff']){await db.query('update public.profiles set role=$1 where id=$2',[role,teacher]);await actor(teacher);await assert.rejects(quote(),e=>e.code==='42501');}await db.query("update public.profiles set role='instructor' where id=$1",[teacher]);
 await db.query("select set_config('test.role','service_role',false)");await assert.rejects(db.query('select public.read_reward_bank_cipher($1,$2)',[student,w.id]),e=>e.code==='42501');await db.query("select set_config('test.role','authenticated',false)");
 await assert.rejects(db.query("update public.instructor_reward_withdrawals set amount=1 where id=$1",[w.id]),e=>e.code==='42501');await assert.rejects(db.query('delete from public.instructor_reward_withdrawal_events where withdrawal_id=$1',[w.id]),e=>e.code==='42501');
 await actor(student);await assert.rejects(quote(),e=>e.code==='42501');await db.query("select set_config('test.access','member',false)");await assert.rejects(manage(w.id,'correction',4,{reason:'forged'}),e=>e.code==='42501');
 await actor(admin);await db.exec('update public.student_pricing_feature_settings set enabled=false');await consistent();
 await db.exec(read('supabase-instructor-reward-withdrawals.sql'));
 const verify=await db.exec(read('supabase-instructor-reward-withdrawals-verify.sql'));for(const [name,value] of Object.entries((Array.isArray(verify)?verify.find(r=>r.rows?.[0]?.verification):verify).rows[0].verification))assert.equal(value,true,name);
 console.log('PASS stage 5 full withdrawal, negative balance, fixed fee, nominal batch cutoff, immutable snapshot, manual evidence, rollback and ACL');
 }));
