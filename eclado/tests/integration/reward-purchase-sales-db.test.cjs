const { test } = require('node:test');
const assert = require('node:assert/strict');
const { purchaseFixture } = require('../fixtures/reward-purchase-sales-db.cjs');

test('purchase sales: renewal parity, Taipei dates, qualification and admin ACL', {skip:!process.env.PGLITE_MODULE,timeout:60000},async()=>{
 const {db,query,actor,admin,teacher,student}=await purchaseFixture();try{
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
