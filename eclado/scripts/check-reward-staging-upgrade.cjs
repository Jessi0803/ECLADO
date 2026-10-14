// Disposable PostgreSQL only; never reads credentials or connects to Supabase.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const assert=require('node:assert/strict');const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),e=path.join(root,'docs/evidence/reward-staging-upgrade');
const read=n=>fs.readFileSync(path.join(root,n),'utf8');
(async()=>{
 const modulePath=process.env.EMBEDDED_POSTGRES_MODULE||'/private/tmp/eclado-1b-postgres-tools/node_modules/embedded-postgres/dist/index.js';if(!fs.existsSync(modulePath))throw new Error('Isolated PostgreSQL module required');
 const sock=net.createServer();await new Promise(r=>sock.listen(0,'127.0.0.1',r));const port=sock.address().port;await new Promise(r=>sock.close(r));
 const {default:PG}=await import(pathToFileURL(modulePath));
 const pg=new PG({databaseDir:fs.mkdtempSync(path.join(os.tmpdir(),'eclado-staging-upgrade-')),port,user:'postgres',password:'isolated-only',persistent:false,createPostgresUser:false,onLog:()=>{},onError:()=>{}});
 await pg.initialise();await pg.start();const db=pg.getPgClient('postgres','127.0.0.1');await db.connect();const query=db.query.bind(db);db.query=async(sql,args)=>{try{return await query(sql,args);}catch(err){const pos=Number(err.position||1)-1;err.querySnippet=typeof sql==='string'?sql.slice(Math.max(0,pos-120),pos+120):'';throw err;}};
 const result={target:'isolated PostgreSQL 17.6',steps:[],cloudExecuted:false};
 try{
  await db.query(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
   CREATE SCHEMA auth;CREATE SCHEMA extensions;CREATE EXTENSION pgcrypto WITH SCHEMA extensions;CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions;CREATE EXTENSION btree_gist WITH SCHEMA extensions;
   CREATE TABLE auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated')$$;
   CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
   GRANT USAGE ON SCHEMA public,auth,extensions TO anon,authenticated,service_role;`);
  const b=JSON.parse(fs.readFileSync(path.join(e,'before-metadata.json')));
  const exact=JSON.parse(fs.readFileSync(path.join(e,'before-functions.json')));
  const col=c=>`"${c.name}" ${c.type}${c.default?' DEFAULT '+c.default:''}${c.not_null?' NOT NULL':''}`;
  for(const t of b.tables)await db.query(`CREATE TABLE public."${t.name}"(${t.columns.map(col).join(',')})`);
  for(const c of [...b.constraints].sort((a,b)=>(a.type==='f')-(b.type==='f')))await db.query(`ALTER TABLE public."${c.table}" ADD CONSTRAINT "${c.name}" ${c.definition}`);
  for(const f of exact)await db.query(f.definition);
  for(const tr of b.triggers)await db.query(tr.definition);
  for(const t of b.tables){await db.query(`ALTER TABLE public."${t.name}" ENABLE ROW LEVEL SECURITY;GRANT ALL ON public."${t.name}" TO anon,authenticated,service_role`);}
  for(const pol of b.policies){let sql=`CREATE POLICY "${pol.name}" ON public."${pol.table}" FOR ${pol.command} TO ${pol.roles.map(x=>x==='public'?'PUBLIC':x).join(',')}`;if(pol.qual)sql+=' USING ('+pol.qual+')';if(pol.with_check)sql+=' WITH CHECK ('+pol.with_check+')';await db.query(sql);}
  const legacy=JSON.parse(fs.readFileSync(path.join(e,'legacy-product-trigger-backup.json'))).products;
  await db.query(`INSERT INTO public.products SELECT * FROM jsonb_populate_recordset(null::public.products,$1::jsonb)`,[JSON.stringify(legacy)]);
  const before=(await db.query('SELECT to_jsonb(p) j FROM public.products p')).rows;
  await db.query(read('docs/reward-staging-upgrade/01-production-schema-baseline.sql'));result.steps.push('production-schema-baseline');
  for(const t of before){const now=(await db.query('SELECT to_jsonb(p) j FROM public.products p WHERE id=$1',[t.j.id])).rows[0].j;for(const [k,v]of Object.entries(t.j))assert.deepEqual(now[k],v,`preserve product ${k}`);}
  result.legacyProductPreserved=true;
  const files=['supabase-student-reward-snapshots.sql','supabase-instructor-reward-ledger.sql','supabase-instructor-reward-queries.sql','supabase-instructor-reward-checkout.sql','supabase-instructor-reward-withdrawals.sql','supabase-instructor-reward-notifications.sql','supabase-instructor-reward-reconciliation.sql'];
  for(const n of files){await db.query(read(n));result.steps.push(n);}
  result.tables=(await db.query("select count(*)::int n from pg_tables where schemaname='public'")).rows[0].n;
  result.studentFeature=(await db.query('select enabled from public.student_pricing_feature_settings')).rows[0].enabled;assert.equal(result.studentFeature,false);
  const verify=['supabase-instructor-student-foundation-verify.sql','supabase-student-pricing-integration-verify.sql','supabase-student-reward-snapshots-verify.sql','supabase-instructor-reward-ledger-verify.sql','supabase-instructor-reward-queries-verify.sql','supabase-instructor-reward-checkout-verify.sql','supabase-instructor-reward-withdrawals-verify.sql','supabase-instructor-reward-operations-verify.sql','supabase-payment-rpc-access-hardening-verify.sql'];
  result.verify=[];
  for(const n of verify){const multi=await db.query(read(n));const rows=(Array.isArray(multi)?multi:[multi]).flatMap(x=>x.rows||[]);let booleans=0;for(const row of rows)for(const[k,v]of Object.entries(row))if(typeof v==='boolean'){assert.equal(v,true,`${n}:${k}`);booleans++;}result.verify.push({file:n,booleans});}
  // Protected private tables reject real SQL roles, not just mocked auth.
  await db.query('SET ROLE authenticated');await assert.rejects(db.query('SELECT * FROM public.instructor_reward_ledger'),x=>x.code==='42501');await db.query('RESET ROLE');
  result.directFinancialReadDenied=true;
  await db.query(read('docs/reward-staging-upgrade/02-rollback-smoke.sql'));
  assert.equal((await db.query('SELECT count(*)::int n FROM auth.users')).rows[0].n,0);result.rollbackSmoke=true;
  const admin='77777777-7777-4777-8777-777777777701',teacher='77777777-7777-4777-8777-777777777702',student='77777777-7777-4777-8777-777777777703';
  await db.query("INSERT INTO auth.users(id,email) VALUES($1,'admin@example.test'),($2,'teacher@example.test'),($3,'student@example.test')",[admin,teacher,student]);
  await db.query("INSERT INTO public.admin_users(user_id,role,active) VALUES($1,'super_admin',true)",[admin]);
  const actor=async id=>{await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[id]);};
  await actor(admin);
  await db.query("SELECT public.set_member_role_with_membership($1,'instructor',current_date,'isolated upgrade check')",[teacher]);
  await db.query("SELECT public.set_member_role_with_membership($1,'pro',current_date,'isolated upgrade check')",[student]);
  await db.query("SELECT public.set_instructor_student_price_type($1,'student_1',0)",[teacher]);
  await db.query("SELECT public.save_instructor_student_binding($1,$2,NULL,'bind')",[student,teacher]);
  await db.query('BEGIN');
  await db.query("INSERT INTO public.products(id,name,name_zh,category,slug,price,pro_price,active,publication_status) VALUES(900001,'stage7-fake-product','隔離假商品','face','stage7-fake-product',800,500,true,'active')");
  await db.query("INSERT INTO public.product_variants(id,product_id,sku,size,price,pro_price,stock,is_default) VALUES(900001,900001,'FAKE-7A-001','100ml',800,500,1000,true)");
  await db.query('COMMIT');
  await actor(student);const items=JSON.stringify([{product_id:900001,variant_id:900001,qty:20}]);
  const quote=async()=> (await db.query("SELECT public.quote_order_with_wallets($1::jsonb,'delivery','','',0::bigint,0::bigint) q",[items])).rows[0].q;
  const off=await quote();assert.equal(Number(off.subtotal),10000);
  await db.query('UPDATE public.student_pricing_feature_settings SET enabled=true');
  const on=await quote();assert.equal(Number(on.subtotal),9000);
  const order=(await db.query("SELECT public.create_order_with_wallets($1::jsonb,'隔離假學生','隔離測試地址','0900000000','student@example.test','','atm','delivery','','personal',NULL,NULL,0::bigint,0::bigint,$2::jsonb) q",[items,JSON.stringify(on)])).rows[0].q;
  const snap=(await db.query('SELECT * FROM public.student_reward_snapshots WHERE order_id=$1',[order.order_id])).rows[0];
  assert.equal(snap.instructor_id,teacher);assert.equal(Number(snap.total_reward),2000);
  await actor(admin);await db.query('SELECT public.confirm_admin_instructor_reward_payment($1,true)',[order.order_id]);
  await db.query("UPDATE public.orders SET status='delivered' WHERE id=$1",[order.order_id]);
  const balance=(await db.query('SELECT balance FROM public.instructor_reward_accounts WHERE user_id=$1',[teacher])).rows[0].balance;
  assert.equal(Number(balance),2000);await db.query('UPDATE public.student_pricing_feature_settings SET enabled=false');
  result.runtime={binding:true,offSubtotal:Number(off.subtotal),onSubtotal:Number(on.subtotal),snapshotReward:Number(snap.total_reward),deliveredBalance:Number(balance),auth:'local SQL auth.uid/role stubs; not Supabase Auth/PostgREST',data:'isolated fake only'};
  result.pass=true;
 }catch(error){result.pass=false;result.error={message:error.message,code:error.code,where:error.where,position:error.position,querySnippet:error.querySnippet};throw error;}
 finally{fs.writeFileSync(path.join(e,'local-upgrade-result.json'),JSON.stringify(result,null,2));await db.end();await pg.stop();console.log(JSON.stringify(result));}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
