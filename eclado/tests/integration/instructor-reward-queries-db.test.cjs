const {test}=require('node:test');const assert=require('node:assert/strict');
const {runStudentPricingDatabaseScenario}=require('./student-pricing-db.test.cjs');
test('3: isolated reward queries, historical ownership, ACL and consistent read pages',
  {skip:!process.env.PGLITE_MODULE&&!process.env.EMBEDDED_POSTGRES_MODULE,timeout:180000},()=>
  runStudentPricingDatabaseScenario(async({db,read,fn,one,actor,student,teacher,ordinaryQuote,ordinaryCreate})=>{
    const admin='11111111-1111-4111-8111-111111111111',other='44444444-4444-4444-8444-444444444444';
    await actor(admin);
    await db.exec(`insert into auth.users values('${teacher}'),('${other}');
      insert into public.profiles(id,role,name) values('${other}','instructor','另一老師') on conflict(id) do update set role='instructor',name='另一老師';
      alter table public.profiles add constraint test_profile_auth_fk foreign key(id) references auth.users(id) on delete cascade;
      alter table public.orders add constraint test_order_auth_fk foreign key(user_id) references auth.users(id) on delete set null;
      alter table public.profiles add column email text default 'private-contact@example.test',add column phone text default 'private-phone';
      update public.profiles set name='學生姓名' where id='${student}';`);
    const shipping=read('supabase-professional-shipping-groups.sql');
    await db.exec(shipping.slice(shipping.indexOf('create table'),shipping.indexOf('create or replace function')));
    for(const name of ['is_professional_shipping_role','is_shipping_group_valid_order_status','shipping_group_effective_amount'])await db.exec(fn('supabase-professional-shipping-groups.sql',name));
    await db.exec(read('supabase-student-reward-snapshots.sql'));
    await db.exec(read('supabase-instructor-reward-ledger.sql'));
    const fingerprint=()=>one(`select md5(string_agg(pg_get_functiondef(p.oid)||coalesce(p.proacl::text,''),E'\n' order by p.oid::regprocedure::text)) h
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'
      and p.proname not in('instructor_reward_report_internal','assert_instructor_reward_read_admin','get_my_instructor_reward_report','get_admin_instructor_reward_report','get_admin_instructor_reward_accounts')`);
    const before=await fingerprint();
    const originalPermission=(await one("select pg_get_functiondef('public.has_backoffice_permission(text)'::regprocedure) definition")).definition;
    await db.exec(read('supabase-instructor-reward-queries.sql'));
    const my=(offset=0,limit=20,ledgerOffset=0)=>one('select public.get_my_instructor_reward_report($1,$2,$3) q',[offset,limit,ledgerOffset]).then(r=>r.q);
    const adminReport=id=>one('select public.get_admin_instructor_reward_report($1) q',[id]).then(r=>r.q);
    const accounts=()=>one('select public.get_admin_instructor_reward_accounts() q').then(r=>r.q);
    // Use actual permission functions, rather than the earlier engine stub.
    await db.exec(fn('supabase-backoffice-permissions.sql','has_backoffice_permission').replaceAll('requested_permission','p'));
    // This intentional fixture replacement is excluded from original fingerprint.
    await db.exec("alter table public.backoffice_role_permissions drop constraint backoffice_role_permissions_permission_check");
    await db.exec("insert into public.backoffice_role_permissions(role,permission) values('super_admin','orders.read'),('super_admin','members.read'),('super_admin','orders.write'),('super_admin','instructor_students.manage') on conflict do nothing");
    await actor(teacher);const empty=await my();assert.equal(empty.order_count,0);assert.equal(empty.summary.available_balance,0);
    await actor(admin);await db.query("select public.save_instructor_student_binding($1,$2,null,'bind')",[student,teacher]);
    await db.exec('update public.student_pricing_feature_settings set enabled=true');
    const order=async()=>{await actor(student);const items=[{product_id:1,variant_id:1,qty:10}];const q=await ordinaryQuote(items);const o=await ordinaryCreate(items,q);await actor(admin);return o;};
    const first=await order(),second=await order(),third=await order();
    await db.query("update public.orders set status='delivered' where id=$1",[first.order_id]);
    await db.query('select public.confirm_admin_instructor_reward_payment($1,true)',[first.order_id]);
    await db.query("update public.orders set status='delivered' where id=$1",[second.order_id]);
    await db.query('select public.confirm_admin_instructor_reward_payment($1,true)',[second.order_id]);
    await db.query("update public.orders set status='returned' where id=$1",[second.order_id]);
    await actor(teacher);const report=await my();
    assert.equal(report.order_count,3);assert.equal(report.ledger_count,6);
    const amount=Number(report.orders.find(o=>o.order_id===first.order_id).total_reward);
    assert.equal(Number(report.summary.balance),amount);assert.equal(Number(report.summary.pending_balance),amount);
    assert.equal(Number(report.summary.credited_total),2*amount);assert.equal(Number(report.summary.reversed_total),amount);
    assert.equal(report.orders[0].student_name,'學生姓名');
    const text=JSON.stringify(report);
    for(const forbidden of ['private-contact','private-phone','隔離地址','instructor_unit_price','instructor_multiplier','student_multiplier','provider_order_no','actor_user_id','token_hash'])assert.ok(!text.includes(forbidden),forbidden);
    assert.deepEqual(Object.keys(report.orders[0].items[0]).sort(),['name','product_id','qty','reward','size','unit_price','variant_id']);
    assert.equal((await my(0,1)).orders.length,1);assert.equal((await my(0,1)).entries.length,1);
    const pages=[await my(0,1),await my(1,1),await my(2,1)];
    assert.equal(new Set(pages.map(p=>p.orders[0].order_id)).size,3);
    assert.deepEqual(pages[0].summary,pages[2].summary);assert.equal((await my(999,1)).orders.length,0);
    await assert.rejects(my(-1),e=>e.code==='22023');await assert.rejects(my(0,51),e=>e.code==='22023');await assert.rejects(my(0,null),e=>e.code==='22023');
    await actor(admin);const binding=await one('select id from public.instructor_student_bindings where student_id=$1 and ended_at is null',[student]);
    await db.query("select public.set_instructor_student_price_type($1,'student_2',(select version from public.instructor_student_settings where instructor_id=$1))",[other]);
    await db.query("select public.save_instructor_student_binding($1,$2,$3,'rebind')",[student,other,binding.id]);
    const fourth=await order();
    await actor(teacher);assert.equal((await my()).order_count,3);assert.ok(!(await my()).orders.some(o=>o.order_id===fourth.order_id));
    await actor(other);assert.equal((await my()).order_count,1);
    await assert.rejects(adminReport(teacher),e=>e.code==='42501');
    await actor(student);await assert.rejects(my(),e=>e.code==='42501');
    for(const role of ['consumer','pending','pro','distributor','staff']){
      await db.query('update public.profiles set role=$1 where id=$2',[role,teacher]);await actor(teacher);await assert.rejects(my(),e=>e.code==='42501');
    }
    await db.query("update public.profiles set role='instructor' where id=$1",[teacher]);assert.equal((await my()).order_count,3);
    // Delete a student's Auth parent, keeping snapshots. No contact fallback.
    await actor(admin);await assert.rejects(db.query('delete from auth.users where id=$1',[student]),/Assisted order information is locked/);
    const deletedStudent='55555555-5555-4555-8555-555555555555';
    await db.query('insert into auth.users values($1)',[deletedStudent]);
    await db.query("insert into public.profiles(id,role,name) values($1,'pro','可刪學生')",[deletedStudent]);
    await db.query("select public.save_instructor_student_binding($1,$2,null,'bind')",[deletedStudent,teacher]);
    await actor(deletedStudent);const deletedItems=[{product_id:1,variant_id:1,qty:10}];
    const deletedQuote=await ordinaryQuote(deletedItems);const deletedOrder=await ordinaryCreate(deletedItems,deletedQuote);
    await actor(admin);await db.query('delete from auth.users where id=$1',[deletedStudent]);
    await actor(teacher);const deleted=await my();assert.equal(deleted.orders.find(o=>o.order_id===deletedOrder.order_id).student_name,null);assert.equal(deleted.orders.find(o=>o.order_id===deletedOrder.order_id).student_deleted,true);
    assert.equal(deleted.order_count,4);assert.equal(deleted.summary.balance,report.summary.balance);
    await actor(admin);const dir=await accounts();assert.ok(dir.accounts.some(a=>a.id===teacher));assert.ok(!dir.accounts.some(a=>a.inconsistent));
    assert.deepEqual((await adminReport(teacher)).summary,deleted.summary);
    // Missing original order is explicitly flagged and never changes history.
    await db.query('delete from public.order_payment_authorizations where order_id=$1',[third.order_id]);
    await db.query('delete from public.orders where id=$1',[third.order_id]);
    assert.ok((await adminReport(teacher)).orders.find(o=>o.order_id===third.order_id).order_missing);
    // Read-only consistency diagnostics, including a zero-balance closed UUID.
    await db.exec('begin');await db.query('update public.instructor_reward_accounts set balance=balance+1 where user_id=$1',[teacher]);
    assert.ok((await accounts()).accounts.find(a=>a.id===teacher).inconsistent);await db.exec('rollback');
    await db.exec('begin');await db.query('update public.instructor_reward_accounts set balance=-12 where user_id=$1',[teacher]);
    assert.equal((await adminReport(teacher)).summary.available_balance,0);assert.equal(Number((await adminReport(teacher)).summary.balance),-12);await db.exec('rollback');
    await db.exec("delete from public.backoffice_role_permissions where role='super_admin' and permission='members.read'");
    await assert.rejects(accounts(),e=>e.code==='42501');await assert.rejects(adminReport(teacher),e=>e.code==='42501');
    await db.exec("insert into public.backoffice_role_permissions values('super_admin','members.read')");
    await db.exec("update public.admin_users set active=false");await assert.rejects(accounts(),e=>e.code==='42501');await db.exec("update public.admin_users set active=true");
    await db.exec('set role authenticated');await actor(teacher);assert.equal((await my()).order_count,4);
    await assert.rejects(db.query('select public.instructor_reward_report_internal($1,0,20,0)',[other]),e=>e.code==='42501');
    await assert.rejects(db.query('select * from public.student_reward_snapshots'),e=>e.code==='42501');
    await db.exec('reset role');await db.exec('set role anon');await assert.rejects(my(),e=>e.code==='42501');await db.exec('reset role');
    await db.exec("select set_config('test.uid','',false)");await assert.rejects(my(),e=>e.code==='42501');await actor(admin);
    await db.exec('update public.student_pricing_feature_settings set enabled=false');await actor(teacher);assert.equal((await my()).order_count,4);
    if(process.env.EMBEDDED_POSTGRES_MODULE){
      const writer=await db.connect();
      await writer.query("select set_config('test.uid',$1,false)",[admin]);
      await writer.query('begin');
      await writer.query("update public.orders set status='delivered' where id=$1",[deletedOrder.order_id]);
      await writer.query('select public.confirm_admin_instructor_reward_payment($1,true)',[deletedOrder.order_id]);
      // A second connection sees neither side of the uncommitted credit.
      const during=await my();
      assert.equal(during.orders.find(o=>o.order_id===deletedOrder.order_id).reward_status,'pending');
      const duringBalance=Number(during.summary.balance),duringPending=Number(during.summary.pending_balance);
      await writer.query('commit');
      const afterCredit=await my();
      assert.equal(afterCredit.orders.find(o=>o.order_id===deletedOrder.order_id).reward_status,'credited');
      const delta=Number(afterCredit.orders.find(o=>o.order_id===deletedOrder.order_id).total_reward);
      assert.equal(Number(afterCredit.summary.balance),duringBalance+delta);
      assert.equal(Number(afterCredit.summary.pending_balance),duringPending-delta);
      assert.equal((await one('select deadlocks::int n from pg_stat_database where datname=current_database()')).n,0);
      console.log('PASS PostgreSQL separate-connection committed/uncommitted read consistency; deadlocks=0');
    }
    await actor(admin);await db.exec(read('supabase-instructor-reward-queries.sql'));
    const verification=(await db.exec(read('supabase-instructor-reward-queries-verify.sql')));
    const all=Array.isArray(verification)?verification.find(v=>v.rows?.[0]?.verification):verification;
    for(const [name,value]of Object.entries(all.rows[0].verification))assert.equal(value,true,name);
    // Restore fixture permission helper to compare all original definitions/ACL.
    await db.exec(originalPermission);
    assert.deepEqual(await fingerprint(),before);
    console.log('PASS stage 3 ownership, downgrade/restore, deleted member/order, whitelist, actual permissions, pagination, diagnostics, OFF and unchanged accounting');
  }));
