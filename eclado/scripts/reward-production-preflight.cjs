// Local PostgreSQL only. No .env, remote connection or production row data.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),root=path.resolve(__dirname,'..');
const files=['supabase-coupon-member-create-compat.sql','supabase-student-reward-snapshots.sql',...['ledger','queries','checkout','withdrawals','notifications','reconciliation','withdrawal-operations','withdrawal-deductions','withdrawal-partial'].map(n=>`supabase-instructor-reward-${n}.sql`)];
const verifies={snapshots:['supabase-student-reward-snapshots-verify.sql'],ledger:['supabase-instructor-reward-ledger-verify.sql'],queries:['supabase-instructor-reward-queries-verify.sql'],checkout:['supabase-instructor-reward-checkout-verify.sql'],withdrawals:['supabase-instructor-reward-withdrawals-verify.sql'],reconciliation:['supabase-instructor-reward-operations-verify.sql'],'withdrawal-operations':['supabase-instructor-reward-withdrawal-operations-verify.sql'],'withdrawal-deductions':['supabase-instructor-reward-withdrawal-deductions-verify.sql'],'withdrawal-partial':['supabase-instructor-reward-withdrawal-partial-verify.sql','supabase-instructor-reward-withdrawal-deductions-verify.sql']};
const digest=s=>crypto.createHash('sha256').update(s).digest('hex'),q=s=>'"'+s.replaceAll('"','""')+'"',read=f=>fs.readFileSync(path.join(root,f),'utf8');
(async()=>{
 if(!process.env.REWARD_PREFLIGHT_CATALOG||!process.env.EMBEDDED_POSTGRES_MODULE)throw Error('Explicit local catalog and PostgreSQL module paths required');
 const bytes=fs.readFileSync(process.env.REWARD_PREFLIGHT_CATALOG),cat=JSON.parse(bytes);assert.equal(cat.functions.length,208);
 for(const f of cat.functions)assert.equal(crypto.createHash('md5').update(f.definition).digest('hex'),f.md5,`Catalog integrity ${f.signature}`);
 const sock=net.createServer();await new Promise((ok,no)=>sock.once('error',no).listen(0,'127.0.0.1',ok));const port=sock.address().port;await new Promise(ok=>sock.close(ok));
 const {default:PG}=await import(pathToFileURL(process.env.EMBEDDED_POSTGRES_MODULE));
 const pg=new PG({databaseDir:fs.mkdtempSync(path.join(os.tmpdir(),'eclado-production-replay-')),port,user:'postgres',password:'local-only',persistent:false,createPostgresUser:false,onLog:()=>{},onError:()=>{}});
 let db;const result={date:'2026-10-19',source:'saved read-only catalog; no production row data',catalog_sha256:digest(bytes),cloudExecuted:false,steps:[],verify:[]};
 try{
 await pg.initialise();await pg.start();db=pg.getPgClient('postgres','127.0.0.1');await db.connect();
 const originalQuery=db.query.bind(db);db.query=async(sql,args)=>{try{return await originalQuery(sql,args);}catch(e){const offset=Number(e.position||1)-1;e.message+=' [local SQL context: '+String(sql).slice(Math.max(0,offset-60),offset+80)+']';throw e;}};
 await db.query(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema extensions;
 create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;create extension btree_gist with schema extensions;
 set search_path=public,extensions,auth;set check_function_bodies=false;set statement_timeout='60s';set lock_timeout='5s';
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'authenticated')$$;
 create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;
 grant usage on schema public,auth,extensions to anon,authenticated,service_role;`);
 result.postgres=(await db.query('select version() v')).rows[0].v;assert.match(result.postgres,/PostgreSQL 17\.6/);
 const sequences=new Set(cat.tables.flatMap(t=>t.columns.flatMap(c=>[...(c.default||'').matchAll(/nextval\('([^']+)'/g)].map(m=>m[1]))));
 for(const seq of sequences){assert.match(seq,/^[a-z_]+$/);await db.query(`create sequence public.${q(seq)}`);}
 await db.query(cat.functions.find(f=>f.name==='next_purchase_order_number').definition);
 const col=c=>`${q(c.name)} ${c.type}${c.identity?' generated '+(c.identity==='a'?'always':'by default')+' as identity':c.default?' default '+c.default:''}${c.not_null?' not null':''}`;
 for(const t of cat.tables)await db.query(`create table public.${q(t.name)}(${t.columns.map(col).join(',')})`);
 for(const f of cat.functions)await db.query(f.definition);
 for(const c of cat.constraints.filter(c=>c.type!=='t').sort((a,b)=>(a.type==='f')-(b.type==='f')))await db.query(`alter table public.${q(c.table)} add constraint ${q(c.name)} ${c.definition}${!c.validated&&c.type==='f'?' not valid':''}`);
 const indexes=new Set(cat.constraints.filter(c=>['p','u','x'].includes(c.type)).map(c=>c.name));
 for(const i of cat.indexes)if(!indexes.has(i.name))await db.query(i.definition);
 for(const t of cat.tables){if(t.rls)await db.query(`alter table public.${q(t.name)} enable row level security`);if(t.force_rls)await db.query(`alter table public.${q(t.name)} force row level security`);for(const [role,privs]of Object.entries(t.acl||{}))for(const [priv,yes]of Object.entries(privs))if(yes)await db.query(`grant ${priv} on public.${q(t.name)} to ${q(role)}`);}
 for(const f of cat.functions){await db.query(`revoke all on function public.${f.signature} from public,anon,authenticated,service_role`);for(const role of ['anon','authenticated','service_role'])if(f.execute[role])await db.query(`grant execute on function public.${f.signature} to ${q(role)}`);if((f.acl||[]).some(a=>a.startsWith('=')&&a.split('/')[0].includes('X')))await db.query(`grant execute on function public.${f.signature} to public`);}
 for(const p of cat.policies){let sql=`create policy ${q(p.name)} on public.${q(p.table)} as ${p.permissive===true||p.permissive==='PERMISSIVE'?'permissive':'restrictive'} for ${p.command} to ${p.roles.map(r=>r==='public'?'public':q(r)).join(',')}`;if(p.qual)sql+=` using (${p.qual})`;if(p.with_check)sql+=` with check (${p.with_check})`;await db.query(sql);}
 for(const t of cat.triggers){await db.query(t.definition);if(t.enabled!=='O'){const action={D:'disable',R:'enable replica',A:'enable always'}[t.enabled];assert.ok(action);await db.query(`alter table public.${q(t.table)} ${action} trigger ${q(t.name)}`);}}
 // Synthetic non-personal settings from the existing isolated test baseline.
 for(const [table,rows]of Object.entries(JSON.parse(read('docs/evidence/reward-staging-upgrade/necessary-settings.json'))))for(const row of (Array.isArray(rows)?rows:[rows])){const columns=Object.keys(row);await db.query(`insert into public.${q(table)}(${columns.map(q).join(',')}) values(${columns.map((_,i)=>'$'+(i+1)).join(',')}) on conflict do nothing`,Object.values(row));}
 await db.query('set check_function_bodies=true');
 const functions=async()=>(await db.query("select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")).rows;
 const before=await functions(),claim=before.find(f=>f.signature.startsWith('claim_order_payment('));assert.ok(claim);result.claim_payment_amount_occurrences=claim.definition.split('target_order.payment_amount').length-1;assert.ok(result.claim_payment_amount_occurrences>=1);
 const booleans=(obj,file)=>{if(obj&&typeof obj==='object')for(const [key,v]of Object.entries(obj)){if(typeof v==='boolean')assert.equal(v,true,`${file}:${key}`);else if(v&&typeof v==='object')booleans(v,file);}};
 for(const file of files){await db.query(read(file));result.steps.push({order:result.steps.length+1,file,sha256:digest(read(file))});console.log('APPLIED LOCAL',file);const key=file==='supabase-student-reward-snapshots.sql'?'snapshots':file.replace('supabase-instructor-reward-','').replace('.sql','');for(const verify of verifies[key]||[]){const r=await db.query(read(verify));booleans((Array.isArray(r)?r:[r]).flatMap(x=>x.rows||[]),verify);result.verify.push({file:verify,passed:true});}}
 const after=await functions();
 const permissions=(await db.query("select p.oid::regprocedure::text signature,pg_get_userbyid(p.proowner) owner,to_json(p.proacl) acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")).rows;
 for(const f of cat.functions){const actual=permissions.find(a=>a.signature.replaceAll('public.','')===f.signature);assert.ok(actual);assert.equal(actual.owner,f.owner,`Owner ${f.signature}`);assert.deepEqual([...(actual.acl||[])].sort(),[...(f.acl||[])].sort(),`ACL ${f.signature}`);}result.originalFunctionOwnerAclPreserved=cat.functions.length;
 result.changedOriginalFunctions=before.filter(f=>after.find(a=>a.signature===f.signature)?.definition!==f.definition).map(f=>f.signature);
 const pricing=cat.functions.filter(f=>/^(quote_order_pricing_internal|promotion_|automatic_promotion_|save_discount_promotion|coupon_campaign_allows_identity|resolve_product_price_multiplier|resolve_checkout)/.test(f.name));
 for(const f of pricing){const prior=before.find(b=>b.signature.replaceAll('public.','')===f.signature)?.definition,now=after.find(b=>b.signature.replaceAll('public.','')===f.signature)?.definition;assert.ok(prior,`Pricing function found ${f.signature}`);assert.equal(now,prior,`Preserve pricing ${f.signature}`);}
 result.unchangedPricingFunctions=pricing.map(f=>f.signature);
 const expectedChanged=['create_assisted_order(uuid,jsonb)','create_order_with_pricing_discount_v2(jsonb,text,text,text,text,text,text,text,text)','quote_assisted_order(jsonb)','claim_order_payment(text,text)','begin_order_payment_retry(text)','set_order_payment_amount_defaults()'];assert.deepEqual([...result.changedOriginalFunctions].sort(),expectedChanged.sort(),'Only six reviewed existing functions may change');
 await db.query('create trigger local_simulated_signup after insert on auth.users for each row execute function public.handle_new_user()');result.authSimulation='Local auth.users and JWT claims; signup trigger simulated, not real Supabase Auth';
 await db.query(read('docs/reward-staging-upgrade/02-rollback-smoke.sql'));result.rollbackOrderSmoke=true;
 await db.query(read('tests/fixtures/reward-production-audience-replay.sql'));result.activityAudienceRuntime=true;

 const feature=(await db.query('select enabled,version from public.student_pricing_feature_settings')).rows[0];assert.equal(feature.enabled,false);assert.equal(Number(feature.version),0);result.studentPricing=feature;
 await db.query('set role authenticated');await assert.rejects(db.query('select * from public.instructor_reward_ledger'),e=>e.code==='42501');await db.query('reset role');result.directLedgerReadDenied=true;
 result.orders=(await db.query('select count(*)::int n from public.orders')).rows[0].n;assert.equal(result.orders,0);
 fs.writeFileSync(path.join(root,'docs/evidence/reward-production-preflight-20261019.json'),JSON.stringify(result,null,2)+'\n');console.log('PASS offline production-catalog migration replay',JSON.stringify({migrations:result.steps.length,verify:result.verify.length,pricingFunctions:pricing.length}));
 }finally{if(db)await db.end();await pg.stop();}
})().catch(e=>{console.error('LOCAL REPLAY FAILED',e.message);process.exit(1);});
