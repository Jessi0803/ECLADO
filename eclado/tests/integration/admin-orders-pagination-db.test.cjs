// PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node --test tests/integration/admin-orders-pagination-db.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');

test('paginated order RPCs preserve cross-page filters, lazy details and administrator boundaries', { skip: !process.env.PGLITE_MODULE }, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
  const { normalizeOrder } = await import(pathToFileURL(path.join(root,'src/admin/domain/mappers.js')).href);
  const { getOrderInventoryState } = await import(pathToFileURL(path.join(root,'src/admin/domain/orderInventory.js')).href);
  const db = new PGlite();
  const admin='00000000-0000-0000-0000-000000000001', member='10000000-0000-0000-0000-000000000001';
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to anon,authenticated;
      create table public.admin_users(user_id uuid,role text,active boolean);
      create table public.backoffice_roles(role text,active boolean);
      create table public.backoffice_role_permissions(role text,permission text);
      create table public.profiles(id uuid primary key,email text);
      create table public.member_admin_notes(user_id uuid primary key,note text);
      create table public.orders(id text primary key,member text,type text,total numeric,status text,date text,user_id uuid,
        order_source text,fulfillment_method text default 'delivery',created_at timestamptz,assisted_payment_method text,
        items jsonb default '[]',note text,email text,phone text,tracking text,pricing_snapshot jsonb default '{}',
        transaction_date date,shipping_group_id uuid,subtotal numeric,discount numeric default 0,
        paid_at timestamptz,address text,invoice_number text,private_token text default 'SECRET_ORDER_TOKEN');
      create table public.order_inventory_allocations(order_id text,item_index int,allocated_qty int,backorder_qty int,state text,primary key(order_id,item_index));
      create table public.order_payment_attempts(order_id text,attempt_no int,payment_method text,payment_state text,
        provider_status text,provider_description text,created_at timestamptz,updated_at timestamptz,payment_url text default 'SECRET_PAYMENT_URL',primary key(order_id,attempt_no));
      create table public.order_payment_instructions(order_id text primary key,attempt_no int default 1,payment_method text,payment_state text,
        provider_status text,provider_description text,gateway_created_at timestamptz,updated_at timestamptz,atm_account text default 'SECRET_ACCOUNT');
      create table public.order_admin_notes(order_id text primary key,note text);
      create table public.shipping_groups(id uuid primary key,status text,created_at timestamptz,locked_at timestamptz,
        original_order_id text,original_shipping_amount bigint,shipping_refund_ledger_id bigint,shipping_refunded_at timestamptz);
      alter table public.orders enable row level security;
      insert into public.backoffice_roles values ('admin',true),('catalog_editor',true),('reader',true);
      insert into public.backoffice_role_permissions values ('admin','orders.read'),('admin','members.read'),('reader','orders.read'),('catalog_editor','catalog.read');
      insert into public.admin_users values ('${admin}','admin',true),
        ('00000000-0000-0000-0000-000000000002','catalog_editor',true),
        ('00000000-0000-0000-0000-000000000003','admin',false),
        ('00000000-0000-0000-0000-000000000004','reader',true);
      insert into public.profiles values ('${member}','private@example.test');
      insert into public.member_admin_notes values ('${member}','週二出貨');`);
    const access=fs.readFileSync(path.join(root,'supabase-backoffice-permissions.sql'),'utf8');
    await db.exec(access.slice(access.indexOf('create or replace function public.has_backoffice_permission('),access.indexOf('create or replace function public.get_my_backoffice_access()')));
    const shipping=fs.readFileSync(path.join(root,'supabase-professional-shipping-groups.sql'),'utf8');
    await db.exec(shipping.slice(shipping.indexOf('create or replace function public.is_shipping_group_valid_order_status('),shipping.indexOf('create or replace function public.get_my_appendable_shipping_group()')));
    await db.exec(fs.readFileSync(path.join(root,'supabase-admin-order-pagination.sql'),'utf8'));
    const statuses=['paid','preparing','unpaid','awaiting_confirm','cancelled','ready_for_pickup','picked_up','shipped','delivered','returned'];
    const raw=[];
    for(let i=0;i<120;i++) {
      const row={id:`ORD${String(i).padStart(6,'0')}`,member:i===1?'100% Literal':'Member',type:'consumer',total:100+i,
        status:statuses[i%10],date:'2026-10-20',user_id:member,order_source:i%13===0?'historical_manual':i%17===0?'admin_assisted':'online',
        created_at:'2026-10-20T02:00:00Z',items:[{name:'Item',qty:3,price:100,...(i%4===0?{}:{stock_at_order:i%4===1?0:3})}],
        email:i===1?'older@example.test':'other@example.test',phone:'0912345678',note:i%7===0?'管理室':'',tracking:'',
        payment_method:i%2===0?'card':'atm',payment_state:'pending',subtotal:100+i,discount:0};
      await db.query(`insert into public.orders(id,member,type,total,status,date,user_id,order_source,created_at,items,email,phone,note,subtotal)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$4)`,[row.id,row.member,row.type,row.total,row.status,row.date,row.user_id,row.order_source,row.created_at,JSON.stringify(row.items),row.email,row.phone,row.note]);
      await db.query('insert into public.order_payment_instructions(order_id,payment_method,payment_state) values($1,$2,$3)',[row.id,row.payment_method,row.payment_state]);
      if(i%5===0){const a={item_index:0,allocated_qty:3,backorder_qty:0,state:'allocated'};
        await db.query('insert into public.order_inventory_allocations values($1,0,3,0,\'allocated\')',[row.id]);row.inventory_allocations=[a];}
      raw.push(row);
    }
    // A failed newest payment must not hide an earlier paid record in the on-demand detail.
    const first=raw.find(row=>row.id==='ORD000001');first.payment_method='card';first.payment_state='failed';
    await db.exec(`insert into public.order_payment_attempts(order_id,attempt_no,payment_method,payment_state) values
      ('ORD000001',1,'card','paid'),('ORD000001',2,'card','failed');
      insert into public.order_admin_notes values ('ORD000001','Internal audit note');
      insert into public.shipping_groups values ('20000000-0000-0000-0000-000000000001','open',now(),null,'ORD000001',200,1,now());
      update public.orders set shipping_group_id='20000000-0000-0000-0000-000000000001',transaction_date='2026-10-01',address='Saved address'
        where id in ('ORD000001','ORD000119');`);
    await db.exec('set role authenticated;');
    const actor=id=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
    const page=async(p=1,size=50,status='all',stock='all',search='')=>(await db.query('select public.get_admin_orders_page($1,$2,$3,$4,$5) data',[p,size,status,stock,search])).rows[0].data;
    const detail=async id=>(await db.query('select public.get_admin_order_detail($1) data',[id])).rows[0].data;
    for(const id of ['', '00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000099']) {
      await actor(id);await assert.rejects(page(),e=>e.code==='42501');await assert.rejects(detail('ORD000001'),e=>e.code==='42501');
    }
    await actor(admin);
    const normalized=raw.map(normalizeOrder).sort((a,b)=>a.id<b.id?1:-1);
    const all=normalized.filter(row=>row.status!=='cancelled');
    const pages=await Promise.all([page(1),page(2),page(3)]);
    assert.deepEqual(pages.map(p=>p.orders.length),[50,50,8]);
    assert.deepEqual(pages.flatMap(p=>p.orders.map(row=>row.id)),all.map(row=>row.id));
    assert.equal(new Set(pages.flatMap(p=>p.orders.map(row=>row.id))).size,108);
    assert.equal((await page(99999)).page,3);
    for(const p of pages)for(const row of p.orders){const old=normalized.find(o=>o.id===row.id);
      assert.equal(row.status,old.status);assert.equal(row.payment_method,old.paymentMethod);
      assert.equal(row.inventory_state,getOrderInventoryState(old));
      assert.ok(!('items' in row));assert.ok(!('payment_attempts' in row));assert.ok(!('address' in row));assert.ok(!('email' in row));}
    assert.equal(pages[0].statusCounts.unpaid,normalized.filter(o=>o.status==='unpaid').length);
    assert.equal(pages[0].inventoryCounts.backordered,all.filter(o=>getOrderInventoryState(o)==='backordered').length);
    for(const status of ['shipped','delivered','cancelled','awaiting_confirm','unpaid']){
      const expected=normalized.filter(o=>status==='shipped'?['shipped','ready_for_pickup'].includes(o.status):status==='delivered'?['delivered','picked_up'].includes(o.status):o.status===status);
      assert.deepEqual((await page(1,100,status)).orders.map(o=>o.id),expected.map(o=>o.id));}
    assert.deepEqual((await page(1,100,'all','backordered')).orders.map(o=>o.id),all.filter(o=>getOrderInventoryState(o)==='backordered').map(o=>o.id));
    assert.deepEqual((await page(1,50,'all','all','older@example.test')).orders.map(o=>o.id),['ORD000001']);
    assert.equal((await page(1,50,'all','all','%')).total,1); // literal, not SQL wildcard
    assert.equal((await page(1,50,'all','all',"'; drop table orders; --")).total,0);
    for(const args of [[0], [1,0], [1,101], [1,50,'bad'], [1,50,'all','bad'], [1,50,'all','all','x'.repeat(201)]])await assert.rejects(page(...args),e=>e.code==='22023');
    const d=await detail('ORD000001');
    assert.equal(d.order.id,'ORD000001');assert.equal(d.order.transaction_date,'2026-10-01');
    assert.equal(d.order.payment_attempts.length,2);assert.equal(d.order.payment_attempts[0].payment_state,'paid');
    assert.equal(d.order.payment_state,'failed');assert.equal(d.order.admin_note,'Internal audit note');
    assert.equal(d.memberNote,'週二出貨');assert.equal(d.linkedMemberExists,true);
    assert.equal(d.order.shipping_group.orders.length,2);
    assert.equal(d.order.shipping_group.effective_total,101);
    assert.equal(d.order.shipping_group.requires_manual_review,true);
    assert.ok(!JSON.stringify(d).includes('SECRET_'));
    await assert.rejects(detail('missing'),e=>e.code==='P0002');
    await assert.rejects(detail(''),e=>e.code==='22023');
    await assert.rejects(db.query("select * from public._admin_order_list_rows('')"),e=>e.code==='42501');
    await assert.rejects(db.query('select * from public.orders'),e=>e.code==='42501');
    await db.exec("reset role; delete from public.backoffice_role_permissions where role='admin' and permission='members.read'; set role authenticated;");
    assert.equal((await detail('ORD000001')).linkedMemberExists,false);
    await db.exec('reset role;');
    const counts=(await db.query('select count(*) n from public.orders')).rows[0].n;assert.equal(counts,120);
    console.log('Order RPC definition MD5:',(await db.query(`select p.proname,md5(pg_get_functiondef(p.oid)) md5 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('_admin_order_quantity','_admin_order_inventory_state','_admin_order_list_rows','get_admin_orders_page','get_admin_order_detail') order by p.proname`)).rows);
    await db.exec('truncate public.orders; set role authenticated;');
    const empty=await page();assert.equal(empty.total,0);assert.equal(empty.page,1);assert.deepEqual(empty.orders,[]);
    await db.exec('reset role; set role anon;');await assert.rejects(page(),e=>e.code==='42501');await assert.rejects(detail('ORD000001'),e=>e.code==='42501');
  } finally {await db.close();}
});
