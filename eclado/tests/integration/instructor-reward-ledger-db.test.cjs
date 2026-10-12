const {test}=require('node:test');const assert=require('node:assert/strict');
const {runStudentPricingDatabaseScenario}=require('./student-pricing-db.test.cjs');
test('2B: reward ledger, verified evidence, terminal lifecycle and concurrent reconciliation',
  {skip:!process.env.PGLITE_MODULE&&!process.env.EMBEDDED_POSTGRES_MODULE,timeout:180000},()=>
  runStudentPricingDatabaseScenario(async({db,read,fn,one,actor,student,teacher,base,create,quote,ordinaryQuote,ordinaryCreate})=>{
    const admin='11111111-1111-4111-8111-111111111111';
    await actor(admin);
    await db.exec(`insert into auth.users values('33333333-3333-4333-8333-333333333333'),('44444444-4444-4444-8444-444444444444');
      alter table public.profiles add constraint test_profile_auth_fk foreign key(id) references auth.users(id) on delete cascade;
      alter table public.orders add constraint test_order_auth_fk foreign key(user_id) references auth.users(id) on delete set null;`);
    const shipping=read('supabase-professional-shipping-groups.sql');
    await db.exec(shipping.slice(shipping.indexOf('create table'),shipping.indexOf('create or replace function')));
    for(const name of ['is_professional_shipping_role','is_shipping_group_valid_order_status','shipping_group_effective_amount'])
      await db.exec(fn('supabase-professional-shipping-groups.sql',name));
    await db.exec('alter table public.orders add column paid_at timestamptz');
    await db.exec(fn('supabase-member-quarterly-sales.sql','set_order_first_paid_at'));
    await db.exec('create trigger test_original_paid_at before insert or update of status on public.orders for each row execute function public.set_order_first_paid_at()');
    await db.exec(read('supabase-student-reward-snapshots.sql'));
    const before=await one(`select md5(string_agg(p.oid::regprocedure::text||pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),E'\n' order by p.oid::regprocedure::text)) h
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'`);
    await db.exec(read('supabase-instructor-reward-ledger.sql'));
    await db.query("select public.save_instructor_student_binding($1,$2,null,'bind')",[student,teacher]);
    const state=id=>one('select * from public.instructor_reward_order_states where order_id=$1',[id]);
    const account=()=>one('select * from public.instructor_reward_accounts where user_id=$1',[teacher]);
    const events=id=>db.query('select event_type,balance_delta,pending_delta from public.instructor_reward_ledger where order_id=$1 order by id',[id]).then(r=>r.rows);
    const status=(id,value)=>db.query('update public.orders set status=$2 where id=$1',[id,value]);
    const manual=id=>db.query('select public.confirm_admin_instructor_reward_payment($1,true)',[id]);
    const bank=async id=>{
      await db.query("select set_config('test.role','service_role',false)");
      try{return await db.query("select public.record_verified_instructor_reward_payment($1,$1,'order_query')",[id]);}
      finally{await db.query("select set_config('test.role','authenticated',false)");}
    };
    const ordinary=async(credit=0)=>{
      await actor(student);const items=[{product_id:1,variant_id:1,qty:10}];
      const q=await ordinaryQuote(items);const result=await ordinaryCreate(items,q,credit);
      await actor(admin);return result;
    };
    const consistent=async()=>{
      const a=await account();const sums=await one('select coalesce(sum(balance_delta),0)::bigint b,coalesce(sum(pending_delta),0)::bigint p from public.instructor_reward_ledger where instructor_id=$1',[teacher]);
      assert.equal(Number(a?.balance||0),Number(sums.b));assert.equal(Number(a?.pending_balance||0),Number(sums.p));
    };
    const off=await ordinary();assert.equal(await state(off.order_id),undefined);
    await db.exec('update public.student_pricing_feature_settings set enabled=true');
    const first=await ordinary(100);const firstState=await state(first.order_id);const amount=Number(firstState.amount);
    assert.equal(Number(first.payment_amount)+Number(first.shopping_credit_amount),Number(first.total));
    assert.ok(amount>0);assert.equal(firstState.status,'pending');assert.equal(Number((await account()).balance),0);
    assert.deepEqual((await events(first.order_id)).map(e=>e.event_type),['pending']);
    // paid_at and even paid payment-table state are not sufficient proof.
    await status(first.order_id,'delivered');
    assert.ok((await one('select paid_at from public.orders where id=$1',[first.order_id])).paid_at);
    await db.query("insert into public.order_payment_instructions(order_id,payment_method,payment_state,provider_order_no) values($1,'card','paid',$1)",[first.order_id]);
    assert.equal((await state(first.order_id)).status,'pending');
    await assert.rejects(db.query("select public.record_verified_instructor_reward_payment($1,$1,'order_query')",[first.order_id]),e=>e.code==='42501');
    await bank(first.order_id);assert.equal((await state(first.order_id)).status,'credited');
    assert.equal(Number((await one('select amount from public.instructor_reward_payment_receipts where order_id=$1',[first.order_id])).amount),Number(first.payment_amount));
    await bank(first.order_id);await status(first.order_id,'delivered');
    assert.deepEqual((await events(first.order_id)).map(e=>e.event_type),['pending','credit']);await consistent();
    await status(first.order_id,'returned');await status(first.order_id,'returned');await bank(first.order_id);
    assert.equal((await state(first.order_id)).status,'reversed');
    assert.deepEqual((await events(first.order_id)).map(e=>e.event_type),['pending','credit','reverse']);await consistent();
    await assert.rejects(status(first.order_id,'paid'),/cannot reopen/);
    // Payment before fulfillment, and fulfillment before manual confirmation.
    const second=await ordinary();await bank(second.order_id);assert.equal((await state(second.order_id)).status,'pending');
    await status(second.order_id,'delivered');assert.equal((await state(second.order_id)).status,'credited');
    const third=await ordinary();await status(third.order_id,'delivered');await manual(third.order_id);await manual(third.order_id);
    assert.equal((await state(third.order_id)).status,'credited');
    const receipt=await one('select * from public.instructor_reward_payment_receipts where order_id=$1',[third.order_id]);
    assert.equal(receipt.actor_user_id,admin);assert.equal(Number(receipt.amount),Number(third.payment_amount));
    const fault=await ordinary();await status(fault.order_id,'delivered');
    const faultAccount=await account();
    await db.exec(`create function public.test_fail_reward_credit() returns trigger language plpgsql as $$begin
      if new.event_type='credit' then raise exception 'isolated ledger write failure';end if;return new;end$$;
      create trigger test_fail_reward_credit before insert on public.instructor_reward_ledger for each row execute function public.test_fail_reward_credit();`);
    await assert.rejects(bank(fault.order_id),/isolated ledger write failure/);
    assert.deepEqual(await account(),faultAccount);assert.equal((await state(fault.order_id)).status,'pending');
    assert.equal(await one('select * from public.instructor_reward_payment_receipts where order_id=$1',[fault.order_id]),undefined);
    await db.exec('drop trigger test_fail_reward_credit on public.instructor_reward_ledger;drop function public.test_fail_reward_credit()');
    await bank(fault.order_id);await status(fault.order_id,'returned');await consistent();
    const cancelled=await ordinary();await status(cancelled.order_id,'cancelled');await bank(cancelled.order_id);
    assert.equal((await state(cancelled.order_id)).status,'cancelled');
    assert.deepEqual((await events(cancelled.order_id)).map(e=>e.event_type),['pending','cancel']);
    await assert.rejects(status(cancelled.order_id,'paid'),/cannot reopen/);await consistent();
    // Existing shipping/pickup paths are distinct; incorrect completion status
    // never releases rewards. The original pickup validator remains in force.
    await db.exec('update public.product_variants set is_custom_order=true where id=1');
    const payload={...base,fulfillment_method:'onsite_pickup',apply_automatic:false,items:[{...base.items[0],price_mode:'MANUAL',unit_price:777}]};
    const pickup=await create('30000000-0000-4000-8000-000000000001',payload);
    await manual(pickup.order_id);await status(pickup.order_id,'delivered');assert.equal((await state(pickup.order_id)).status,'pending');
    await status(pickup.order_id,'picked_up');assert.equal((await state(pickup.order_id)).status,'credited');
    await status(pickup.order_id,'cancelled');assert.equal((await state(pickup.order_id)).status,'reversed');
    await db.exec('update public.product_variants set is_custom_order=false where id=1');
    await consistent();

    for(const role of ['anon','authenticated','service_role']){
      await db.exec(`set role ${role}`);
      for(const table of ['accounts','order_states','ledger','payment_receipts']){
        await assert.rejects(db.query('select * from public.instructor_reward_'+table),e=>e.code==='42501');
        await assert.rejects(db.query('truncate public.instructor_reward_'+table),e=>e.code==='42501');
      }
      await assert.rejects(db.query("select public.append_instructor_reward_event($1,'credit')",[first.order_id]),e=>e.code==='42501');
      await db.exec('reset role');
    }
    await actor(student);
    await assert.rejects(manual(third.order_id),e=>e.code==='42501');
    await actor(admin);
    await assert.rejects(db.query('delete from public.instructor_reward_ledger where order_id=$1',[first.order_id]),/immutable/);
    await assert.rejects(db.query("update public.instructor_reward_payment_receipts set amount=1 where order_id=$1",[first.order_id]),/immutable/);
    await assert.rejects(db.query('delete from auth.users where id=$1',[teacher]),/reward balance or pending/);
    // Negative-balance arithmetic is tested with an isolated fixture simulating
    // prior wallet use (stage 4/5 is NOT implemented here). A clean-ledger
    // reconciliation was asserted above; this direct owner-only seed is not a
    // supported API and is not counted as a real spending implementation.
    await db.exec('begin');
    await db.query('update public.instructor_reward_accounts set balance=0 where user_id=$1',[teacher]);
    async function negativeDeletionRejected(){
      await db.exec('savepoint negative_delete_guard');
      await assert.rejects(db.query('delete from auth.users where id=$1',[teacher]),/reward balance or pending/);
      await db.exec('rollback to savepoint negative_delete_guard;release savepoint negative_delete_guard');
    }
    await status(second.order_id,'returned');assert.equal(Number((await account()).balance),-amount);
    await negativeDeletionRejected();
    const future=await ordinary();
    await negativeDeletionRejected();
    await bank(future.order_id);await status(future.order_id,'delivered');
    assert.equal(Number((await account()).balance),0);
    // Roll back the complete simulated future-wallet scenario; no fabricated
    // outflow or inconsistent balance_after is retained in the real test ledger.
    await db.exec('rollback');
    await consistent();

    if(db.connect){
      const left=await db.connect(),right=await db.connect();
      for(const client of [left,right])await client.query("select set_config('test.uid',$1,false),set_config('test.access','admin',false),set_config('test.role','service_role',false)",[admin]);
      const race=await ordinary();
      await Promise.all([left.query("select public.record_verified_instructor_reward_payment($1,$1,'order_query')",[race.order_id]),
        right.query("update public.orders set status='delivered' where id=$1",[race.order_id])]);
      assert.equal((await state(race.order_id)).status,'credited');
      await Promise.all([left,right].map(c=>c.query("update public.orders set status='returned' where id=$1",[race.order_id])));
      assert.deepEqual((await events(race.order_id)).map(e=>e.event_type),['pending','credit','reverse']);
      const cancelRace=await ordinary();
      await Promise.all([left.query("select public.record_verified_instructor_reward_payment($1,$1,'order_query')",[cancelRace.order_id]),
        right.query("update public.orders set status='cancelled' where id=$1",[cancelRace.order_id])]);
      assert.equal((await state(cancelRace.order_id)).status,'cancelled');
      const differentOrders=[await ordinary(),await ordinary()];
      await Promise.all(differentOrders.map((o,i)=>[left,right][i].query("select public.record_verified_instructor_reward_payment($1,$1,'order_query')",[o.order_id])));
      await Promise.all(differentOrders.map((o,i)=>[left,right][i].query("update public.orders set status='delivered' where id=$1",[o.order_id])));
      await consistent();
      await Promise.all(differentOrders.map((o,i)=>[left,right][i].query("update public.orders set status='returned' where id=$1",[o.order_id])));
      await consistent();
      // Auth deletion waits on the same parent-first lock held by a real new
      // order, then sees the committed pending liability and refuses deletion.
      await left.query("select set_config('test.uid',$1,false),set_config('test.role','authenticated',false)",[student]);
      await left.query('begin');
      const pendingItems=[{product_id:1,variant_id:1,qty:10}];
      const oq=(await left.query('select public.quote_order_pricing($1::jsonb) q',[JSON.stringify(pendingItems)])).rows[0].q;
      const newPending=(await left.query(`select public.create_order_with_pricing($1::jsonb,'學生','隔離地址','0911111111',
        'customer@example.test','','atm','delivery','','personal',null,null,0::bigint,$2::jsonb) q`,[JSON.stringify(pendingItems),JSON.stringify(oq)])).rows[0].q;
      const deletion=right.query('delete from auth.users where id=$1',[teacher]);
      const deleteRejected=assert.rejects(deletion,/reward balance or pending/);
      const pid=(await left.query('select pg_backend_pid() pid')).rows[0].pid;
      for(let attempt=0;attempt<100;attempt++){
        const waits=await left.query('select count(*)::int n from pg_stat_activity where $1=any(pg_blocking_pids(pid))',[pid]);
        if(waits.rows[0].n)break;
        await new Promise(resolve=>setTimeout(resolve,10));if(attempt===99)throw new Error('Expected Auth DELETE lock wait');
      }
      await left.query('commit');await deleteRejected;
      assert.equal((await state(newPending.order_id)).status,'pending');
      await status(newPending.order_id,'cancelled');
      assert.equal((await one('select deadlocks::int n from pg_stat_database where datname=current_database()')).n,0);
      await consistent();
      console.log('PASS real PostgreSQL: simultaneous receipt/fulfillment, duplicate refunds and receipt/cancel; exactly-once ledger, deadlocks=0');
    }
    // A student with only an ordinary order can be deleted while the teacher's
    // pending liability and snapshot remain; the independent assisted conflict
    // is not bypassed or repaired here.
    const deletedStudent='55555555-5555-4555-8555-555555555555';
    await db.query('insert into auth.users values($1)',[deletedStudent]);
    await db.query("insert into public.profiles(id,role,name) values($1,'pro','隔離學生')",[deletedStudent]);
    await db.query("select public.save_instructor_student_binding($1,$2,null,'bind')",[deletedStudent,teacher]);
    await actor(deletedStudent);const studentItems=[{product_id:1,variant_id:1,qty:10}];
    const studentQuote=await ordinaryQuote(studentItems);const deletedStudentOrder=await ordinaryCreate(studentItems,studentQuote);
    await actor(admin);const pendingBefore=Number((await account()).pending_balance);
    await db.query('delete from auth.users where id=$1',[deletedStudent]);
    assert.equal(Number((await account()).pending_balance),pendingBefore);
    assert.equal((await one('select student_id from public.student_reward_snapshots where order_id=$1',[deletedStudentOrder.order_id])).student_id,deletedStudent);
    await bank(deletedStudentOrder.order_id);await status(deletedStudentOrder.order_id,'delivered');await status(deletedStudentOrder.order_id,'returned');
    // Close every remaining credited obligation; zero with no pending permits
    // teacher deletion and leaves immutable UUID accounting history intact.
    const remaining=(await db.query("select order_id from public.instructor_reward_order_states where status='credited'")).rows;
    for(const row of remaining)await status(row.order_id,'returned');
    await consistent();assert.equal(Number((await account()).balance),0);assert.equal(Number((await account()).pending_balance),0);
    const historyCount=(await one('select count(*)::int n from public.instructor_reward_ledger')).n;
    await db.query('delete from auth.users where id=$1',[teacher]);
    assert.equal((await account()).status,'closed');
    assert.equal((await one('select count(*)::int n from public.instructor_reward_ledger')).n,historyCount);
    await db.exec('update public.student_pricing_feature_settings set enabled=false');
    await db.exec(read('supabase-instructor-reward-ledger.sql'));
    const verification=await db.exec(read('supabase-instructor-reward-ledger-verify.sql'));
    for(const [name,result]of Object.entries(verification[1].rows[0].verification))assert.equal(result,true,name);
    const after=await one(`select md5(string_agg(p.oid::regprocedure::text||pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),E'\n' order by p.oid::regprocedure::text)) h
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'
      and p.proname not in('reject_instructor_reward_history_changes','append_instructor_reward_event','reconcile_instructor_reward_order',
        'initialize_instructor_reward_order','guard_instructor_reward_order_lifecycle','sync_instructor_reward_order_status',
        'record_verified_instructor_reward_payment','get_admin_reward_payment_requirement','confirm_admin_instructor_reward_payment','guard_instructor_reward_member_deletion')`);
    assert.deepEqual(after,before);
    console.log('PASS 2B verified bank/admin evidence, immutable ledger, terminals, debt arithmetic, deletion guard and unchanged existing SQL');
  }));
