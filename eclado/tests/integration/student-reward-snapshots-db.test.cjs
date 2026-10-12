const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runStudentPricingDatabaseScenario}=require('./student-pricing-db.test.cjs');

test('2A: private immutable snapshots in existing ordinary/assisted transactions',
  {skip:!process.env.PGLITE_MODULE&&!process.env.EMBEDDED_POSTGRES_MODULE,timeout:180000},()=>
  runStudentPricingDatabaseScenario(async({db,read,base,create,quote,ordinaryQuote,ordinaryCreate,one,actor,student,teacher})=>{
    const admin='11111111-1111-4111-8111-111111111111';
    const capture=async()=> (await one('select public.capture_student_reward_context($1,$2::jsonb,$3) c',
      [student,JSON.stringify([{product_id:1,variant_id:1,qty:10}]),'online'])).c;
    const getSnapshot=id=>one('select * from public.student_reward_snapshots where order_id=$1',[id]);
    const items=[{product_id:1,variant_id:1,qty:10}];
    await actor(admin);
    // Match the previously inventoried Auth/profile/order FK relationships in
    // every 2A test, including the independent-session race scenarios.
    await db.exec(`insert into auth.users values('33333333-3333-4333-8333-333333333333'),('44444444-4444-4444-8444-444444444444');
      alter table public.profiles add constraint test_profile_auth_fk foreign key(id) references auth.users(id) on delete cascade;
      alter table public.orders add constraint test_order_auth_fk foreign key(user_id) references auth.users(id) on delete set null;`);
    // Install the actual legacy eight-argument forwarding overload in the
    // fixture so all currently supported storefront signatures are exercised.
    const couponSource=read('supabase-coupon-discount-engine.sql');
    const firstCreator=couponSource.indexOf('create or replace function public.create_order_with_pricing(');
    const legacyStart=couponSource.indexOf('create or replace function public.create_order_with_pricing(',firstCreator+1);
    assert.ok(legacyStart>0);
    await db.exec(couponSource.slice(legacyStart,couponSource.indexOf('$$;',legacyStart)+3));
    const untouched=await one(`select md5(string_agg(p.oid::regprocedure::text||pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),E'\n' order by p.oid::regprocedure::text)) h
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'
      and p.proname not in('create_order_with_pricing_discount_v2','create_assisted_order')`);
    await db.exec(read('supabase-student-reward-snapshots.sql'));
    await db.query("select public.save_instructor_student_binding($1,$2,null,'bind')",[student,teacher]);
    // OFF means no snapshots for either creator, even for a qualified student.
    await actor(student);const offQuote=await ordinaryQuote(items);
    const offOrder=await ordinaryCreate(items,offQuote);assert.equal(await getSnapshot(offOrder.order_id),undefined);
    await actor(admin);
    const manual={...base,apply_automatic:false,items:[{...base.items[0],price_mode:'MANUAL',unit_price:777}]};
    const offAssisted=await create('20000000-0000-4000-8000-000000000001',manual);
    assert.equal(await getSnapshot(offAssisted.order_id),undefined);
    await db.exec('update public.student_pricing_feature_settings set enabled=true');
    const expectedType=(await one('select student_price_type from public.instructor_student_settings where instructor_id=$1',[teacher])).student_price_type;
    const initialStudentPrice=expectedType==='student_1'?720:760;
    await actor(student);
    let q=await ordinaryQuote(items);const ordinary=await ordinaryCreate(items,q,100);
    const original=await getSnapshot(ordinary.order_id);
    assert.equal(original.student_id,student);assert.equal(original.instructor_id,teacher);
    assert.equal(original.student_price_type,expectedType);
    assert.equal(Number(original.total_reward),(initialStudentPrice-560)*10);
    assert.equal(original.items[0].instructor_unit_price,560);assert.equal(original.items[0].price_mode,'AUTO');
    assert.equal(original.items[0].student_unit_price,initialStudentPrice);
    assert.equal(original.items[0].basis_unit_price,initialStudentPrice);
    assert.doesNotMatch(JSON.stringify(ordinary),/instructor_unit_price|total_reward|binding_id|instructor_id/);
    assert.doesNotMatch(JSON.stringify(q),/instructor_unit_price|total_reward|binding_id|instructor_id/);
    for(const suffix of ['',",''",",'','personal',null,null",",'','personal',null,null,0::bigint"]){
      const compat=(await one(`select public.create_order_with_pricing($1::jsonb,'學生','隔離地址','0911111111',
        'customer@example.test','','atm','delivery'${suffix}) q`,[JSON.stringify(items)])).q;
      assert.equal(Number((await getSnapshot(compat.order_id)).total_reward),Number(original.total_reward));
      assert.doesNotMatch(JSON.stringify(compat),/instructor_unit_price|total_reward|binding_id|instructor_id/);
    }

    // Actual promotion/coupon/gift engines and ordinary shopping-credit tender.
    await db.exec("update public.promotions set active=true where id='10000000-0000-4000-8000-000000000001'");
    q=await ordinaryQuote(items);assert.ok(q.discount>0);
    const promotionOrder=await ordinaryCreate(items,q,100);
    assert.equal(Number((await getSnapshot(promotionOrder.order_id)).total_reward),Number(original.total_reward));
    await db.exec("update public.promotions set active=false");
    await db.exec("update public.promotions set active=true where id='10000000-0000-4000-8000-000000000002'");
    q=await ordinaryQuote(items);assert.equal(q.gifts.length,1);
    const giftOrder=await ordinaryCreate(items,q);
    const giftSnapshot=await getSnapshot(giftOrder.order_id);
    assert.equal(giftSnapshot.items.length,1);assert.equal(Number(giftSnapshot.total_reward),Number(original.total_reward));
    await db.exec("update public.promotions set active=false");
    await db.exec("update public.promotions set active=true where id='10000000-0000-4000-8000-000000000003'");
    const couponQuote=await ordinaryQuote(items,'ONLY');assert.equal(couponQuote.discount,50);
    const couponOrder=(await one(`select public.create_order_with_pricing($1::jsonb,'學生','隔離地址','0911111111',
      'customer@example.test','','atm','delivery','ONLY','personal',null,null,0::bigint,$2::jsonb) q`,
      [JSON.stringify(items),JSON.stringify(couponQuote)])).q;
    assert.equal(Number((await getSnapshot(couponOrder.order_id)).total_reward),Number(original.total_reward));
    await db.exec('update public.promotions set active=false');
    await actor(admin);
    const manualOrder=await create('20000000-0000-4000-8000-000000000002',manual);
    const manualSnapshot=await getSnapshot(manualOrder.order_id);
    assert.equal(Number(manualSnapshot.total_reward),(777-560)*2);
    assert.equal(manualSnapshot.items[0].price_mode,'MANUAL');
    assert.equal(manualSnapshot.items[0].student_unit_price,initialStudentPrice);
    assert.equal(manualSnapshot.items[0].basis_unit_price,777);
    const auto={...manual,items:[{...manual.items[0],price_mode:'AUTO',unit_price:1}]};
    const autoQ=await quote(auto);const autoOrder=await create('20000000-0000-4000-8000-000000000003',{...auto,expected_quote:autoQ.confirmation});
    assert.equal(Number((await getSnapshot(autoOrder.order_id)).total_reward),(initialStudentPrice-560)*2);
    const legacyOrder=await create('20000000-0000-4000-8000-000000000004',base);
    assert.equal(Number((await getSnapshot(legacyOrder.order_id)).total_reward),0);
    assert.equal((await getSnapshot(legacyOrder.order_id)).items[0].price_mode,'MANUAL');
    // Recovery cannot duplicate or rewrite the snapshot.
    assert.equal((await create('20000000-0000-4000-8000-000000000002',manual)).order_id,manualOrder.order_id);
    assert.deepEqual(await getSnapshot(manualOrder.order_id),manualSnapshot);

    // Per-product -> global -> 0.70 fallback; fixed pro price remains fixed.
    await db.exec('update public.products set instructor_price_multiplier=0.6 where id=1');
    assert.equal((await capture()).items[0].instructor_unit_price,480);
    await db.exec('update public.products set instructor_price_multiplier=1 where id=1');
    assert.equal((await capture()).items[0].instructor_unit_price,800);
    await db.exec('update public.products set instructor_price_multiplier=null where id=1');
    await db.exec("update public.membership_tiers set professional_price_multiplier=0.65 where role='instructor'");
    assert.equal((await capture()).items[0].instructor_unit_price,520);
    await db.exec("update public.membership_tiers set professional_price_multiplier=null where role='instructor'");
    assert.equal((await capture()).items[0].instructor_unit_price,560);
    await db.exec("update public.membership_tiers set active=false where role='instructor'");
    assert.equal((await capture()).items[0].instructor_unit_price,560);
    await db.exec("update public.membership_tiers set active=true,professional_price_multiplier=0.7 where role='instructor'");
    await db.exec('update public.product_variants set pro_price=801 where id=1');
    const rounded=await capture();assert.equal(rounded.items[0].instructor_unit_price,561);
    assert.equal(rounded.items[0].student_unit_price,expectedType==='student_1'?721:761);
    await db.exec('update public.product_variants set pro_price=800 where id=1');
    assert.equal((await one('select public.calculate_student_reward_line(500,560,2) r')).r,0);

    // Exclusion and suspension retain legacy order behavior.
    const own=await create('20000000-0000-4000-8000-000000000005',{...manual,member_id:teacher});
    assert.equal(await getSnapshot(own.order_id),undefined);
    const guest=await create('20000000-0000-4000-8000-000000000006',{...manual,customer_type:'guest',member_id:null});
    assert.equal(await getSnapshot(guest.order_id),undefined);
    await assert.rejects(db.query('update public.orders set user_id=$1 where id=$2',[student,guest.order_id]),/locked/);
    assert.equal(await getSnapshot(guest.order_id),undefined);
    await actor('');const guestQuote=await ordinaryQuote(items);
    const guestOnline=await ordinaryCreate(items,guestQuote);
    await db.query('update public.orders set user_id=$1 where id=$2',[student,guestOnline.order_id]);
    assert.equal(await getSnapshot(guestOnline.order_id),undefined);
    await actor(admin);
    await db.query("insert into public.orders(id,user_id,type,items,order_source) values('HISTORICAL-ISOLATED',$1,'pro',$2::jsonb,'historical_manual')",[student,JSON.stringify(items)]);
    assert.equal(await getSnapshot('HISTORICAL-ISOLATED'),undefined);
    for(const [member,role] of [[student,'consumer'],[teacher,'pro']]){
      await db.query('update public.profiles set role=$1 where id=$2',[role,member]);
      await actor(student);const suspendedQuote=await ordinaryQuote(items);
      const suspendedOrder=await ordinaryCreate(items,suspendedQuote);
      assert.equal(await getSnapshot(suspendedOrder.order_id),undefined);
      await db.query('update public.profiles set role=$1 where id=$2',[member===student?'pro':'instructor',member]);
    }
    await actor(admin);

    // Force snapshot insertion to fail after creator writes/reservations; all
    // original financial/inventory/request side effects must roll back as well.
    const transactionState=async()=>({
      ...(await one(`select (select count(*)::int from public.orders) orders,
        (select count(*)::int from public.student_reward_snapshots) snapshots,
        (select count(*)::int from public.assisted_order_requests) requests,
        (select count(*)::int from public.order_payment_authorizations) payments,
        (select count(*)::int from public.order_inventory_allocations) allocations,
        (select count(*)::int from public.promotion_gift_reservations) gifts,
        (select count(*)::int from public.coupon_redemptions) coupons`)),
      credit:await one('select available_balance,reserved_balance from public.shopping_credit_accounts where user_id=$1',[student]),
      stock:await one('select stock,gift_stock from public.product_variants where id=1'),
    });
    await db.exec(`create function public.test_reject_reward_snapshot() returns trigger language plpgsql as $$begin raise exception 'isolated snapshot insertion failure';end$$;
      create trigger test_reject_reward_snapshot before insert on public.student_reward_snapshots for each row execute function public.test_reject_reward_snapshot();`);
    await actor(student);q=await ordinaryQuote(items);let state=await transactionState();
    await assert.rejects(ordinaryCreate(items,q,100),/isolated snapshot insertion failure/);
    assert.deepEqual(await transactionState(),state);
    await actor(admin);state=await transactionState();
    await assert.rejects(create('20000000-0000-4000-8000-000000000007',manual),/isolated snapshot insertion failure/);
    assert.deepEqual(await transactionState(),state);
    await db.exec('drop trigger test_reject_reward_snapshot on public.student_reward_snapshots;drop function public.test_reject_reward_snapshot()');

    // Independent PostgreSQL backends: capture protects ownership, type and OFF
    // state against a concurrent writer.
    if(db.connect){
      const buyer=await db.connect(),manager=await db.connect();
      await buyer.query("select set_config('test.uid',$1,false)",[student]);
      await manager.query("select set_config('test.uid',$1,false),set_config('test.access','admin',false)",[admin]);
      async function blockedMutation(sql,args=[],expectedError=null){
        await buyer.query('begin');
        await buyer.query('select public.capture_student_reward_context($1,$2::jsonb,$3)',[student,JSON.stringify(items),'online']);
        let finished=false;
        const pending=manager.query(sql,args).then(result=>({result}),error=>({error})).finally(()=>{finished=true;});
        const pid=(await buyer.query('select pg_backend_pid() pid')).rows[0].pid;
        for(let attempt=0;attempt<100;attempt++){
          const blocked=await buyer.query('select count(*)::int n from pg_stat_activity where $1=any(pg_blocking_pids(pid))',[pid]);
          if(blocked.rows[0].n>0)break;
          await new Promise(resolve=>setTimeout(resolve,10));
          if(attempt===99)throw new Error('Expected real PostgreSQL lock wait');
        }
        assert.equal(finished,false);
        // This is the actual creator while the captured qualification is held.
        const confirmed=(await buyer.query('select public.quote_order_pricing($1::jsonb) q',[JSON.stringify(items)])).rows[0].q;
        const created=(await buyer.query(`select public.create_order_with_pricing($1::jsonb,'學生','隔離地址','0911111111',
          'customer@example.test','','atm','delivery','','personal',null,null,0::bigint,$2::jsonb) q`,[JSON.stringify(items),JSON.stringify(confirmed)])).rows[0].q;
        const snap=await getSnapshot(created.order_id);assert.equal(snap,undefined); // uncommitted on another connection
        await buyer.query('commit');const outcome=await pending;
        if(expectedError)assert.match(outcome.error?.message||'',expectedError);
        else if(outcome.error)throw outcome.error;
        const committed=await getSnapshot(created.order_id);assert.equal(committed.instructor_id,teacher);
        return committed;
      }
      const version=(await one('select version from public.instructor_student_settings where instructor_id=$1',[teacher])).version;
      await blockedMutation("select public.set_instructor_student_price_type($1,'student_1',$2)",[teacher,version]);
      const liveBinding=(await one('select id from public.instructor_student_bindings where student_id=$1 and ended_at is null',[student])).id;
      await blockedMutation("select public.save_instructor_student_binding($1,null,$2,'unbind')",[student,liveBinding]);
      await db.query("select public.save_instructor_student_binding($1,$2,null,'bind')",[student,teacher]);
      await blockedMutation('update public.student_pricing_feature_settings set enabled=false');
      await db.exec('update public.student_pricing_feature_settings set enabled=true');
      await blockedMutation('delete from auth.users where id=$1',[teacher],/Assisted order information is locked/);
      await blockedMutation('delete from auth.users where id=$1',[student],/Assisted order information is locked/);
      // Make a real catalog change between capture and authoritative quote.
      // The temporary advisory pause only exists inside this isolated database.
      const originalCreator=(await one("select pg_get_functiondef('public.create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)'::regprocedure) d")).d;
      const patched=originalCreator.replace("reward_context:=public.capture_student_reward_context(current_user_id,p_items,'online');",
        "reward_context:=public.capture_student_reward_context(current_user_id,p_items,'online'); perform pg_advisory_xact_lock(824101);");
      assert.notEqual(patched,originalCreator);await db.exec(patched);
      await manager.query('select pg_advisory_lock(824101)');
      const stale=(await buyer.query('select public.quote_order_pricing($1::jsonb) q',[JSON.stringify(items)])).rows[0].q;
      const beforeRace=await transactionState();
      const priceRace=buyer.query(`select public.create_order_with_pricing($1::jsonb,'學生','隔離地址','0911111111',
        'customer@example.test','','atm','delivery','','personal',null,null,0::bigint,$2::jsonb) q`,[JSON.stringify(items),JSON.stringify(stale)]);
      const failureCheck=assert.rejects(priceRace,e=>e.code==='40001'&&/商品價格已變動/.test(e.message));
      const managerPid=(await manager.query('select pg_backend_pid() pid')).rows[0].pid;
      for(let attempt=0;attempt<100;attempt++){
        const blocked=await manager.query('select count(*)::int n from pg_stat_activity where $1=any(pg_blocking_pids(pid))',[managerPid]);
        if(blocked.rows[0].n>0)break;
        await new Promise(resolve=>setTimeout(resolve,10));
        if(attempt===99)throw new Error('Expected price-race pause');
      }
      await manager.query('update public.product_variants set pro_price=810 where id=1');
      await manager.query('select pg_advisory_unlock(824101)');await failureCheck;
      // Stock/account/order effects remain rolled back; only the injected
      // independent price UPDATE should survive.
      assert.deepEqual(await transactionState(),beforeRace);
      await manager.query('update public.product_variants set pro_price=800 where id=1');
      await db.exec(originalCreator);
      await buyer.query("select set_config('test.uid',$1,false),set_config('test.access','admin',false)",[admin]);
      const parallelKey='20000000-0000-4000-8000-000000000020';
      const parallel=await Promise.all([buyer,manager].map(client=>client.query('select public.create_assisted_order($1::uuid,$2::jsonb) q',
        [parallelKey,JSON.stringify(manual)]).then(r=>r.rows[0].q)));
      assert.equal(parallel[0].order_id,parallel[1].order_id);
      assert.equal((await one('select count(*)::int n from public.student_reward_snapshots where order_id=$1',[parallel[0].order_id])).n,1);
      assert.equal((await one('select deadlocks::int n from pg_stat_database where datname=current_database()')).n,0);
      console.log('PASS PostgreSQL independent sessions: type/unbind/OFF/Auth DELETE writers wait, mid-create price race rolls back, simultaneous assisted recovery has one snapshot; deadlocks=0');
    }

    // Client and service endpoints cannot read/write/invoke sensitive helpers.
    for(const role of ['anon','authenticated','service_role']){
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from public.student_reward_snapshots'),e=>e.code==='42501');
      await assert.rejects(db.query("insert into public.student_reward_snapshots(order_id) values('forged')"),e=>e.code==='42501');
      await assert.rejects(db.query('truncate public.student_reward_snapshots'),e=>e.code==='42501');
      await assert.rejects(db.query('select public.capture_student_reward_context($1,$2::jsonb,$3)',[student,JSON.stringify(items),'online']),e=>e.code==='42501');
      await assert.rejects(db.query('select public.persist_student_reward_snapshot($1,$2::jsonb)',[ordinary.order_id,JSON.stringify({})]),e=>e.code==='42501');
      await assert.rejects(db.query('select public.calculate_student_reward_line(1000,700,1)'),e=>e.code==='42501');
      await db.exec('reset role');
    }
    await assert.rejects(db.query('update public.student_reward_snapshots set total_reward=0 where order_id=$1',[ordinary.order_id]),/immutable/);
    await assert.rejects(db.query('delete from public.student_reward_snapshots where order_id=$1',[ordinary.order_id]),/immutable/);
    // Stale quote after changing catalog rolls back order, snapshot and credit.
    await actor(student);q=await ordinaryQuote(items);
    const before=await one('select count(*)::int n from public.orders');
    const beforeSnapshots=await one('select count(*)::int n from public.student_reward_snapshots');
    const beforeCredit=await one('select available_balance,reserved_balance from public.shopping_credit_accounts where user_id=$1',[student]);
    await db.exec('update public.product_variants set pro_price=810 where id=1');
    await assert.rejects(ordinaryCreate(items,q,100),/已變動/);
    assert.deepEqual(await one('select count(*)::int n from public.orders'),before);
    assert.deepEqual(await one('select count(*)::int n from public.student_reward_snapshots'),beforeSnapshots);
    assert.deepEqual(await one('select available_balance,reserved_balance from public.shopping_credit_accounts where user_id=$1',[student]),beforeCredit);
    await db.exec('update public.product_variants set pro_price=800 where id=1');
    await actor(admin);
    const b=await one('select id from public.instructor_student_bindings where student_id=$1 and ended_at is null',[student]);
    await db.query("select public.save_instructor_student_binding($1,'44444444-4444-4444-8444-444444444444',$2,'rebind')",[student,b.id]);
    assert.deepEqual(await getSnapshot(ordinary.order_id),original);
    await db.query("select public.save_student_pricing_settings($1::jsonb,2)",[JSON.stringify({student_1:0.88,student_2:0.96})]);
    assert.deepEqual(await getSnapshot(ordinary.order_id),original);
    await actor(student);q=await ordinaryQuote(items);
    const changed=await ordinaryCreate(items,q);assert.equal((await getSnapshot(changed.order_id)).instructor_id,'44444444-4444-4444-8444-444444444444');
    assert.equal((await getSnapshot(changed.order_id)).student_multiplier,'0.88');

    // Reproduce the previously inventoried production FK relationships. The
    // existing assisted immutability trigger rejects FK SET NULL on Auth delete;
    // 2A must not silently weaken that independent order protection.
    await assert.rejects(db.query('delete from auth.users where id=$1',[teacher]),/Assisted order information is locked/);
    await assert.rejects(db.query('delete from auth.users where id=$1',[student]),/Assisted order information is locked/);
    assert.deepEqual(await getSnapshot(ordinary.order_id),original);
    assert.ok(await one('select id from auth.users where id=$1',[student]));
    // A teacher without an owned assisted order can be removed through actual
    // Auth CASCADE; UUID-only snapshots survive. Profile-only cleanup also does.
    await db.query('delete from auth.users where id=$1',['44444444-4444-4444-8444-444444444444']);
    assert.equal(await one('select id from public.profiles where id=$1',['44444444-4444-4444-8444-444444444444']),undefined);
    console.log('KNOWN EXISTING CONFLICT: Auth deletion with owned assisted orders is blocked by protect_assisted_order; 2A does not alter it');
    // Later member removal preserves identifiers and exact historic price data.
    await db.query('delete from public.profiles where id=$1',['44444444-4444-4444-8444-444444444444']);
    await db.query('delete from public.profiles where id=$1',[student]);
    assert.deepEqual(await getSnapshot(ordinary.order_id),original);
    assert.doesNotMatch(JSON.stringify(original),/name|email|phone|address/);
    await db.exec('update public.student_pricing_feature_settings set enabled=false');
    await db.exec(read('supabase-student-reward-snapshots.sql'));
    assert.deepEqual(await getSnapshot(ordinary.order_id),original);
    const checked=await db.exec(read('supabase-student-reward-snapshots-verify.sql'));
    for(const [name,value] of Object.entries(checked[1].rows[0].verification))assert.equal(value,true,name);
    const currentUntouched=await one(`select md5(string_agg(p.oid::regprocedure::text||pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),E'\n' order by p.oid::regprocedure::text)) h
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'
      and p.proname not in('create_order_with_pricing_discount_v2','create_assisted_order',
      'capture_student_reward_context','calculate_student_reward_line','persist_student_reward_snapshot','reject_student_reward_snapshot_changes')`);
    assert.deepEqual(currentUntouched,untouched);
    console.log('PASS 2A ordinary/assisted snapshots, benefits independence, recovery, immutability, ACL and OFF');
  }));
