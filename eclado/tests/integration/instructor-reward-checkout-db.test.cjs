const {test}=require('node:test');const assert=require('node:assert/strict');
const {runStudentPricingDatabaseScenario}=require('./student-pricing-db.test.cjs');
test('4: double wallet pricing, lifecycle and authoritative gateway contracts',
 {skip:!process.env.PGLITE_MODULE&&!process.env.EMBEDDED_POSTGRES_MODULE,timeout:180000},()=>
 runStudentPricingDatabaseScenario(async({db,read,fn,one,actor,student,teacher,ordinaryQuote,ordinaryCreate,base,quote})=>{
 const admin='11111111-1111-4111-8111-111111111111';await actor(admin);
 await db.exec(`insert into auth.users values('${teacher}'),('44444444-4444-4444-8444-444444444444');
 alter table public.profiles add constraint test_wallet_profile_auth foreign key(id) references auth.users(id) on delete cascade;
 alter table public.orders add constraint test_wallet_order_auth foreign key(user_id) references auth.users(id) on delete set null;`);
 const shipping=read('supabase-professional-shipping-groups.sql');await db.exec(shipping.slice(shipping.indexOf('create table'),shipping.indexOf('create or replace function')));
 for(const name of ['is_professional_shipping_role','is_shipping_group_valid_order_status','shipping_group_effective_amount'])await db.exec(fn('supabase-professional-shipping-groups.sql',name));
 await db.exec('alter table public.orders add column paid_at timestamptz');
 await db.exec(fn('supabase-member-quarterly-sales.sql','set_order_first_paid_at'));
 await db.exec('create trigger test_original_wallet_paid_at before insert or update of status on public.orders for each row execute function public.set_order_first_paid_at()');
 await db.exec(read('supabase-student-reward-snapshots.sql'));await db.exec(read('supabase-instructor-reward-ledger.sql'));await db.exec(read('supabase-instructor-reward-queries.sql'));
 await db.query("select public.save_instructor_student_binding($1,$2,null,'bind')",[student,teacher]);await db.exec('update public.student_pricing_feature_settings set enabled=true');
 // Seed real income through student purchases, never raw balance edits.
 await actor(student);const si=[{product_id:1,variant_id:1,qty:50}];const sq=await ordinaryQuote(si);const income=await ordinaryCreate(si,sq);
 await actor(admin);await db.query('select public.confirm_admin_instructor_reward_payment($1,true)',[income.order_id]);await db.query("update public.orders set status='delivered' where id=$1",[income.order_id]);
 await db.exec(read('supabase-payment-rpc-access-hardening.sql'));
 await db.exec(read('supabase-instructor-reward-checkout.sql'));
 const items=[{product_id:1,variant_id:1,qty:10}];
 const walletQuote=(sc=0,rc=0)=>one("select public.quote_order_with_wallets($1::jsonb,'delivery','','',$2::bigint,$3::bigint) q",[JSON.stringify(items),sc,rc]).then(r=>r.q);
 const create=(sc,rc,q)=>one(`select public.create_order_with_wallets($1::jsonb,'老師','隔離地址','0900000000','teacher@example.test','','card','delivery','','personal',null,null,$2::bigint,$3::bigint,$4::jsonb) q`,[JSON.stringify(items),sc,rc,JSON.stringify(q)]).then(r=>r.q);
 const account=()=>one('select * from public.instructor_reward_accounts where user_id=$1',[teacher]);
 const state=id=>one('select * from public.instructor_reward_reservations where order_id=$1',[id]);
 const status=(id,value)=>db.query('update public.orders set status=$2 where id=$1',[id,value]);
 const bank=async(id,provider=id)=>{await db.query("select set_config('test.role','service_role',false)");try{return (await one("select public.record_verified_reward_wallet_payment($1,$2,'order_query',(select payment_amount from public.orders where id=$1)) q",[id,provider])).q;}finally{await db.query("select set_config('test.role','authenticated',false)");}};
 const fail=async(id,provider=id)=>{await db.query("select set_config('test.role','service_role',false)");try{return await db.query('select public.record_reward_credit_payment_failure($1,$2)',[id,provider]);}finally{await db.query("select set_config('test.role','authenticated',false)");}};
 const consistent=async()=>{const a=await account();const totals=await one('select sum(balance_delta)::bigint b,sum(pending_delta)::bigint p,sum(reserved_delta)::bigint r from public.instructor_reward_ledger where instructor_id=$1',[teacher]);assert.equal(Number(a.balance),Number(totals.b));assert.equal(Number(a.pending_balance),Number(totals.p));assert.equal(Number(a.reserved_balance),Number(totals.r));};
 await db.exec(fn('supabase-shopping-credit-foundation.sql','adjust_member_shopping_credit'));
 await actor(admin);await db.query("select public.adjust_member_shopping_credit($1,'grant',1000,'other','isolated fixture','99999999-9999-4999-8999-999999999999')",[teacher]);
 await actor(teacher);const initial=Number((await account()).balance);assert.ok(initial>1000);
 // Exact NT$1 floor with no shipping, using the original custom-order pickup path.
 await db.exec('begin');await db.exec('update public.product_variants set is_custom_order=true where id=1');
 const pick=(await one("select public.quote_order_with_wallets($1::jsonb,'onsite_pickup','','',300::bigint,5299::bigint) q",[JSON.stringify(items)])).q;
 assert.equal(Number(pick.payment_amount),1);
 const oneDollar=(await one(`select public.create_order_with_wallets($1::jsonb,'老師','','0900000000','teacher@example.test','','card','onsite_pickup','','personal',null,null,300::bigint,5299::bigint,$2::jsonb) q`,[JSON.stringify(items),JSON.stringify(pick)])).q;
 assert.equal(Number(oneDollar.payment_amount),1);await db.exec('rollback');
 await actor(admin);await assert.rejects(quote({...base,reward_credit_amount:1}),e=>e.code==='42501');
 await actor(teacher);
 // Canonical promotions/coupon engines run before the shared merchandise cap.
 await db.exec("update public.promotions set active=true where id='10000000-0000-4000-8000-000000000001'");
 const promotional=await walletQuote();assert.ok(Number(promotional.discount)>0);
 assert.equal(Number(promotional.wallet_maximum),Math.min(Number(promotional.subtotal)-Number(promotional.discount),Number(promotional.total)-1));
 await db.exec("update public.promotions set active=false");
 await db.query("insert into public.coupon_campaign_members(coupon_campaign_id,user_id) values('20000000-0000-4000-8000-000000000001',$1)",[teacher]);
 await db.exec("update public.coupon_campaigns set per_member_limit=100;update public.promotions set active=true where id='10000000-0000-4000-8000-000000000003'");
 const coupon=(await one("select public.quote_order_with_wallets($1::jsonb,'delivery','ONLY','',0::bigint,0::bigint) q",[JSON.stringify(items)])).q;
 assert.equal(Number(coupon.discount),50);assert.equal(Number(coupon.wallet_maximum),Math.min(Number(coupon.subtotal)-50,Number(coupon.total)-1));
 await db.exec("update public.promotions set active=false");
 const half=Math.floor(initial/2);const allA=await create(0,half,await walletQuote(0,half)),allB=await create(0,initial-half,await walletQuote(0,initial-half));
 assert.equal(Number((await account()).balance),0);assert.equal(Number((await account()).reserved_balance),initial);
 await assert.rejects(db.query('delete from auth.users where id=$1',[teacher]),/reward balance or pending/);
 await status(allA.order_id,'cancelled');await status(allB.order_id,'cancelled');await consistent();
 const financialSnapshot=()=>one(`select (select count(*) from public.orders)::int orders,
   (select count(*) from public.order_payment_authorizations)::int authorizations,
   (select count(*) from public.instructor_reward_ledger)::int ledger,
   (select available_balance from public.shopping_credit_accounts where user_id=$1) sc,
   (select balance from public.instructor_reward_accounts where user_id=$1) rc`,[teacher]);
 const beforeRollback=await financialSnapshot();
 await db.exec("create function public.test_wallet_insert_failure() returns trigger language plpgsql as $$begin if new.event_type='spend_reserve' then raise exception 'isolated reserve failure';end if;return new;end$$;create trigger test_wallet_failure before insert on public.instructor_reward_ledger for each row execute function public.test_wallet_insert_failure()");
 await assert.rejects(create(100,300,await walletQuote(100,300)),/isolated reserve failure/);
 assert.deepEqual(await financialSnapshot(),beforeRollback);
 await db.exec('drop trigger test_wallet_failure on public.instructor_reward_ledger;drop function public.test_wallet_insert_failure()');
 let q=await walletQuote(0,300);const first=await create(0,300,q);assert.equal(Number(first.payment_amount)+300,Number(first.total));assert.equal((await state(first.order_id)).status,'reserved');await consistent();
 await assert.rejects(db.query('delete from auth.users where id=$1',[teacher]),/reward balance or pending/);
 await db.query('update public.orders set paid_at=now() where id=$1',[first.order_id]);
 await assert.rejects(status(first.order_id,'paid'),/有效收款/);
 await db.query("select set_config('test.role','service_role',false)");
 await assert.rejects(db.query("select public.record_verified_instructor_reward_payment($1,$1,'order_query')",[first.order_id]),/amount verification/);
 await assert.rejects(db.query("select public.record_verified_reward_wallet_payment($1,$1,'order_query',999999)",[first.order_id]),e=>e.code==='23514');
 await db.query("select set_config('test.role','authenticated',false)");
 await bank(first.order_id);await bank(first.order_id);await status(first.order_id,'paid');assert.equal((await state(first.order_id)).status,'consumed');
 await status(first.order_id,'returned');await status(first.order_id,'returned');assert.equal((await state(first.order_id)).status,'refunded');assert.equal(Number((await account()).balance),initial);await consistent();
 const plain=await create(0,0,await walletQuote());assert.equal(Number(plain.reward_credit_amount),0);await status(plain.order_id,'cancelled');await db.query('delete from public.order_payment_authorizations where order_id=$1',[plain.order_id]);await db.query('delete from public.orders where id=$1',[plain.order_id]);
 const scOnly=await create(100,0,await walletQuote(100,0));assert.equal(Number(scOnly.payment_amount)+100,Number(scOnly.total));await status(scOnly.order_id,'cancelled');
 const expired=await create(100,300,await walletQuote(100,300));
 await db.query("update public.orders set payment_due_at=now()-interval '1 minute' where id=$1",[expired.order_id]);
 await status(expired.order_id,'cancelled');await status(expired.order_id,'cancelled');
 assert.equal((await state(expired.order_id)).status,'released');
 assert.equal((await one("select reason_code from public.instructor_reward_ledger where order_id=$1 and event_type='spend_release'",[expired.order_id])).reason_code,'order_expired');await consistent();
 const dual=await create(100,300,await walletQuote(100,300));assert.equal(Number(dual.payment_amount)+100+300,Number(dual.total));
 await bank(dual.order_id);await status(dual.order_id,'paid');await status(dual.order_id,'returned');
 assert.equal(Number((await one('select available_balance from public.shopping_credit_accounts where user_id=$1',[teacher])).available_balance),1000);
 await assert.rejects(create(100,300,{...await walletQuote(100,300),payment_amount:1}),e=>e.code==='40001');
 const retryOrder=await create(100,300,await walletQuote(100,300));
 await db.query("insert into public.order_payment_instructions(order_id,payment_method,payment_state,provider_order_no,attempt_no) values($1,'card','failed',$1,1)",[retryOrder.order_id]);
 await fail(retryOrder.order_id);
 assert.equal((await state(retryOrder.order_id)).status,'released');
 assert.equal((await one('select status from public.shopping_credit_order_reservations where order_id=$1',[retryOrder.order_id])).status,'reserved');
 await db.query("select set_config('test.role','service_role',false)");
 const retry=(await one('select public.begin_order_payment_retry($1) q',[retryOrder.order_id])).q;
 assert.equal((await state(retryOrder.order_id)).cycle,2);
 const auth=(await one('select public.claim_order_payment($1,$2) q',[retryOrder.order_id,retry.payment_token])).q;
 assert.equal(Number(auth.total),Number(retryOrder.payment_amount));
 await assert.rejects(db.query('select public.begin_order_payment_retry($1)',[retryOrder.order_id]),e=>e.code==='55P03');
 await db.query("select set_config('test.role','authenticated',false)");
 await fail(retryOrder.order_id,retryOrder.order_id);assert.equal((await state(retryOrder.order_id)).status,'reserved');
 await bank(retryOrder.order_id,retry.provider_order_no);await status(retryOrder.order_id,'paid');await status(retryOrder.order_id,'cancelled');await consistent();
 const boundary=await walletQuote();const max=Number(boundary.wallet_maximum);q=await walletQuote(0,max);assert.equal(Number(q.payment_amount),Number(q.total)-max);assert.ok(Number(q.payment_amount)>=1);
 await assert.rejects(walletQuote(0,max+1),e=>e.code==='22003');await assert.rejects(walletQuote(0,-1),e=>e.code==='22023');
 const pending=await create(0,300,await walletQuote(0,300));await fail(pending.order_id);await fail(pending.order_id);assert.equal((await state(pending.order_id)).status,'released');
 const late=await bank(pending.order_id);assert.equal(late.payment_blocked,true);assert.equal((await state(pending.order_id)).status,'released');await assert.rejects(status(pending.order_id,'paid'),/人工處理/);await status(pending.order_id,'cancelled');await consistent();
 const held=await create(0,300,await walletQuote(0,300));await db.query("update public.profiles set role='pro' where id=$1",[teacher]);await assert.rejects(walletQuote(0,1),e=>e.code==='42501');await bank(held.order_id);assert.equal((await state(held.order_id)).status,'consumed');await status(held.order_id,'paid');await status(held.order_id,'cancelled');
 for(const role of ['consumer','pending','pro','distributor','staff']){await db.query('update public.profiles set role=$1 where id=$2',[role,teacher]);await assert.rejects(walletQuote(0,1),e=>e.code==='42501');}
 await db.query("update public.profiles set role='instructor' where id=$1",[teacher]);
 await assert.rejects(db.query("update public.orders set reward_credit_amount=1 where id=$1",[held.order_id]),/immutable|locked/);
 // Actual income reversal while a purchase is held creates debt; the existing
 // hold remains valid. All mutations flow through Ledger functions.
 const debtOrder=await create(0,300,await walletQuote(0,300));
 await status(income.order_id,'returned');assert.equal(Number((await account()).balance),-300);
 await assert.rejects(walletQuote(0,1),e=>e.code==='22003');
 await bank(debtOrder.order_id);await status(debtOrder.order_id,'paid');assert.equal((await state(debtOrder.order_id)).status,'consumed');
 await actor(student);const newItems=[{product_id:1,variant_id:1,qty:10}];const newQuote=await ordinaryQuote(newItems);const newIncome=await ordinaryCreate(newItems,newQuote);
 await actor(admin);await db.query('select public.confirm_admin_instructor_reward_payment($1,true)',[newIncome.order_id]);await status(newIncome.order_id,'delivered');
 assert.ok(Number((await account()).balance)>0);await status(newIncome.order_id,'returned');await status(debtOrder.order_id,'returned');await actor(teacher);await consistent();
 if(process.env.EMBEDDED_POSTGRES_MODULE){
  await actor(student);const fundsItems=[{product_id:1,variant_id:1,qty:30}];const fundsQuote=await ordinaryQuote(fundsItems);const fundsIncome=await ordinaryCreate(fundsItems,fundsQuote);
  await actor(admin);await db.query('select public.confirm_admin_instructor_reward_payment($1,true)',[fundsIncome.order_id]);await status(fundsIncome.order_id,'delivered');await actor(teacher);
  const left=await db.connect(),right=await db.connect();
  for(const client of [left,right])await client.query("select set_config('test.uid',$1,false),set_config('test.access','admin',false)",[teacher]);
  const createSql=`select public.create_order_with_wallets($1::jsonb,'老師','隔離地址','0900000000','teacher@example.test','','card','delivery','','personal',null,null,$2::bigint,$3::bigint,$4::jsonb) q`;
  const createArgs=(sc,rc,q)=>[JSON.stringify(items),sc,rc,JSON.stringify(q)];
  const common=await walletQuote(100,3500);
  const competitors=await Promise.allSettled([left,right].map(c=>c.query(createSql,createArgs(100,3500,common))));
  assert.equal(competitors.filter(r=>r.status==='fulfilled').length,1);
  const winning=competitors.find(r=>r.status==='fulfilled').value.rows[0].q;
  await status(winning.order_id,'cancelled');await consistent();
  const race=await create(100,300,await walletQuote(100,300));
  await left.query("select set_config('test.role','service_role',false)");
  await Promise.all([left.query("select public.record_verified_reward_wallet_payment($1,$1,'order_query',(select payment_amount from public.orders where id=$1))",[race.order_id]),right.query("update public.orders set status='cancelled' where id=$1",[race.order_id])]);
  assert.ok(['released','refunded'].includes((await state(race.order_id)).status));await consistent();
  const retryRace=await create(100,300,await walletQuote(100,300));
  await db.query("insert into public.order_payment_instructions(order_id,payment_method,payment_state,provider_order_no,attempt_no) values($1,'card','failed',$1,1)",[retryRace.order_id]);await fail(retryRace.order_id);
  await right.query("select set_config('test.role','service_role',false)");
  const rr=await Promise.allSettled([left.query('select public.begin_order_payment_retry($1)',[retryRace.order_id]),right.query("select public.record_verified_reward_wallet_payment($1,$1,'order_query',(select payment_amount from public.orders where id=$1))",[retryRace.order_id])]);
  assert.equal(rr[1].status,'fulfilled');if(rr[0].status==='rejected')assert.equal(rr[0].reason.code,'55000');
  await status(retryRace.order_id,'cancelled');await consistent();
  // A pending student income races a fresh consumption order. Either the quote
  // is still current or it is rejected atomically with 40001.
  await actor(student);const moreItems=[{product_id:1,variant_id:1,qty:10}];const moreQuote=await ordinaryQuote(moreItems);const more=await ordinaryCreate(moreItems,moreQuote);
  await actor(admin);await db.query('select public.confirm_admin_instructor_reward_payment($1,true)',[more.order_id]);await actor(teacher);
  const beforeCredit=await walletQuote(0,300);
  const cr=await Promise.allSettled([left.query("update public.orders set status='delivered' where id=$1",[more.order_id]),right.query(createSql,createArgs(0,300,beforeCredit))]);
  assert.equal(cr[0].status,'fulfilled');if(cr[1].status==='fulfilled')await status(cr[1].value.rows[0].q.order_id,'cancelled');else assert.equal(cr[1].reason.code,'40001');await consistent();
  const beforeReverse=await walletQuote(0,300);
  const rev=await Promise.allSettled([left.query("update public.orders set status='returned' where id=$1",[fundsIncome.order_id]),right.query(createSql,createArgs(0,300,beforeReverse))]);
  assert.equal(rev[0].status,'fulfilled');if(rev[1].status==='fulfilled')await status(rev[1].value.rows[0].q.order_id,'cancelled');else assert.ok(['40001','22003'].includes(rev[1].reason.code));
  await status(more.order_id,'returned');await consistent();
  assert.equal((await one('select deadlocks::int n from pg_stat_database where datname=current_database()')).n,0);
  console.log('PASS PostgreSQL two-wallet reserve race, paid/cancel, retry/old callback, credit/spend and reversal/spend; deadlocks=0');
 }
 await db.exec('set role authenticated');
 await assert.rejects(db.query("select public.reward_credit_event($1,'reserve')",[held.order_id]),e=>e.code==='42501');
 await assert.rejects(db.query('select * from public.instructor_reward_reservations'),e=>e.code==='42501');
 await assert.rejects(db.query('select * from public.instructor_reward_payment_exceptions'),e=>e.code==='42501');
 await db.exec('reset role');await db.exec('set role anon');await assert.rejects(db.query('select public.get_my_reward_credit()'),e=>e.code==='42501');await db.exec('reset role');
 await db.exec(read('supabase-instructor-reward-checkout.sql')); // Same-version rerun preserves financial history.
 await consistent();await db.exec('update public.student_pricing_feature_settings set enabled=false');
 const verification=await db.exec(read('supabase-instructor-reward-checkout-verify.sql'));
 const row=Array.isArray(verification)?verification.find(v=>v.rows?.[0]?.verification):verification;
 for(const [name,value]of Object.entries(row.rows[0].verification))assert.equal(value,true,name);
 console.log('PASS stage 4 reserve/consume/refund, late success exceptions, role downgrade, caps and bank amount contract');
 }));
