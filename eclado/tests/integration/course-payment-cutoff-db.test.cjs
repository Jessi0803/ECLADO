const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

test('course payment closes 30 minutes before class; registration survives and reminders remain at class minus 24 hours', {skip:!process.env.PGLITE_MODULE},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href);const db=new PGlite();
 const teacher=randomUUID(),student=randomUUID(),pro=randomUUID(),consumer=randomUUID(),admin=randomUUID(),binding=randomUUID();
 const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const scalar=async(sql,args=[])=>(await query(sql,args))[0].value;
 const member=id=>db.exec(`reset role;set test.member='${id}';set role authenticated`);
 const owner=()=>db.exec('reset role');const service=()=>db.exec('reset role;set role service_role');
 try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('test.member', true),'')::uuid $$;
      create table public.backoffice_role_permissions (
        role text, permission text check (permission in ('catalog.write')), primary key (role, permission)
      );
      create function public.has_backoffice_permission(text) returns boolean language sql stable as
        $$ select auth.uid() = '${admin}'::uuid and $1 in ('courses.manage','notifications.send') $$;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit int, allowed_mime_types text[]);
      create table storage.objects (bucket_id text, name text);
      create table public.profiles (id uuid primary key, name text, role text);
      create table public.instructor_student_bindings (id uuid primary key, student_id uuid, instructor_id uuid, ended_at timestamptz);
      insert into public.profiles values ('${teacher}','師資甲','instructor'), ('${student}','學生乙','pro'),
        ('${pro}','美容師丙','pro'), ('${consumer}','一般會員','consumer'), ('${admin}','管理員','staff');
      insert into public.instructor_student_bindings values ('${binding}','${student}','${teacher}',null);
    `);
    await db.exec('alter table public.profiles add column email text, add column line_user_id text');
    await query("update public.profiles set email = 'teacher@example.test', line_user_id = 'teacher-line' where id=$1", [teacher]);
    await query("update public.profiles set email = 'student@example.test' where id=$1", [student]);
    for (const file of ['supabase-courses-foundation.sql', 'supabase-course-listing-details.sql', 'supabase-course-description-images.sql', 'supabase-course-registration.sql', 'supabase-course-payments.sql',
      'supabase-course-notifications.sql', 'supabase-course-income.sql', 'supabase-course-publication-schedule.sql', 'supabase-course-image-jpeg-fallback.sql', 'supabase-course-slugs.sql', 'supabase-course-payment-resume.sql', 'supabase-course-payment-reminders.sql', 'supabase-course-enrollment-retention.sql', 'supabase-course-expiry-recovery.sql', 'supabase-course-payment-cutoff-30-minutes.sql']) {
      await db.exec(readFileSync(resolve(__dirname, '../..', file), 'utf8'));
    }

 await owner();await query("update profiles set email='pro@example.test' where id=$1",[pro]);
 const newCourse=async(minutes=120)=>{await owner();const c=randomUUID();await query("insert into courses(id,name,description,image_path,starts_at,ends_at,price_twd,published) values($1::uuid,'付款截止驗收','內容',$1::text||'.webp',now()+make_interval(mins=>$2),now()+make_interval(mins=>$2+120),1200,true)",[c,minutes]);return c;};
 const enroll=async(c,who=pro,self=true,people=[])=>{await member(who);return scalar("select create_course_registration($1,$2,$3,$4,1200) value",[c,randomUUID(),self,JSON.stringify(people)]);};
 const claim=async(o,who=pro,method='card')=>{await service();return scalar('select claim_course_payment($1,$2,true,$3) value',[o.id,who,method]);};
 const getMine=async(c)=>{await member(pro);return scalar('select get_my_course_orders($1) value',[c]);};
 const notice=async()=>{await service();return scalar("select claim_course_payment_reminder(true,'test@example.test') value");};
 for(const method of ['atm','card','apple','google']){
  const c=await newCourse(),o=await enroll(c);await owner();
  assert.equal((await query("select o.payment_due_at=c.starts_at-interval '30 minutes' ok from course_orders o join courses c on c.id=o.course_id where o.id=$1",[o.id]))[0].ok,true);
  const a=await claim(o,pro,method);assert.equal(a.create_attempt,true);
  await owner();assert.equal((await query("select a.link_expires_at<=c.starts_at-interval '30 minutes' ok from course_payment_attempts a join course_orders o on o.id=a.order_id join courses c on c.id=o.course_id where o.id=$1",[o.id]))[0].ok,true);
  await service();await query('select store_course_payment_link($1,$2,$3,$4)',[a.provider_order_no,'https://bank.test/pay','tx-'+method,method==='atm'?'12345678901234':null]);
  // Class has not started, but the new payment deadline has passed.
  await owner();await query("update courses set starts_at=now()+interval '29 minutes',ends_at=now()+interval '149 minutes' where id=$1",[c]);
  const read=(await getMine(c)).orders[0];assert.equal(read.status,'expired');assert.equal(read.registrations[0].status,'pending');assert.equal(read.atm_account,null);
  const blocked=await claim(o,pro,method);assert.equal(blocked.eligible,false);assert.equal(blocked.create_attempt,false);assert.equal(blocked.payment_url,null);
  await service();assert.equal(await scalar('select expire_course_registrations() value'),0);
  assert.equal((await scalar("select renew_course_payment($1,$2,$3,$4) value",[o.id,pro,a.provider_order_no,method==='atm'?'1A250':method==='card'?'1C250':'1M250'])).blocked,true);
  await member(admin);assert.equal((await scalar('select get_admin_course_roster($1) value',[c])).registrations[0].payment_status,'expired');
  await member(pro);await assert.rejects(query("select create_course_registration($1,$2,true,'[]',1200)",[c,randomUUID()]),{code:'23505'});
  await service();const late=await scalar('select confirm_course_payment($1,120000,$2) value',[a.provider_order_no,'tx-'+method]);assert.equal(late.status,'review');assert.equal(late.registrations[0].status,'pending');
 }
 // A new paid signup cannot bypass the cutoff, while free faculty enrollment remains available.
 const closed=await newCourse(29);await assert.rejects(enroll(closed),{code:'22023'});
 const free=await enroll(closed,teacher);assert.equal(free.status,'free');
 await assert.rejects(enroll(closed,teacher,false,[{family_name:'代報',given_name:'同學'}]),{code:'22023'});
 // Moving class updates retained unpaid deadlines; paid order snapshots stay unchanged.
 const moved=await newCourse(),mo=await enroll(moved);await owner();await query("update courses set starts_at=starts_at+interval '1 day',ends_at=ends_at+interval '1 day' where id=$1",[moved]);
 assert.equal((await query("select o.payment_due_at=c.starts_at-interval '30 minutes' ok from course_orders o join courses c on c.id=o.course_id where o.id=$1",[mo.id]))[0].ok,true);
 const paidCourse=await newCourse(),paidOrder=await enroll(paidCourse),paidAttempt=await claim(paidOrder);await service();
 await query("select confirm_course_payment($1,120000,'paid-test')",[paidAttempt.provider_order_no]);
 await owner();const paidDue=(await query('select payment_due_at from course_orders where id=$1',[paidOrder.id]))[0].payment_due_at;
 await query("update courses set starts_at=starts_at+interval '1 day',ends_at=ends_at+interval '1 day' where id=$1",[paidCourse]);
 const paidAfter=(await query('select status,payment_due_at from course_orders where id=$1',[paidOrder.id]))[0];assert.equal(paidAfter.status,'paid');assert.equal(String(paidAfter.payment_due_at),String(paidDue));
 // The final reminder is still class minus 24h, not payment deadline minus 24h.
 await owner();await query('update courses set published=false');const rc=await newCourse(1455),ro=await enroll(rc);
 await owner();await query("update course_orders set created_at=now()-interval '25 hours' where id=$1",[ro.id]);
 let n=await notice();assert.equal(n.payload.final,false);assert.equal(n.payload.order_id,ro.id);assert.equal(Date.parse(n.payload.starts_at)-Date.parse(n.payload.payment_due_at),1800000);
 await query("select complete_course_notification($1,$2,'accepted')",[n.id,n.lease_token]);
 // A deadline migration must preserve sent notification history, never resend the first reminder.
 await owner();const sentBefore=(await query('select status,attempts,sent_at from course_notifications where id=$1',[n.id]))[0];
 await query('update course_orders set payment_due_at=(select starts_at from courses where id=$2) where id=$1',[ro.id,rc]);
 await db.exec(readFileSync(resolve(__dirname,'../../supabase-course-payment-cutoff-30-minutes.sql'),'utf8').replace('create function public.course_payment_deadline','create or replace function public.course_payment_deadline'));
 assert.deepEqual((await query('select status,attempts,sent_at from course_notifications where id=$1',[n.id]))[0],sentBefore);
 assert.equal(await notice(),null);
 await owner();await query("update course_notifications set sent_at=now()-interval '25 hours' where id=$1",[n.id]);await query("update courses set starts_at=now()+interval '23 hours 45 minutes',ends_at=now()+interval '25 hours 45 minutes' where id=$1",[rc]);
 n=await notice();assert.equal(n.payload.final,true);await query("select complete_course_notification($1,$2,'accepted')",[n.id,n.lease_token]);
 await owner();await query("update courses set starts_at=now()+interval '29 minutes',ends_at=now()+interval '149 minutes' where id=$1",[rc]);assert.equal(await notice(),null);assert.equal((await getMine(rc)).orders[0].registrations[0].status,'pending');
 // Historical automatic cancellation recovery uses the new cutoff and preserves its audit.
 const recover=await newCourse(120),old=await enroll(recover),oa=await claim(old);
 await service();await query("select store_course_payment_link($1,'https://bank.test/old','old-tx',null)",[oa.provider_order_no]);
 await owner();await query("update course_orders set payment_due_at=now()-interval '1 day' where id=$1",[old.id]);await query("update course_payment_attempts set link_expires_at=now()-interval '1 day' where order_id=$1",[old.id]);await query("update course_registrations set status='cancelled',cancel_reason='付款期限已過',cancelled_at=now() where order_id=$1",[old.id]);
 await service();const restored=await scalar("select recover_expired_course_enrollment($1,$2,'1C250',clock_timestamp(),'TEST recovery') value",[old.id,oa.provider_order_no]);assert.equal(restored.status,'pending');assert.equal(restored.payment_method,null);
 await owner();assert.equal((await query("select o.payment_due_at=c.starts_at-interval '30 minutes' ok from course_orders o join courses c on c.id=o.course_id where o.id=$1",[old.id]))[0].ok,true);
 console.log('Validated four-method cutoff, retained enrollment, late receipt review, free faculty signup, deadline rescheduling, class-minus-24h reminder and historical recovery.');
 } finally {await db.close();}
});
