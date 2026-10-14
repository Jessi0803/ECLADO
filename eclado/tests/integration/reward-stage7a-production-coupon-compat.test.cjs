// Read exported metadata only; reproduce the existing production mismatch locally.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {runStudentPricingDatabaseScenario}=require('./student-pricing-db.test.cjs');
test('7A: production member-targeted quote/create mismatch is reproduced without production writes',{skip:!process.env.EMBEDDED_POSTGRES_MODULE,timeout:120000},()=>runStudentPricingDatabaseScenario(async c=>{
 const metadata=JSON.parse(fs.readFileSync('docs/evidence/reward-stage7a/production-metadata.json','utf8'));
 const creator=metadata.functions.find(f=>f.name==='create_order_with_pricing_discount_v2').definition;
 assert.match(creator,/any\(target.audience_roles\)/);
 await c.db.exec(creator);await c.db.exec(c.read('supabase-student-reward-snapshots.sql'));
 await c.actor(c.student);
 await c.db.exec("update public.coupon_campaigns set active=true,per_member_limit=null,total_usage_limit=null where code_normalized='ONLY';update public.promotions set active=true where id in(select promotion_id from public.coupon_promotions where coupon_campaign_id='20000000-0000-4000-8000-000000000001')");
 const items=[{product_id:1,variant_id:1,qty:10}],q=await c.ordinaryQuote(items,'ONLY');assert.ok(q.applied_coupon_campaign_id||q.coupon_campaign_id||q.coupon,'Member-targeted quote must accept coupon');
 const before=(await c.one('select count(*)::int n from public.orders')).n;
 await assert.rejects(c.db.query(`select public.create_order_with_pricing($1::jsonb,'隔離學生','隔離地址','0900000000','student@example.test','','atm','delivery','ONLY','personal',null,null,0::bigint,$2::jsonb)`,[JSON.stringify(items),JSON.stringify(q)]),e=>e.code==='22023');
 assert.equal((await c.one('select count(*)::int n from public.orders')).n,before);
 console.log('CONFIRMED EXISTING PRODUCTION COMPATIBILITY BLOCKER: ONLY members coupon quote accepted; production creator preserved by 2A rejects 22023; no partial order');
}));
