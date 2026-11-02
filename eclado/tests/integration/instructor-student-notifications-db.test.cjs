const { test } = require('node:test');
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
if (require.main === module) test('binding outbox: atomic recipients, privacy, fencing, fallback, ACL, deletion and migration repeat', {skip:!process.env.PGLITE_MODULE,timeout:60000}, async () => {
 const c = await bindingNotificationFixture(); const {db,one,rpc,actor,bind,claim,complete} = c;
 try {
 assert.equal(Number((await one('select count(*) n from public.instructor_student_notification_outbox')).n),0,'no history backfill');
 const bound = await bind('bind',teacher); const bindingId = bound.context.binding_id;
 assert.equal(Number((await one('select count(*) n from public.instructor_student_notification_outbox')).n),2);
 await assert.rejects(bind('bind',teacher),e=>e.code==='40001');
 let jobs = await claim(); assert.equal(jobs.length,2); assert.ok(jobs.every(j=>j.channel==='line'));
 const studentJob = jobs.find(j=>j.audience==='student');
 assert.equal(await complete({...studentJob,lease_token:teacher2}),false);
 await complete(studentJob,'line_rejected');
 const fallback = (await claim()).find(j=>j.id===studentJob.id);assert.equal(fallback.channel,'email');
 await complete(fallback);assert.equal(await complete(fallback),false);
 await complete(jobs.find(j=>j.audience==='teacher'));
 await actor();
 const changed = await bind('rebind',teacher2,bindingId);
 const raw = (await db.query("select * from public.instructor_student_notification_outbox where event_type='rebind'")).rows;
 assert.equal(raw.length,3);assert.equal(raw.find(n=>n.audience==='former_teacher').user_id,teacher);
 assert.doesNotMatch(JSON.stringify(raw.find(n=>n.audience==='former_teacher').payload),/李老師|instructor_name/);
 assert.equal(raw.find(n=>n.audience==='student').payload.instructor_name,'李老師');
 assert.equal(raw.find(n=>n.audience==='student').payload.previous_instructor_name,'王老師');
 jobs = await claim();assert.equal(jobs.length,3);assert.equal(jobs.find(j=>j.audience==='teacher').channel,'email');
 const crashed = jobs.find(j=>j.audience==='student');
 await db.query("update public.instructor_student_notification_outbox set lease_until=now()-interval '1 second' where id=$1",[crashed.id]);
 const recovered = (await claim()).find(j=>j.id===crashed.id);assert.equal(recovered.key,crashed.key);assert.equal(await complete(crashed),false);
 await complete(recovered);for(const job of jobs.filter(j=>j.id!==crashed.id))await complete(job);
 await actor();
 // Failure while enqueuing must roll back both relation and audit.
 await db.exec("create function fail_binding_outbox() returns trigger language plpgsql as $$begin raise exception 'injected queue failure';end$$;create trigger fail_binding_outbox before insert on public.instructor_student_notification_outbox for each row execute function fail_binding_outbox()");
 await assert.rejects(bind('unbind',null,changed.context.binding_id),/injected queue failure/);
 assert.equal((await rpc('get_admin_instructor_student_member',[student])).context.binding_id,changed.context.binding_id);
 await db.exec('drop trigger fail_binding_outbox on public.instructor_student_notification_outbox');
 await bind('unbind',null,changed.context.binding_id);
 assert.equal(Number((await one('select count(*) n from public.instructor_student_notification_outbox')).n),7);
 const unbound=(await db.query("select audience,user_id from public.instructor_student_notification_outbox where event_type='unbind'")).rows;
 assert.deepEqual(new Set(unbound.map(n=>n.user_id)),new Set([student,teacher2]));
 const safe=await rpc('get_admin_instructor_student_notifications',[student,0]);assert.equal(safe.total,7);
 assert.doesNotMatch(JSON.stringify(safe),/(?:111|222|333|444)@example|local-line|陳小美|王老師|李老師/);
 for (const role of ['anon','authenticated','service_role']) {
  await actor(role==='authenticated'?student:null,role);await db.exec(`set role ${role}`);
  await assert.rejects(db.query('select * from public.instructor_student_notification_outbox'),e=>e.code==='42501');
  if(role!=='service_role')await assert.rejects(rpc('claim_instructor_student_notifications',[1,[],null]),e=>e.code==='42501');
  await assert.rejects(rpc('get_admin_instructor_student_notifications',[student,0]),e=>e.code==='42501');
 }
 await actor();await db.exec('update public.admin_users set active=false');await assert.rejects(bind('bind',teacher),e=>e.code==='42501');await db.exec('update public.admin_users set active=true');
 await db.exec(c.read('supabase-instructor-student-notifications.sql'));assert.equal(Number((await one('select count(*) n from public.instructor_student_notification_outbox')).n),7);
 jobs=await claim();assert.equal(jobs.length,2);
 await db.query('delete from auth.users where id=$1',[student]);
 assert.equal(await complete(jobs.find(j=>j.audience==='student')),false);
 assert.equal(Number((await one('select count(*) n from public.instructor_student_notification_outbox where user_id=$1 and(targets is not null or lease_token is not null)',[student])).n),0);
 assert.equal(Number((await one('select count(*) n from public.instructor_student_notification_outbox')).n),7);
 const verification=await db.exec(c.read('supabase-instructor-student-notifications-verify.sql'));
 for(const [name,value] of Object.entries(verification[0].rows[0].verification))assert.equal(value,true,name);
 }finally {await db.close();}
});
