const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
test('bank diagnostics are service-written, admin/order-permission read only, bounded and credential-free',{
  skip:!process.env.PGLITE_MODULE,timeout:90000,
},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);const db=new PGlite();
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
    create function public.is_eclado_admin() returns boolean language sql as $$select coalesce(current_setting('test.admin',true),'false')='true'$$;
    create function public.has_backoffice_permission(text) returns boolean language sql as $$select coalesce(current_setting('test.orders',true),'false')='true'$$;
    create table public.orders(id text primary key);insert into public.orders values('ECL-LOCAL-1');`);
  const sql=fs.readFileSync(path.resolve(__dirname,'../../supabase-payment-diagnostics.sql'),'utf8');
  await db.exec(sql);await db.exec(sql);
  await db.exec('set role anon');await assert.rejects(db.query('select * from public.order_payment_diagnostics'),/permission denied/);
  await assert.rejects(db.query("select public.get_admin_order_payment_diagnostics('ECL-LOCAL-1')"),/permission denied/);
  await db.exec('reset role;set role authenticated');
  await assert.rejects(db.query("select public.get_admin_order_payment_diagnostics('ECL-LOCAL-1')"),/Orders read access required/);
  await assert.rejects(db.query('insert into public.order_payment_diagnostics(id) values(null)'),/permission denied/);
  await db.exec("select set_config('test.uid','11111111-1111-4111-8111-111111111111',false),set_config('test.admin','false',false),set_config('test.orders','true',false)");
  await assert.rejects(db.query("select public.get_admin_order_payment_diagnostics('ECL-LOCAL-1')"),/Orders read access required/);
  await db.exec("select set_config('test.admin','true',false),set_config('test.orders','false',false)");
  await assert.rejects(db.query("select public.get_admin_order_payment_diagnostics('ECL-LOCAL-1')"),/Orders read access required/);
  await db.exec("reset role;set role service_role");
  for(let i=0;i<35;i++)await db.query(`insert into public.order_payment_diagnostics(diagnostic_key,order_id,provider_order_no,attempt_no,source,api_service,transaction_status,transaction_message_code,auth_response_code)
    values($1,'ECL-LOCAL-1','ECL-LOCAL-1',1,'notify','OrderPayQuery','F','E2720','N7')`,[crypto.randomBytes(32).toString('hex')]);
  await db.exec("reset role;set role authenticated;select set_config('test.orders','true',false)");
  const rows=(await one("select public.get_admin_order_payment_diagnostics('ECL-LOCAL-1') as data")).data;
  assert.equal(rows.length,30);assert.equal(rows[0].auth_response_code,'N7');
  assert.ok(rows.every(row=>!['provider_order_no','diagnostic_key','order_id','payment_url','token'].some(k=>k in row)));
  await assert.rejects(db.query('select * from public.order_payment_diagnostics'),/permission denied/);
  assert.deepEqual((await one("select public.get_admin_order_payment_diagnostics('ECL-OTHER') as data")).data,[]);
  await db.exec('reset role');
  const verification=(await one(fs.readFileSync(path.resolve(__dirname,'../../supabase-payment-diagnostics-verify.sql'),'utf8'))).payment_diagnostics_verification;
  assert.equal(verification.column_count,17);
  for(const key of ['rls_enabled','anon_direct_denied','member_direct_denied','service_insert','service_update_denied','anon_rpc_denied','authenticated_rpc','orders_permission_guard'])assert.equal(verification[key],true,key);
 }finally{await db.close();}
});
