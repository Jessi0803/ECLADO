const {test}=require('node:test');const assert=require('node:assert/strict');
const {runRewardCheckoutDatabaseScenario}=require('./instructor-reward-checkout-db.test.cjs');
test('redemption export: real lifecycle rows, role ACL, Taipei dates and immutable audit',
 {skip:!process.env.PGLITE_MODULE&&!process.env.EMBEDDED_POSTGRES_MODULE,timeout:180000},()=>runRewardCheckoutDatabaseScenario(async({db,read,actor,one,admin,teacher,student,ordinaryQuote,ordinaryCreate,create,walletQuote,status,bank,consistent})=>{
  await actor(admin);
  await db.exec(read('supabase-instructor-reward-redemption-export.sql'));
  const originalPermission=(await one("select pg_get_functiondef('public.has_backoffice_permission(text)'::regprocedure) d")).d;
  // Exercise the real permissions, rather than the pricing harness's stub.
  const source=read('supabase-backoffice-permissions.sql');
  const start=source.indexOf('create or replace function public.has_backoffice_permission(');
  await db.exec(source.slice(start,source.indexOf('$$;',source.indexOf('as $$',start))+3).replaceAll('requested_permission','p'));
  await db.exec("alter table public.backoffice_role_permissions drop constraint backoffice_role_permissions_permission_check; insert into public.backoffice_role_permissions values('super_admin','orders.read'),('super_admin','members.read'),('super_admin','orders.write') on conflict do nothing");
  const query=async(args=[null,null,'',''])=>(await one('select public.export_admin_reward_redemptions($1,$2,$3,$4) q',args)).q;
  // Replenish via a genuine isolated student order, not by editing balances.
  await db.exec('update public.student_pricing_feature_settings set enabled=true; update public.products set instructor_price_multiplier=0.5 where id=1');
  await actor(student);const items=[{product_id:1,variant_id:1,qty:10}];const income=await ordinaryCreate(items,await ordinaryQuote(items));
  await actor(admin);await db.query('select public.confirm_admin_instructor_reward_payment($1,true)',[income.order_id]);await status(income.order_id,'delivered');
  await db.exec('update public.student_pricing_feature_settings set enabled=false; update public.products set instructor_price_multiplier=0.7 where id=1');
  await actor(teacher);const held=await create(0,100,await walletQuote(0,100));
  await actor(admin);const result=await query();
  assert.equal(result.count,(await one('select count(*) n from public.orders where reward_credit_amount>0')).n);
  assert.equal(new Set(result.rows.map(r=>r.order_id)).size,result.count);
  assert.equal(result.rows.find(r=>r.order_id===held.order_id).redemption_status,'reserved');
  assert.ok(result.rows.some(r=>r.redemption_status==='refunded'));
  assert.ok(result.rows.some(r=>r.redemption_status==='released'));
  for(const row of result.rows){
    assert.equal(Number(row.total),Number(row.payment_amount)+Number(row.shopping_credit_amount)+Number(row.reward_credit_amount));
    const amounts=await one("select coalesce(sum(amount) filter(where event_type='spend_consume'),0) used,coalesce(sum(amount) filter(where event_type='spend_refund'),0) refunded from public.instructor_reward_ledger where order_id=$1",[row.order_id]);
    assert.equal(Number(row.consumed_amount),Number(amounts.used));assert.equal(Number(row.refunded_amount),Number(amounts.refunded));
    for(const field of ['phone','email','bank','instructor_unit_price','provider_order_no','student_id'])assert.ok(!Object.hasOwn(row,field));
  }
  await actor(teacher);await bank(held.order_id);await status(held.order_id,'paid');await actor(admin);
  const consumed=await query([null,null,held.order_id,'consumed']);assert.equal(consumed.count,1);assert.equal(Number(consumed.rows[0].consumed_amount),100);
  // End date is inclusive in Taipei, independent of session timezone.
  await db.query("update public.orders set created_at='2026-10-19T16:00:00Z' where id=$1",[held.order_id]);
  assert.equal((await query(['2026-10-19','2026-10-19',held.order_id,''])).count,0);
  assert.equal((await query(['2026-10-20','2026-10-20',held.order_id,''])).count,1);
  assert.equal((await query([null,null,'%', ''])).count,0);
  await assert.rejects(query(['2026-10-21','2026-10-20','','']),e=>e.code==='22023');
  await assert.rejects(query([null,null,'','unexpected']),e=>e.code==='22023');
  assert.equal((await one('select row_count from public.instructor_reward_redemption_exports where id=$1',[result.export_id])).row_count,result.count);
  await assert.rejects(db.exec("update public.instructor_reward_redemption_exports set row_count=0"));
  for(const uid of [teacher,student,null]){await actor(uid);await assert.rejects(query(),e=>e.code==='42501');}
  await actor(admin);await db.query('update public.admin_users set active=false where user_id=$1',[admin]);
  await assert.rejects(query(),e=>e.code==='42501');await db.query('update public.admin_users set active=true where user_id=$1',[admin]);
  await actor(admin);await db.exec("delete from public.backoffice_role_permissions where role='super_admin' and permission='members.read'");await assert.rejects(query(),e=>e.code==='42501');
  await db.exec("insert into public.backoffice_role_permissions values('super_admin','members.read')");
  assert.equal((await one("select has_table_privilege('authenticated','public.instructor_reward_redemption_exports','SELECT,INSERT,UPDATE,DELETE') allowed")).allowed,false);
  for(const role of ['anon','service_role'])assert.equal((await one("select has_function_privilege($1,'public.export_admin_reward_redemptions(date,date,text,text)','EXECUTE') allowed",[role])).allowed,false);
  await db.exec('set role anon');try{await assert.rejects(query(),e=>e.code==='42501');}finally{await db.exec('reset role');}
  await db.exec('set role authenticated');try{await assert.rejects(db.exec('select * from public.instructor_reward_redemption_exports'),e=>e.code==='42501');}finally{await db.exec('reset role');}
  await db.exec(originalPermission);await consistent();
 }));
