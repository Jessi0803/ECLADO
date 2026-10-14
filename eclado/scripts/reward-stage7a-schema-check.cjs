// Disposable PG17.6 only. Export actual baseline/expected metadata, no remote DB.
const fs=require('node:fs'),path=require('node:path');
const {runStudentPricingDatabaseScenario}=require('../tests/integration/student-pricing-db.test.cjs');
const {runRewardCheckoutDatabaseScenario}=require('../tests/integration/instructor-reward-checkout-db.test.cjs');
const folder=path.resolve(__dirname,'../docs/evidence/reward-stage7a');
const source=fs.readFileSync(path.resolve(__dirname,'../docs/reward-stage7a-production-metadata-readonly.sql'),'utf8');
const query=source.slice(source.indexOf('WITH relations'),source.lastIndexOf('ROLLBACK;'));
async function save(db,name){const rows=(await db.query(query)).rows;const result=Object.fromEntries(rows.map(r=>[r.section,r.payload]));fs.writeFileSync(path.join(folder,name+'.json'),JSON.stringify(result,null,2));return result;}
(async()=>{
 if(!process.env.EMBEDDED_POSTGRES_MODULE)throw new Error('Local embedded PostgreSQL required');
 await runStudentPricingDatabaseScenario(async({db})=>{await save(db,'baseline-1c-metadata');});
 await runRewardCheckoutDatabaseScenario(async c=>{
  await c.db.exec(c.read('supabase-instructor-reward-withdrawals.sql'));
  await c.db.exec('alter table public.profiles add column email text,add column line_user_id text');
  await c.db.exec(c.read('supabase-instructor-reward-notifications.sql'));await c.db.exec(c.read('supabase-instructor-reward-reconciliation.sql'));
  const expected=await save(c.db,'expected-stage6-metadata');
  const production=JSON.parse(fs.readFileSync(path.join(folder,'production-metadata.json'),'utf8'));
  const baseline=JSON.parse(fs.readFileSync(path.join(folder,'baseline-1c-metadata.json'),'utf8'));
  const newFiles=['supabase-student-reward-snapshots.sql','supabase-instructor-reward-ledger.sql','supabase-instructor-reward-queries.sql','supabase-instructor-reward-checkout.sql','supabase-instructor-reward-withdrawals.sql','supabase-instructor-reward-notifications.sql','supabase-instructor-reward-reconciliation.sql'];
  const newTables=[...new Set(newFiles.flatMap(name=>[...c.read(name).matchAll(/create table(?: if not exists)? public\.([a-z_]+)/gi)].map(m=>m[1])))];
  const results={newTables:newTables.map(name=>({name,productionPresent:production.tables.some(t=>t.name===name),expectedPresent:expected.tables.some(t=>t.name===name)})),baselineFunctions:[]};
  for(const f of baseline.functions){const p=production.functions.find(x=>x.signature===f.signature);results.baselineFunctions.push({signature:f.signature,productionPresent:!!p,definitionMatches:!!p&&p.normalized_md5===f.normalized_md5,aclMatches:!!p&&['anon','authenticated','service_role'].every(role=>p.execute[role]===f.execute[role]),expectedSecurityDefiner:f.security_definer,productionSecurityDefiner:p?.security_definer});}
  const patched=['create_order_with_pricing_discount_v2','create_assisted_order','set_order_payment_amount_defaults','begin_order_payment_retry','claim_order_payment'];results.patchedBaseline=results.baselineFunctions.filter(f=>patched.some(name=>f.signature.startsWith(name+'(')));
  fs.writeFileSync(path.join(folder,'schema-comparison.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({newTables:results.newTables,patchedBaseline:results.patchedBaseline}));
 });
})().catch(e=>{console.error(e);process.exitCode=1;});
