const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
test('analytics SQL aggregates all orders, Taipei boundaries, snapshots, gifts and permissions', { skip: !process.env.PGLITE_MODULE }, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      create function public.is_eclado_admin() returns boolean language sql as $$ select coalesce(current_setting('test.admin',true),'')='yes' $$;
      create function public.has_backoffice_permission(p text) returns boolean language sql as $$ select p='analytics.read' and coalesce(current_setting('test.permission',true),'')='yes' $$;
      grant usage on schema auth,public to authenticated;
      create table public.orders(total numeric,type text,items jsonb,date text,created_at timestamptz,status text,order_source text,user_id uuid);
      insert into orders(total,type,items,date,created_at,status,order_source) select 10,'pro','[{"product_id":1,"variant_id":11,"name":"已下架安瓶","size":"30ml","qty":2},{"product_id":2,"name":"贈品","qty":1,"is_gift":true}]',
        '2026-10-18','2026-10-18T12:00:00Z','paid','online' from generate_series(1,1001);
      insert into orders(total,type,items,date,created_at,status,order_source) values
        (50,'consumer','[{"product_id":1,"name":"已下架安瓶","qty":3}]','2026-10-18T15:59:59Z',null,'shipped','admin_assisted'),
        (99,'consumer','[]','2026-10-18T16:00:00Z',null,'paid','online'),
        (99,'consumer','[]','2026-10-18',null,'unpaid','online'),
        (99,'consumer','[]','2026-10-18',null,'cancelled','online'),
        (99,'consumer','[]','2026-10-18',null,'paid','historical_manual'),
        (99,'consumer','[]','invalid',null,'paid','online'),
        (20,'consumer','[{"product_id":3,"qty":0},{"product_id":3,"qty":-1},{"product_id":3,"qty":"bad"}]',null,'2026-10-17T16:00:00Z','delivered','online');`);
    await db.exec(fs.readFileSync(path.resolve(__dirname,'../../supabase-admin-analytics.sql'),'utf8'));
    const call = async (start='2026-10-18',end=start) => (await db.query('select get_admin_analytics($1::date,$2::date) result',[start,end])).rows[0].result;
    assert.equal((await db.query("select has_function_privilege('anon','get_admin_analytics(date,date)','execute') allowed")).rows[0].allowed,false);
    await assert.rejects(call(),e=>e.code==='42501');
    await db.exec("set role authenticated; set test.uid='00000000-0000-0000-0000-000000000001'; set test.admin='yes';");
    await assert.rejects(call(),e=>e.code==='42501');
    await db.exec("set test.permission='yes';");
    const data = await call();
    assert.deepEqual(data.daily,[{ date:'2026-10-18',revenue:10080,orders:1003,proRevenue:10010,byRole:{guest:70,pro:10010} }]);
    assert.equal(data.productSales.reduce((n,r)=>n+r.quantity,0),2005);
    assert.equal(data.productSales.reduce((n,r)=>n+r.gifts,0),1001);
    assert.ok(data.productSales.some(r=>r.size==='未記錄規格'&&r.quantity===3));
    assert.ok(data.productSales.some(r=>r.name==='已下架安瓶'));
    assert.deepEqual(data.memberRevenue,[{role:'guest',revenue:70,orders:2},{role:'pro',revenue:10010,orders:1001}]);
    await db.exec(`reset role;
      insert into orders(total,type,items,date,status,user_id) values
        (100,'consumer','[]','2026-10-18','paid','00000000-0000-0000-0000-000000000001'),
        (200,'instructor','[]','2026-10-18','paid',null),
        (300,'distributor','[]','2026-10-18','paid',null),
        (400,'staff','[]','2026-10-18','paid',null),
        (500,'unexpected','[]','2026-10-18','paid',null);
      set role authenticated;`);
    const grouped = await call();
    assert.deepEqual(Object.fromEntries(grouped.memberRevenue.map(r=>[r.role,r.revenue])),{
      consumer:100,distributor:300,guest:70,instructor:200,other:500,pro:10010,staff:400
    });
    assert.deepEqual(grouped.daily[0].byRole,Object.fromEntries(grouped.memberRevenue.map(r=>[r.role,r.revenue])));
    assert.equal(grouped.memberRevenue.reduce((n,r)=>n+r.revenue,0),grouped.daily.reduce((n,r)=>n+r.revenue,0));

    assert.deepEqual((await call('2026-09-01')).daily,[]);
    await assert.rejects(call('2026-10-19','2026-10-18'),e=>e.code==='22023');
    await assert.rejects(call(null,null),e=>e.code==='22023');
    for (const [start,end] of [['2026-10-29','2027-10-29'],['2023-03-01','2024-03-01'],['2024-02-29','2025-02-28']]) {
      await assert.rejects(call(start,end),e=>e.code==='22023' && e.message.includes('最多一年'));
    }
    for (const [start,end] of [['2026-10-29','2027-10-28'],['2023-03-01','2024-02-29'],['2024-02-29','2025-02-27']]) {
      await call(start,end);
    }

    await db.exec("set test.admin='no';");
    await assert.rejects(call(),e=>e.code==='42501');
  } finally { await db.close(); }
});
