const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { runRewardCheckoutDatabaseScenario } = require('./instructor-reward-checkout-db.test.cjs');

test('6: transactional outbox, fenced workers and read-only financial reconciliation', { skip: !process.env.PGLITE_MODULE && !process.env.EMBEDDED_POSTGRES_MODULE, timeout: 180000 }, () => runRewardCheckoutDatabaseScenario(async c => {
 const { db, read, one, actor, admin, student, teacher, ordinaryQuote, ordinaryCreate, status } = c;
 await db.exec(read('supabase-instructor-reward-withdrawals.sql'));
 await db.exec('alter table public.profiles add column email text,add column line_user_id text');
 await db.query("update public.profiles set email='teacher@example.test',line_user_id='isolated-line-user' where id=$1",[teacher]);
 await db.exec(read('supabase-instructor-reward-notifications.sql'));
 await db.exec(read('supabase-instructor-reward-reconciliation.sql'));
 const call = async (name,args=[]) => (await one(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) q`, args)).q;
 const key = () => crypto.randomUUID();
 const worker = () => db.query("select set_config('test.role','service_role',false)");
 const member = () => db.query("select set_config('test.role','authenticated',false)");
 const claim = () => call('claim_reward_notifications',[20,['admin@example.test']]);
 const complete = (j,result='accepted') => call('complete_reward_notification',[j.id,j.lease_token,result,null]);
 const run = () => call('run_reward_reconciliation',[key()]);
 await actor(admin);
 const baseline = await run();
 assert.equal(baseline.status,'complete');
 const unexpected = await db.query("select rule,source from public.instructor_reward_reconciliation_findings where present and rule<>'payment_unknown'");
 assert.deepEqual(unexpected.rows,[]);
 await actor(student);await db.exec('update public.student_pricing_feature_settings set enabled=true');
 const items=[{product_id:1,variant_id:1,qty:20}],q=await ordinaryQuote(items),income=await ordinaryCreate(items,q);
 await actor(admin);await db.query('select public.confirm_admin_instructor_reward_payment($1,true)',[income.order_id]);await status(income.order_id,'delivered');
 await worker();await db.query('select public.save_reward_bank_profile($1,$2::jsonb,$3::jsonb,0)',[teacher,JSON.stringify({kid:'test',iv:'iv',tag:'tag',data:'cipher'}),JSON.stringify({bank_code:'807',bank_name:'隔離銀行',branch:'分行',holder:'師*',account:'***1234'})]);await member();
 await actor(admin);
 await actor(teacher);const quote=await call('quote_my_reward_withdrawal');
 // Outbox failure prevents a committed request with missing events.
 const before=await c.account();
 await db.exec("create function public.test_outbox_failure() returns trigger language plpgsql as $$begin raise exception 'outbox injected failure';end$$;create trigger test_outbox_failure before insert on public.instructor_reward_notification_outbox for each row execute function public.test_outbox_failure()");
 await assert.rejects(call('request_my_reward_withdrawal',[key(),quote]),/outbox injected/);assert.deepEqual(await c.account(),before);
 await db.exec('drop trigger test_outbox_failure on public.instructor_reward_notification_outbox;drop function public.test_outbox_failure()');
 const requestKey=key(),w=await call('request_my_reward_withdrawal',[requestKey,quote]);await call('request_my_reward_withdrawal',[requestKey,quote]);
 assert.equal((await one('select count(*)::int n from public.instructor_reward_notification_outbox where withdrawal_id=$1',[w.id])).n,2);
 const payload=(await one("select payload from public.instructor_reward_notification_outbox where withdrawal_id=$1 limit 1",[w.id])).payload;
 assert.doesNotMatch(JSON.stringify(payload),/cipher|bank|holder|account|reference|reason/);
 await db.query("update public.profiles set role='pro' where id=$1",[teacher]);await worker();
 let jobs=await claim();const line=jobs.find(j=>j.audience==='teacher');assert.equal(line.channel,'line');
 assert.equal(await complete({...line,lease_token:key()}),false);
 assert.equal(await complete(line,'line_server_error'),true);
 jobs=await claim();const email=jobs.find(j=>j.id===line.id);assert.equal(email.channel,'email');
 await complete(email,'ambiguous');
 await db.exec("update public.instructor_reward_notification_outbox set next_retry_at=now() where status='retry'");
 jobs=await claim();const retry=jobs.find(j=>j.id===email.id);assert.equal(retry.key,email.key);assert.equal(retry.target,email.target);await complete(retry);
 for(const j of jobs.filter(j=>j.id!==retry.id))await complete(j);
 assert.equal(await complete(retry),false);
 // Crash recovery pins original target and key, and fences the old claimant.
 await member();await actor(admin);
 const manualKey=key(),newID=await call('retry_reward_notification',[line.id,manualKey,true,'隔離補發確認']);
 assert.equal(await call('retry_reward_notification',[line.id,manualKey,true,'隔離補發確認']),newID);
 await assert.rejects(call('retry_reward_notification',[line.id,manualKey,true,'不同內容']),e=>e.code==='40001');
 await worker();const crashed=(await claim()).find(j=>j.id===newID);
 await db.query("update public.instructor_reward_notification_outbox set lease_until=now()-interval '1 second' where id=$1",[newID]);
 await db.query("update public.profiles set line_user_id='changed-line' where id=$1",[teacher]);
 const recovered=(await claim()).find(j=>j.id===newID);assert.equal(recovered.key,crashed.key);assert.equal(recovered.target,crashed.target);
 assert.equal(await complete(crashed),false);await complete(recovered,'ambiguous');
 await db.query("update public.instructor_reward_notification_outbox set line_started_at=now()-interval '25 hours',next_retry_at=now() where id=$1",[newID]);
 assert.equal((await claim()).some(j=>j.id===newID),false);assert.equal((await one('select status from public.instructor_reward_notification_outbox where id=$1',[newID])).status,'unknown');
 await member();await actor(admin);await call('manage_reward_withdrawal',[w.id,key(),'claim',1,{}]);
 await call('manage_reward_withdrawal',[w.id,key(),'unknown',2,{reason:'internal bank diagnosis never sent'}]);
 await call('manage_reward_withdrawal',[w.id,key(),'unknown',3,{reason:'another internal note, same unknown state'}]);
 assert.equal((await one("select count(*)::int n from public.instructor_reward_notification_outbox where withdrawal_id=$1 and event_type='unknown'",[w.id])).n,1);
 const unknownReport=await run();assert.ok(unknownReport.findings>baseline.findings);
 await call('manage_reward_withdrawal',[w.id,key(),'failed',4,{reason:'internal bank reason',confirmed_unpaid:true}]);
 await run();assert.equal((await one("select present from public.instructor_reward_reconciliation_findings where rule='withdrawal_unknown' and source=$1",[w.id])).present,false);
 const failing=(await one("select id,payload from public.instructor_reward_notification_outbox where withdrawal_id=$1 and event_type='failed'",[w.id]));assert.equal(Number(failing.payload.returned_amount),Number(quote.amount));
 await call('manage_reward_withdrawal',[w.id,key(),'correction',5,{reason:'private correction'}]);
 const event=await one("select id from public.instructor_reward_withdrawal_events where withdrawal_id=$1 and event_type='correction'",[w.id]);
 await call('queue_reward_correction_notice',[event.id,key()]);await call('queue_reward_correction_notice',[event.id,key()]);
 assert.equal((await one("select count(*)::int n from public.instructor_reward_notification_outbox where source_event_id=$1",[event.id])).n,1);
 // Controlled owner corruption is rolled back; reconciliation never repairs it.
 await db.exec('begin');
 await db.query('update public.instructor_reward_accounts set balance=balance+1 where user_id=$1',[teacher]);
 const first=await run(),again=await run();assert.equal(again.findings,first.findings);
 assert.equal((await one("select count(*)::int n from public.instructor_reward_reconciliation_findings where rule='account_ledger' and source=$1",[teacher])).n,1);
 assert.equal(Number((await c.account()).balance),Number((await one('select sum(balance_delta)::bigint b from public.instructor_reward_ledger where instructor_id=$1',[teacher])).b)+1);
 await db.exec('rollback');await run();
 await db.exec('set role authenticated');await actor(student);
 await assert.rejects(call('get_admin_reward_notifications'),e=>e.code==='42501');await assert.rejects(run(),e=>e.code==='42501');
 await assert.rejects(db.query('select * from public.instructor_reward_notification_outbox'),e=>e.code==='42501');
 await assert.rejects(db.query('select public.reward_financial_checks()'),e=>e.code==='42501');
 await assert.rejects(claim(),e=>e.code==='42501');await db.exec('reset role');
 await actor(admin);const safe=await call('get_admin_reward_notifications',[0]);assert.doesNotMatch(JSON.stringify(safe),/teacher@example|cipher|internal bank|private correction|isolated-line/);
 // Current real permission engine, not merely the fixture's broad admin stub.
 await db.exec("alter table public.backoffice_role_permissions drop constraint backoffice_role_permissions_permission_check");
 await db.exec("insert into public.backoffice_role_permissions(role,permission) values('super_admin','orders.read'),('super_admin','orders.write'),('super_admin','members.read'),('super_admin','notifications.send') on conflict do nothing");
 await db.exec(c.fn('supabase-backoffice-permissions.sql','has_backoffice_permission').replaceAll('requested_permission','p'));
 await call('get_admin_reward_notifications',[0]);await run();
 await db.exec("delete from public.backoffice_role_permissions where role='super_admin' and permission='notifications.send'");
 await assert.rejects(call('retry_reward_notification',[line.id,key(),true,'權限測試']),e=>e.code==='42501');
 await db.exec("insert into public.backoffice_role_permissions(role,permission) values('super_admin','notifications.send')");
 // Each corruption is restricted to owner-only local transactions and rollback.
 await db.exec('begin');await db.exec('drop index public.reward_ledger_event_cycle_idx');
 for(const kind of ['credit','reverse']){
  const original=await one('select * from public.instructor_reward_ledger where event_type=$1 limit 1',[kind]);
  await db.query(`insert into public.instructor_reward_ledger(instructor_id,order_id,event_type,amount,balance_delta,pending_delta,balance_after,pending_after,reserved_after,withdrawal_reserved_after) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[original.instructor_id,original.order_id,kind,original.amount,original.balance_delta,original.pending_delta,original.balance_after,original.pending_after,original.reserved_after,original.withdrawal_reserved_after]);
 }
 await run();for(const rule of ['duplicate_credit','duplicate_reverse'])assert.equal((await one('select count(*)::int n from public.instructor_reward_reconciliation_findings where rule=$1 and present',[rule])).n,1);await db.exec('rollback');
 await db.exec('begin');await db.query('update public.instructor_reward_accounts set reserved_balance=reserved_balance+1,withdrawal_reserved_balance=withdrawal_reserved_balance+1 where user_id=$1',[teacher]);await run();assert.equal((await one("select count(*)::int n from public.instructor_reward_reconciliation_findings where rule='account_projections' and present")).n,1);await db.exec('rollback');
 await db.exec('begin');await db.exec("alter table public.instructor_reward_withdrawals disable trigger reward_withdrawal_history_guard;do $$declare c record;begin for c in select conname from pg_constraint where conrelid='public.instructor_reward_withdrawals'::regclass and contype='c' and pg_get_constraintdef(oid) like '%net_amount%' loop execute format('alter table public.instructor_reward_withdrawals drop constraint %I',c.conname);end loop;end$$");
 await db.query('update public.instructor_reward_withdrawals set net_amount=net_amount+1 where id=$1',[w.id]);await run();assert.equal((await one("select count(*)::int n from public.instructor_reward_reconciliation_findings where rule='withdrawal_amount' and present")).n,1);await db.exec('rollback');
 await db.exec('begin');await db.exec("create function public.test_run_failure() returns trigger language plpgsql as $$begin raise exception 'diagnostic contains private account';end$$;create trigger test_run_failure before insert or update on public.instructor_reward_reconciliation_findings for each row execute function public.test_run_failure()");
 const failedRun=await run();assert.equal(failedRun.status,'failed');assert.doesNotMatch(JSON.stringify(failedRun),/private/);assert.equal((await one("select status from public.instructor_reward_reconciliation_runs where id=$1",[failedRun.id])).status,'failed');await db.exec('rollback');
 // Six actual claims, five retry delays, then unknown without another send.
 const capID=await call('retry_reward_notification',[line.id,key(),true,'重試上限測試']);await worker();
 for(let i=1;i<=6;i++){
  await db.query("update public.instructor_reward_notification_outbox set next_retry_at=now() where id=$1",[capID]);
  const j=(await claim()).find(j=>j.id===capID);assert.ok(j);await complete(j,'ambiguous');
  const entry=await one('select line_attempts,status,extract(epoch from(next_retry_at-last_attempt_at))/60 minutes from public.instructor_reward_notification_outbox where id=$1',[capID]);
  assert.equal(entry.line_attempts,i);if(i<6)assert.ok(Math.abs(Number(entry.minutes)-[1,5,15,60,360][i-1])<0.1);else assert.equal(entry.status,'unknown');
 }
 assert.equal((await claim()).some(j=>j.id===capID),false);await member();await actor(admin);
 await db.query("update public.profiles set line_user_id=null where id=$1",[teacher]);
 const emailOnly=await call('retry_reward_notification',[line.id,key(),true,'無LINE補發']);await worker();const direct=(await claim()).find(j=>j.id===emailOnly);assert.equal(direct.channel,'email');await complete(direct);await member();await actor(admin);
 await db.query('update public.profiles set email=null where id=$1',[teacher]);
 const noContact=await call('retry_reward_notification',[line.id,key(),true,'無聯絡方式測試']);await worker();assert.equal((await claim()).some(j=>j.id===noContact),false);assert.equal((await one('select status from public.instructor_reward_notification_outbox where id=$1',[noContact])).status,'blocked');await member();await actor(admin);
 await db.query("update public.profiles set role='instructor',email='teacher@example.test',line_user_id='isolated-line-user' where id=$1",[teacher]);
 await actor(teacher);const paidQuote=await call('quote_my_reward_withdrawal'),paidW=await call('request_my_reward_withdrawal',[key(),paidQuote]);
 await actor(admin);await call('manage_reward_withdrawal',[paidW.id,key(),'claim',1,{}]);const paidKey=key(),paidDetails={transfer_date:'2026-10-13',reference:'mock-paid-reference',amount:Number(paidQuote.net_amount)};
 await call('manage_reward_withdrawal',[paidW.id,paidKey,'paid',2,paidDetails]);await call('manage_reward_withdrawal',[paidW.id,paidKey,'paid',2,paidDetails]);
 const paidEvents=await one("select count(*)::int n,max(payload->>'transfer_date') date,max((payload->>'transferred_amount')::bigint) amount from public.instructor_reward_notification_outbox where withdrawal_id=$1 and event_type='paid'",[paidW.id]);assert.equal(paidEvents.n,1);assert.equal(paidEvents.date,'2026-10-13');assert.equal(Number(paidEvents.amount),Number(paidQuote.net_amount));
 await run();assert.equal((await one("select count(*)::int n from public.instructor_reward_reconciliation_findings where present and rule not in('payment_unknown')")).n,0);
 await db.exec('set role service_role');await worker();await claim();await assert.rejects(db.query('select * from public.instructor_reward_withdrawals'),e=>e.code==='42501');await assert.rejects(call('get_admin_reward_notifications',[0]),e=>e.code==='42501');await db.exec('reset role');await member();await actor(admin);
 if(process.env.EMBEDDED_POSTGRES_MODULE){
 // Fresh jobs ensure the worker race cannot pass vacuously with two empty lists.
 await call('retry_reward_notification',[line.id,key(),true,'併發補發一']);await call('retry_reward_notification',[line.id,key(),true,'併發補發二']);
 const left=await db.connect(),right=await db.connect();for(const client of[left,right])await client.query("select set_config('test.role','service_role',false)");
 await left.query('begin');const first=await left.query("select public.claim_reward_notifications(1,array['admin@example.test']) q");assert.equal(first.rows[0].q.length,1);
 const second=await right.query("select public.claim_reward_notifications(20,array['admin@example.test']) q");assert.ok(second.rows[0].q.length>0);
 const ids=[...first.rows[0].q,...second.rows[0].q].map(j=>j.id);assert.equal(new Set(ids).size,ids.length);await left.query('commit');
 // Reader sees a consistent before/after view of income while writer holds its
 // financial transaction uncommitted; no half-wallet mismatch gets recorded.
 await actor(student);const ix=[{product_id:1,variant_id:1,qty:10}],iq=await ordinaryQuote(ix),io=await ordinaryCreate(ix,iq);await actor(admin);await db.query('select public.confirm_admin_instructor_reward_payment($1,true)',[io.order_id]);
 await left.query('begin');await left.query("update public.orders set status='delivered' where id=$1",[io.order_id]);
 assert.equal((await right.query('select public.run_reward_reconciliation($1) q',[key()])).rows[0].q.status,'complete');assert.equal((await one("select count(*)::int n from public.instructor_reward_reconciliation_findings where present and rule='account_ledger'")).n,0);await left.query('commit');
 await right.query('select public.run_reward_reconciliation($1)',[key()]);assert.equal((await one("select count(*)::int n from public.instructor_reward_reconciliation_findings where present and rule='account_ledger'")).n,0);
 await actor(teacher);const debtQuote=await call('quote_my_reward_withdrawal'),debtW=await call('request_my_reward_withdrawal',[key(),debtQuote]);await status(io.order_id,'returned');assert.ok(Number((await c.account()).balance)<0);
 await actor(admin);await run();assert.equal((await one("select count(*)::int n from public.instructor_reward_reconciliation_findings where present and rule in('account_ledger','account_projections')")).n,0);
 await call('manage_reward_withdrawal',[debtW.id,key(),'claim',1,{}]);await call('manage_reward_withdrawal',[debtW.id,key(),'failed',2,{reason:'isolated unpaid',confirmed_unpaid:true}]);
 assert.equal((await one('select deadlocks::int n from pg_stat_database where datname=current_database()')).n,0);
 }
 await db.exec(read('supabase-instructor-reward-notifications.sql'));await db.exec(read('supabase-instructor-reward-reconciliation.sql'));
 // Fully settled real teacher can be deleted: remove notification contacts,
 // preserve UUID/event/financial history and revoke any outstanding lease.
 assert.equal(Number((await c.account()).balance),0);
 await db.query('delete from auth.users where id=$1',[teacher]);
 assert.equal((await one("select count(*)::int n from public.instructor_reward_notification_outbox where user_id=$1 and audience='teacher' and(targets is not null or recipient_mask is not null or lease_token is not null)",[teacher])).n,0);
 assert.ok((await one('select count(*)::int n from public.instructor_reward_notification_outbox where user_id=$1',[teacher])).n>0);
 await run();
 await db.exec('update public.student_pricing_feature_settings set enabled=false');
 const verification=await db.exec(read('supabase-instructor-reward-operations-verify.sql'));
 const checked=Array.isArray(verification)?verification.find(v=>v.rows?.[0]?.verification):verification;
 for(const [name,value]of Object.entries(checked.rows[0].verification))assert.equal(value,true,name);
 console.log('PASS stage 6 atomic events, immutable payloads, downgrade delivery, fencing/recovery, fallback, masked RPC, reconciliation and idempotency');
}));
