const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const fn = (file, name) => { const s = read(file), start = s.indexOf(`create or replace function public.${name}(`); assert.ok(start >= 0); return s.slice(start, s.indexOf('$$;', s.indexOf('as $$', start)) + 3); };
const admin = '11111111-1111-4111-8111-111111111111';
const student = '22222222-2222-4222-8222-222222222222';
const teacher = '33333333-3333-4333-8333-333333333333';
const teacher2 = '44444444-4444-4444-8444-444444444444';
async function bindingNotificationFixture() {
 const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
 const db = new PGlite();
 try {
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema extensions;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select current_setting('test.role',true)$$;
 create function extensions.gen_random_uuid() returns uuid language sql as $$select gen_random_uuid()$$;
 grant usage on schema auth,extensions to authenticated,anon,service_role;
 create table auth.users(id uuid primary key);
 create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,role text,name text,email text,line_user_id text);
 create table public.admin_users(user_id uuid,role text,active boolean);
 create table public.backoffice_roles(role text primary key,active boolean);
 create table public.backoffice_role_permissions(role text,permission text,primary key(role,permission),constraint backoffice_role_permissions_permission_check check(permission in('members.read','members.write','notifications.send')));
 insert into public.admin_users values('${admin}','admin',true);insert into public.backoffice_roles values('admin',true);
 insert into public.backoffice_role_permissions values('admin','members.read'),('admin','members.write'),('admin','notifications.send');`);
 for (const name of ['has_backoffice_permission','is_eclado_admin']) await db.exec(fn('supabase-backoffice-permissions.sql',name));
 await db.exec(fn('supabase-instructor-reward-ledger.sql','reject_instructor_reward_history_changes'));
 await db.exec(read('supabase-instructor-student-foundation.sql'));
 for (const [id,role,name] of [[admin,'consumer','示範管理員'],[student,'pro','陳小美'],[teacher,'instructor','王老師'],[teacher2,'instructor','李老師']]) {
  await db.query('insert into auth.users values($1)',[id]);
  await db.query('insert into public.profiles values($1,$2,$3,$4,$5)',[id,role,name,`${id.slice(0,3)}@example.test`,id===teacher2?null:`local-line-${id.slice(0,3)}`]);
 }
 const one = async (sql,args=[]) => (await db.query(sql,args)).rows[0];
 const actor = async (id=admin, role='authenticated') => {await db.exec('reset role');await db.query("select set_config('test.uid',$1,false),set_config('test.role',$2,false)",[id||'',role]);};
 const rpc = async (name,args=[]) => (await one(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) q`,args)).q;
 await actor();
 await rpc('set_instructor_student_price_type',[teacher,'student_1',0]);
 await rpc('set_instructor_student_price_type',[teacher2,'student_2',0]);
 await db.exec(read('supabase-instructor-student-notifications.sql'));
 const bind = async (action,instructorId,expected) => rpc('save_instructor_student_binding',[student,instructorId,expected||null,action]);
 const claim = async (limit=20) => {await actor(null,'service_role');return rpc('claim_instructor_student_notifications',[limit,[],'ECLADO <local@example.test>']);};
 const complete = (job,result='accepted') => rpc('complete_instructor_student_notification',[job.id,job.lease_token,result,'local-provider']);
 return {db,one,rpc,actor,bind,claim,complete,admin,student,teacher,teacher2,read};
 } catch(e) {await db.close();throw e;}
}
module.exports = { bindingNotificationFixture };
