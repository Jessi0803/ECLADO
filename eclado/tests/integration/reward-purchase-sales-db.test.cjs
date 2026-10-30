const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../..'),read=n=>fs.readFileSync(path.join(root,n),'utf8');
const fn=(file,name)=>{const s=read(file),a=s.indexOf(`create or replace function public.${name}(`);assert.ok(a>=0,name);return s.slice(a,s.indexOf('$$;',s.indexOf('as $$',a))+3);};
const admin='11111111-1111-4111-8111-111111111111',teacher='33333333-3333-4333-8333-333333333333',student='22222222-2222-4222-8222-222222222222';
async function purchaseFixture(){
 const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create table public.admin_users(user_id uuid,role text,active boolean);create table public.backoffice_roles(role text,active boolean);create table public.backoffice_role_permissions(role text,permission text);
 create table public.profiles(id uuid,role text);create table public.instructor_reward_accounts(user_id uuid);
 create table public.professional_memberships(id uuid,user_id uuid,role text,started_on date,ended_on date);
 create table public.professional_sales_adjustments(membership_id uuid,quarter_start date,amount numeric);
 create table public.professional_award_evidence(user_id uuid,assessment_year integer,student_name text,status text);
 create table public.orders(id text,user_id uuid,status text,paid_at timestamptz,subtotal numeric,discount numeric,total numeric,items jsonb,pricing_snapshot jsonb,shopping_credit_amount numeric,reward_credit_amount numeric);
 insert into public.admin_users values('${admin}','admin',true);insert into public.backoffice_roles values('admin',true);
 insert into public.backoffice_role_permissions values('admin','orders.read'),('admin','members.read');
 insert into public.profiles values('${teacher}','instructor'),('${student}','pro');
 insert into public.professional_memberships values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${teacher}','instructor','2025-01-15','2025-05-01');
 insert into public.professional_sales_adjustments values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2025-01-01',1000),('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','2025-04-01',2000);
 grant usage on schema auth to authenticated,anon,service_role;`);
 for(const [file,name] of [['supabase-backoffice-permissions.sql','has_backoffice_permission'],['supabase-backoffice-permissions.sql','is_eclado_admin'],['supabase-instructor-reward-queries.sql','assert_instructor_reward_read_admin'],['supabase-member-quarterly-sales.sql','order_net_merchandise_amount'],['supabase-professional-renewals.sql','get_professional_renewal_assessment']])await db.exec(fn(file,name));
 await db.exec(read('supabase-instructor-reward-purchase-sales.sql'));
 const actor=uid=>db.query("select set_config('test.uid',$1,false)",[uid||'']);await actor(admin);
 const add=(id,date,status,amount=1000,user=teacher)=>db.query(`insert into public.orders values($1,$2,$3,$4,$5::numeric,0,$5::numeric+120,'[]','{"shipping":120}',300,200)`,[id,user,status,date,amount]);
 await add('first','2025-01-14T16:00:00Z','paid',10000);await add('before-qualification','2025-01-14T15:59:59Z','paid',99999);
 await add('quarter-end','2025-03-31T15:59:59Z','shipped',2000);await add('next-quarter','2025-03-31T16:00:00Z','delivered',1000);
 await add('after-membership','2025-04-30T16:00:00Z','paid',99999);await add('student-order','2025-02-01T00:00:00Z','paid',99999,student);
 for(const status of ['returned','cancelled','pending'])await add(status,'2025-02-01T00:00:00Z',status,99999);
 await add('missing-payment-date',null,'paid',99999);await db.exec("update public.orders set subtotal=12000,discount=2000 where id='first'");
 const query=async(ids=[teacher],year=2025)=>(await db.query('select public.get_admin_reward_purchase_sales($1,$2) q',[ids,year])).rows[0].q;
 return {db,actor,query,add,admin,teacher,student};
}
module.exports={purchaseFixture};
if(require.main===module)test('purchase sales: renewal parity, Taipei dates, qualification and admin ACL', {skip:!process.env.PGLITE_MODULE,timeout:60000},async()=>{
 const {db,query,actor}=await purchaseFixture();try{
 const before=(await db.query('select count(*) n from public.orders')).rows[0].n;
 const row=(await query()).accounts[0];assert.equal(row.months.length,12);
 for(const [month,amount] of [[1,10000],[2,0],[3,2000],[4,1000],[5,0]])assert.equal(Number(row.months.find(m=>m.month===month).amount),amount);
 const assessment=(await db.query('select public.get_professional_renewal_assessment($1,2025) q',[teacher])).rows[0].q;
 assert.deepEqual(row.quarters.map(q=>[q.quarter,q.online_amount,q.offline_amount,q.amount]),assessment.quarters.map(q=>[q.calendar_quarter,q.online_sales_amount,q.offline_sales_amount,q.sales_amount]));
 assert.equal(Number(row.quarters[0].amount),13000);assert.equal(Number(row.quarters[1].amount),3000);
 for(const q of row.quarters)assert.equal(row.months.filter(m=>Math.ceil(m.month/3)===q.quarter).reduce((n,m)=>n+Number(m.amount),0),Number(q.online_amount));
 assert.equal((await query([teacher,teacher,student])).accounts.length,1);assert.deepEqual((await query([])).accounts,[]);
 for(const args of [[null,2025],[Array(51).fill(teacher),2025],[[null],2025],[[teacher],1999],[[teacher],9999]])await assert.rejects(query(...args),e=>e.code==='22023');
 for(const uid of [student,teacher,null]){await actor(uid);await assert.rejects(query(),e=>e.code==='42501');}
 await actor(admin);await db.exec('update public.admin_users set active=false');await assert.rejects(query(),e=>e.code==='42501');await db.exec('update public.admin_users set active=true');
 await db.exec("delete from public.backoffice_role_permissions where permission='members.read'");await assert.rejects(query(),e=>e.code==='42501');await db.exec("insert into public.backoffice_role_permissions values('admin','members.read')");
 for(const role of ['anon','service_role'])assert.equal((await db.query("select has_function_privilege($1,'public.get_admin_reward_purchase_sales(uuid[],integer)','EXECUTE') allowed",[role])).rows[0].allowed,false);
 await db.exec('set role authenticated');assert.equal((await query()).accounts.length,1);await db.exec('reset role');assert.equal((await db.query('select count(*) n from public.orders')).rows[0].n,before);
 }finally{await db.close();}
});
