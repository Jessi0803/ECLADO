const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bindingNotificationFixture } = require('../fixtures/instructor-student-notifications-db.cjs');

test('binding outbox: atomic recipients, privacy, fencing, fallback, ACL, deletion and migration repeat', {skip:!process.env.PGLITE_MODULE,timeout:60000}, async () => {
 const c = await bindingNotificationFixture(); const {db,one,rpc,actor,bind,claim,complete,admin,teacher,teacher2,student} = c;
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
