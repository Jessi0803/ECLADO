// PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js TZ=Asia/Taipei node --test tests/integration/admin-dashboard-db.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');

test('dashboard SQL preserves totals, bounded payment summaries and permission boundaries', { skip: !process.env.PGLITE_MODULE }, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
  const { buildMonthlyRevenue } = await import(pathToFileURL(path.join(root, 'src/admin/domain/analytics.js')).href);
  const { normalizeOrder } = await import(pathToFileURL(path.join(root, 'src/admin/domain/mappers.js')).href);
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, public to anon, authenticated;
      create table public.admin_users(user_id uuid, role text, active boolean);
      create table public.backoffice_roles(role text, active boolean);
      create table public.backoffice_role_permissions(role text, permission text);
      create table public.orders(id text primary key, member text, total numeric, status text, type text, date text,
        created_at timestamptz, transaction_date date, order_source text, assisted_payment_method text,
        items jsonb default '[]', address text default 'PRIVATE_ADDRESS', pricing_snapshot jsonb default '{}');
      create table public.order_payment_attempts(order_id text, attempt_no integer, payment_method text, payment_state text, payment_url text);
      create table public.order_payment_instructions(order_id text primary key, payment_method text, payment_state text, atm_account text);
      create table public.professional_applications(status text, contact_name text);
      create table public.products(id int, name_zh text, size text, stock int, min_stock int, publication_status text, active boolean);
      insert into public.backoffice_roles values ('admin',true), ('catalog_editor',true), ('orders_only',true);
      insert into public.backoffice_role_permissions values ('admin','orders.read'), ('admin','catalog.read'), ('admin','members.read'),
        ('catalog_editor','catalog.read'), ('orders_only','orders.read');
      insert into public.admin_users values
        ('00000000-0000-0000-0000-000000000001','admin',true),
        ('00000000-0000-0000-0000-000000000002','catalog_editor',true),
        ('00000000-0000-0000-0000-000000000003','admin',false),
        ('00000000-0000-0000-0000-000000000004','orders_only',true);
    `);
    const accessSQL = fs.readFileSync(path.join(root, 'supabase-backoffice-permissions.sql'), 'utf8');
    await db.exec(accessSQL.slice(accessSQL.indexOf('create or replace function public.has_backoffice_permission('), accessSQL.indexOf('create or replace function public.get_my_backoffice_access()')));
    await db.exec(fs.readFileSync(path.join(root, 'supabase-admin-dashboard.sql'), 'utf8'));
    const meta = (await db.query(`select p.prosecdef, p.provolatile,
      has_function_privilege('anon', p.oid, 'execute') as anon_execute,
      has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
      md5(pg_get_functiondef(p.oid)) as definition_md5
      from pg_proc p where p.oid = 'public.get_admin_dashboard()'::regprocedure`)).rows[0];
    assert.equal(meta.prosecdef, true); assert.equal(meta.provolatile, 's');
    assert.equal(meta.anon_execute, false); assert.equal(meta.authenticated_execute, true);
    console.log('Dashboard function definition MD5:', meta.definition_md5);
    const month = (await db.query("select to_char(now() at time zone 'Asia/Taipei','YYYY-MM') m")).rows[0].m;
    const previousMonth = (await db.query("select to_char((now() at time zone 'Asia/Taipei') - interval '1 month','YYYY-MM') m")).rows[0].m;
    const first = new Date(`${month}-01T00:00:00+08:00`);
    const fixtures = [
      ['paid','paid',`${month}-02`,100,'pro','online'],
      ['shipped','shipped',`${month}-03`,200,'consumer','online'],
      ['previous','delivered',`${previousMonth}-03`,300,'pro','online'],
      ['cancelled','cancelled',`${month}-04`,999,'consumer','online'],
      ['historical','paid',`${month}-05`,888,'pro','historical_manual'],
      ['card','awaiting_confirm',`${month}-06`,500,'consumer','online'],
      ['atm','unpaid',`${month}-07`,600,'consumer','online'],
      ['taipei-edge','delivered',new Date(first.getTime()+60_000).toISOString(),50,'consumer','online'],
      ['invalid','delivered','invalid-date',777,'consumer','online'],
      ['fallback','preparing',null,90,'consumer','online'],
      ['previous-edge','delivered',new Date(first.getTime()-60_000).toISOString(),25,'consumer','online'],
      ['ancient','delivered','2020-01-01',123,'consumer','online'],
    ];
    const rows = [];
    for (const [index, f] of fixtures.entries()) {
      const [id,status,date,total,type,order_source] = f;
      const created_at = new Date(first.getTime()+index*1000).toISOString();
      await db.query('insert into public.orders(id,member,status,date,total,type,order_source,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)', [id,'Member',status,date,total,type,order_source,created_at]);
      rows.push({id,status,date,total,type,order_source,created_at});
    }
    await db.exec(`update public.orders set created_at = created_at + interval '1 day' where id in ('card','atm','historical');
      update public.orders set transaction_date = date '2020-01-02' where id='historical';
      insert into public.order_payment_attempts values ('card',1,'card','pending','SECRET_URL'), ('card',2,'card','failed','SECRET_URL');
      insert into public.order_payment_instructions values ('card','atm','paid','SECRET_ACCOUNT'), ('atm','atm','pending','SECRET_ACCOUNT');
      insert into public.professional_applications values ('pending','PRIVATE_NAME'), ('approved','PRIVATE_NAME');
      insert into public.products values (1,'Low','100ml',0,3,'active',true), (2,'Enough','100ml',10,3,'active',true),
        (3,'Archived','100ml',0,3,'archived',false), (4,'Boundary','100ml',3,0,'active',true), (5,'Draft','100ml',0,3,'draft',false);
      set role authenticated;`);
    const actor = id => db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    const call = async () => (await db.query('select public.get_admin_dashboard() result')).rows[0].result;
    for (const id of ['', '00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000099']) {
      await actor(id);
      await assert.rejects(call(), error => error.code === '42501');
    }
    await actor('00000000-0000-0000-0000-000000000001');
    const result = await call();
    assert.deepEqual(result.monthlyRevenue, buildMonthlyRevenue(rows.map(normalizeOrder),new Date(`${month}-15T12:00:00+08:00`)));
    assert.equal(result.paidOrderCount,2);
    assert.equal(result.pendingApplicationCount,1);
    assert.deepEqual(result.lowStock.map(p=>p.id),[1,4]);
    assert.equal(result.recentOrders.length,5);
    const recent = Object.fromEntries(result.recentOrders.map(row=>[row.id,row]));
    assert.equal(recent.card.paymentState,'failed'); assert.equal(recent.card.status,'unpaid');
    assert.equal(recent.atm.paymentState,'pending'); assert.equal(recent.atm.status,'awaiting_confirm');
    assert.equal(recent.historical.orderSource,'historical_manual');
    assert.equal(recent.historical.transactionDate,'2020-01-02');
    assert.ok(!/SECRET_|PRIVATE_|pricing_snapshot|payment_url|atm_account|address/.test(JSON.stringify(result)));
    await db.exec("reset role; delete from public.backoffice_role_permissions where role='admin' and permission <> 'orders.read'; set role authenticated;");
    const narrow = await call(); assert.deepEqual(narrow.lowStock,[]); assert.equal(narrow.pendingApplicationCount,0);
    await db.exec('reset role; truncate public.orders, public.products, public.professional_applications; set role authenticated;');
    const empty = await call(); assert.equal(empty.monthlyRevenue.length,6);
    assert.ok(empty.monthlyRevenue.every(m=>m.revenue===0 && m.orders===0)); assert.deepEqual(empty.recentOrders,[]);
    await db.exec('reset role; set role anon;'); await assert.rejects(call(),error=>error.code==='42501');
  } finally { await db.close(); }
});
