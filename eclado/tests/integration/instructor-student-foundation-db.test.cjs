const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function fn(file, name) {
  const source = read(file), start = source.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('$$;', source.indexOf('as $$', start)) + 3);
}
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const admin = id(1), limited = id(2), teacher = id(3), teacher2 = id(4), student = id(5), student2 = id(6), consumer = id(7);

test('1B migration scope is settings/relations only; no existing price/payment/order writes', () => {
  const sql = read('supabase-instructor-student-foundation.sql');
  assert.doesNotMatch(sql, /(?:create\s+or\s+replace\s+function\s+public\.(?:quote_|create_order|claim_order|begin_order)|(?:update|insert\s+into|delete\s+from|alter\s+table)\s+public\.(?:orders|products|product_variants|membership_tiers|shopping_credit_))/i);
  assert.match(sql, /student_1 numeric not null default 0\.90/);
  assert.match(sql, /student_2 numeric not null default 0\.95/);
});

test('isolated 1B: RPC permissions, validation, history, stale writes, qualification and Auth deletion', {
  skip: !process.env.PGLITE_MODULE,
}, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE));
  const db = new PGlite();
  const query = (sql, args = []) => db.query(sql, args);
  const one = async (sql, args = []) => (await query(sql, args)).rows[0];
  const rpc = async (name, args = [], casts = []) => (await one(`select public.${name}(${args.map((_,i) => `$${i+1}${casts[i] ? `::${casts[i]}` : ''}`).join(',')}) as result`, args)).result;
  const actAs = async (uid, role = 'authenticated') => {
    await db.exec('reset role');
    await query("select set_config('test.uid',$1,false)", [uid || '']);
    await db.exec(`set role ${role}`);
  };
  const bind = (s, t, expected = null, action = 'bind') => rpc('save_instructor_student_binding', [s,t,expected,action], ['uuid','uuid','uuid','text']);
  const setting = (t, type, version) => rpc('set_instructor_student_price_type', [t,type,version], ['uuid','text','bigint']);
  const member = uid => rpc('get_admin_instructor_student_member', [uid], ['uuid']);
  const context = () => rpc('get_my_student_pricing_context');
  const deny = promise => assert.rejects(promise, error => error.code === '42501');
  const invalid = promise => assert.rejects(promise, error => error.code === '22023');
  const stale = promise => assert.rejects(promise, error => error.code === '40001');
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create table auth.users(id uuid primary key);
      create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,
        role text,name text,email text,phone text,studio_address text);
      create table public.admin_users(user_id uuid,role text,active boolean);
      create table public.backoffice_roles(role text primary key,active boolean);
      create table public.backoffice_role_permissions(role text,permission text,primary key(role,permission),
        constraint backoffice_role_permissions_permission_check check(permission in ('members.read','members.write','future_existing.manage')));
      insert into public.backoffice_roles values ('admin',true),('super_admin',true),('catalog_editor',true);
      insert into public.backoffice_role_permissions values ('admin','members.read'),('admin','members.write'),('super_admin','members.read'),('catalog_editor','future_existing.manage');
      create table public.orders(id text,user_id uuid references auth.users(id) on delete set null,total numeric,items jsonb);
      insert into public.orders values ('old-order',null,7000,'[{"unit_price":700,"qty":10}]');
      create function public.quote_order_pricing(jsonb,text) returns jsonb language sql as $$select '{"total":7000}'::jsonb$$;
      create function public.claim_order_payment(text,text) returns jsonb language sql as $$select '{"total":6999}'::jsonb$$;
      alter table public.profiles enable row level security;
      grant select on public.profiles to authenticated;
      create policy own_profile on public.profiles for select to authenticated using(id=auth.uid());
    `);
    for (const [uid, role, name] of [[admin,'consumer','管理員'],[limited,'consumer','小編'],[teacher,'instructor','老師A'],[teacher2,'instructor','老師B'],[student,'pro','學生A'],[student2,'pro','學生B'],[consumer,'consumer','一般會員']]) {
      await query('insert into auth.users values($1)', [uid]);
      await query("insert into public.profiles values($1,$2,$3,'private@example.test','0912345678','私人地址')", [uid,role,name]);
    }
    await query("insert into public.admin_users values($1,'admin',true),($2,'catalog_editor',true)", [admin,limited]);
    await db.exec(fn('supabase-backoffice-permissions.sql','has_backoffice_permission'));
    await db.exec(fn('supabase-backoffice-permissions.sql','is_eclado_admin'));
    const protectedBefore = await one(`select pg_get_functiondef('public.quote_order_pricing(jsonb,text)'::regprocedure) as pricing,
      pg_get_functiondef('public.claim_order_payment(text,text)'::regprocedure) as payment,
      (select jsonb_agg(to_jsonb(o)) from public.orders o) as orders`);
    const migration = read('supabase-instructor-student-foundation.sql');
    await db.exec(migration);
    const verification = await db.exec(read('supabase-instructor-student-foundation-verify.sql'));
    for (const [key,value] of Object.entries(verification[1].rows[0])) assert.equal(value,true,key);
    for (const row of verification[2].rows) {
      assert.equal(row.anon_denied,true,row.signature);
      assert.equal(row.client_acl_correct,true,row.signature);
    }
    await actAs(admin);
    const defaults = await rpc('get_admin_student_pricing_settings');
    assert.deepEqual(defaults.multipliers, { student_1:0.9, student_2:0.95 });
    assert.equal(defaults.prices_applied, false);
    assert.equal((await member(teacher)).instructor_settings, null);
    await invalid(bind(student,teacher)); // Type required.
    await invalid(setting(consumer,'student_1',0));
    await invalid(setting(teacher,'unknown',0));
    await setting(teacher,'student_1',0);
    await setting(teacher2,'student_2',0);
    await invalid(bind(consumer,teacher));
    await invalid(bind(student,consumer));
    await invalid(bind(teacher,teacher));
    await invalid(bind(student,teacher,null,'unexpected'));
    const first = await bind(student,teacher);
    const original = first.context.binding_id;
    assert.equal(first.context.student_pricing_eligible, true);
    await stale(bind(student,teacher2));
    await invalid(bind(student,teacher2,original));
    await invalid(bind(student,consumer,original,'rebind'));
    assert.equal((await member(student)).context.binding_id, original); // Failed swap is atomic.
    await bind(student2,teacher);
    assert.equal((await member(teacher)).students.length, 2);
    await setting(teacher,null,1); // Keep relationships; pause qualification.
    assert.equal((await member(teacher)).students.length, 2);
    assert.equal((await member(student)).context.student_pricing_eligible, false);
    await setting(teacher,'student_2',2);
    await stale(setting(teacher,'student_1',2));
    assert.equal((await member(student)).context.student_pricing_eligible, true);

    for (const bad of [null, {}, {student_1:null,student_2:0.95}, {student_1:'NaN',student_2:0.95},
      {student_1:'Infinity',student_2:0.95}, {student_1:0,student_2:0.95}, {student_1:-0.1,student_2:0.95},
      {student_1:1.001,student_2:0.95}, {student_1:0.9001,student_2:0.95}, {student_1:0.9,student_2:0.95,extra:1}]) {
      await invalid(rpc('save_student_pricing_settings',[JSON.stringify(bad),0],['jsonb','bigint']));
    }
    const saved = await rpc('save_student_pricing_settings',[JSON.stringify({student_1:0.88,student_2:0.96}),0],['jsonb','bigint']);
    assert.equal(saved.version, 1);
    await stale(rpc('save_student_pricing_settings',[JSON.stringify({student_1:0.9,student_2:0.95}),0],['jsonb','bigint']));
    assert.equal((await rpc('get_admin_student_pricing_history')).length, 1);
    assert.equal((await member(teacher)).history.filter(x => x.event_type === 'instructor_type').length, 3);

    for (const uid of [teacher,student,consumer,limited]) {
      await actAs(uid);
      await deny(setting(teacher,'student_1',3));
      await deny(bind(student,teacher2,original,'rebind'));
      await deny(rpc('save_student_pricing_settings',[JSON.stringify({student_1:0.9,student_2:0.95}),1],['jsonb','bigint']));
      await deny(member(student));
      await deny(query('select * from public.instructor_student_bindings'));
      await deny(query('update public.student_pricing_settings set student_1=0.5'));
    }
    await actAs(student);
    const own = await context();
    assert.equal(own.instructor_id, teacher);
    assert.equal(own.student_price_type, 'student_2');
    assert.equal(own.prices_applied, false);
    assert.doesNotMatch(JSON.stringify(own), /private@example|0912345678|私人地址|professional_price|rebate/);
    await deny(query('select public.instructor_student_context($1)', [student]));
    await actAs(teacher);
    const students = await rpc('get_my_instructor_students');
    assert.deepEqual(students.map(x => x.student_name), ['學生A','學生B']);
    assert.doesNotMatch(JSON.stringify(students), /email|phone|address|student_id/);
    assert.equal((await query('select count(*)::int as n from public.profiles')).rows[0].n,1); // RLS still own-only.
    await actAs(teacher2);
    assert.deepEqual(await rpc('get_my_instructor_students'), []);
    await actAs(student);
    await deny(rpc('get_my_instructor_students'));
    await actAs(null,'anon');
    await deny(context());
    await deny(bind(student,teacher));

    // Role changes preserve bindings and resume eligibility after restoration.
    for (const [uid, originalRole] of [[teacher,'instructor'],[student,'pro']]) {
      await db.exec('reset role');
      await query("update public.profiles set role='consumer' where id=$1", [uid]);
      await actAs(student);
      assert.equal((await context()).has_binding, true);
      assert.equal((await context()).student_pricing_eligible, false);
      await db.exec('reset role');
      await query('update public.profiles set role=$2 where id=$1',[uid,originalRole]);
      await actAs(student);
      assert.equal((await context()).student_pricing_eligible, true);
    }
    await actAs(admin);
    // Force failure after the old relationship has been ended, proving the
    // entire RPC rolls back rather than only testing pre-write validation.
    await db.exec('reset role');
    await db.exec(`create function public.test_fail_rebind_insert() returns trigger language plpgsql as $$
      begin if new.instructor_id='${teacher2}'::uuid then raise exception 'test late insert failure'; end if; return new; end; $$;
      create trigger test_fail_rebind before insert on public.instructor_student_bindings
        for each row execute function public.test_fail_rebind_insert();`);
    const auditBeforeFailure=(await one('select count(*)::int as n from public.instructor_student_audit_logs')).n;
    await actAs(admin);
    await assert.rejects(bind(student,teacher2,original,'rebind'), /test late insert failure/);
    assert.equal((await member(student)).context.binding_id,original);
    await db.exec('reset role');
    assert.equal((await one('select count(*)::int as n from public.instructor_student_audit_logs')).n,auditBeforeFailure);
    await db.exec('drop trigger test_fail_rebind on public.instructor_student_bindings; drop function public.test_fail_rebind_insert();');
    await actAs(admin);
    const swapped = await bind(student,teacher2,original,'rebind');
    assert.equal(swapped.context.instructor_id, teacher2);
    const swapEvent = swapped.history.find(x => x.event_type === 'rebind');
    assert.equal(swapEvent.previous_instructor_id,teacher);
    assert.equal(swapEvent.instructor_id,teacher2);
    assert.equal(swapEvent.actor_user_id,admin);
    await bind(student,null,swapped.context.binding_id,'unbind');
    assert.equal((await member(student)).context.has_binding,false);
    // Overlapping submissions on one PGlite connection are queued; this checks
    // competing stale requests plus uniqueness, not PostgreSQL multi-session locks.
    const competing = await Promise.allSettled([bind(student,teacher),bind(student,teacher2)]);
    assert.equal(competing.filter(x => x.status === 'fulfilled').length,1);
    await db.exec('reset role');
    await assert.rejects(query(`insert into public.instructor_student_bindings(student_id,instructor_id,created_by)
      values($1,$2,$3)`,[student,teacher2,admin]), error => error.code === '23505');
    await deny(query("update public.instructor_student_audit_logs set event_type='unbind'"));
    await deny(query('delete from public.instructor_student_audit_logs'));
    const rowBefore = await one('select * from public.orders');
    await db.exec(migration); // Preserve stored settings, relationships and history on reapply.
    await actAs(admin);
    assert.equal((await rpc('get_admin_student_pricing_settings')).version,1);
    await db.exec('reset role');
    assert.deepEqual(await one(`select pg_get_functiondef('public.quote_order_pricing(jsonb,text)'::regprocedure) as pricing,
      pg_get_functiondef('public.claim_order_payment(text,text)'::regprocedure) as payment,
      (select jsonb_agg(to_jsonb(o)) from public.orders o) as orders`), protectedBefore);
    const countBefore = (await one('select count(*)::int as n from public.instructor_student_audit_logs')).n;
    await query("select set_config('test.uid','',false)");
    await query('delete from auth.users where id=$1',[teacher]);
    assert.equal((await one('select count(*)::int as n from public.instructor_student_bindings where instructor_id=$1 and ended_at is null',[teacher])).n,0);
    assert.ok((await one('select count(*)::int as n from public.instructor_student_audit_logs')).n>countBefore);
    assert.ok((await one("select count(*)::int as n from public.instructor_student_audit_logs where event_type='member_deleted' and actor_kind='system'")).n>0);
    await query('delete from auth.users where id=$1',[student]);
    assert.equal((await one('select count(*)::int as n from public.instructor_student_bindings where student_id=$1 and ended_at is null',[student])).n,0);
    assert.ok((await one('select count(*)::int as n from public.instructor_student_bindings where student_id=$1',[student])).n>0);
    assert.deepEqual(await one('select * from public.orders'),rowBefore);
    assert.doesNotMatch(JSON.stringify((await query('select * from public.instructor_student_audit_logs')).rows), /private@example|0912345678|私人地址/);
    assert.equal((await one("select count(*)::int as n from public.backoffice_role_permissions where permission='future_existing.manage'")).n,1);
  } finally { await db.close(); }
});
