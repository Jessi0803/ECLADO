const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

test('course deadlines, four-method renewals and reminder schedule execute real SQL in isolation', {skip:!process.env.PGLITE_MODULE}, async t=>{
 const {PGlite}=await import(pathToFileURL(process.env.PGLITE_MODULE).href); const db=new PGlite();
 const teacher=randomUUID(),student=randomUUID(),pro=randomUUID(),consumer=randomUUID(),admin=randomUUID(),binding=randomUUID();
 const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const scalar=async(sql,args=[])=>(await query(sql,args))[0].value;
 const member=id=>db.exec(`reset role;set test.member='${id}';set role authenticated`);
 const service=()=>db.exec('reset role;set role service_role');
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
      'supabase-course-notifications.sql', 'supabase-course-income.sql', 'supabase-course-publication-schedule.sql', 'supabase-course-image-jpeg-fallback.sql', 'supabase-course-slugs.sql', 'supabase-course-payment-resume.sql', 'supabase-course-payment-reminders.sql', 'supabase-course-enrollment-retention.sql', 'supabase-course-expiry-recovery.sql']) {
      await db.exec(readFileSync(resolve(__dirname, '../..', file), 'utf8'));
    }

 const createCourse=async(hours=720)=>{
  await db.exec('reset role');const id=randomUUID();
  await query("insert into public.courses(id,name,description,image_path,starts_at,ends_at,price_twd,published) values($1::uuid,'隔離課程','內容',$1::text||'.webp',now()+$2::interval,now()+$2::interval+interval '2 hours',1200,true)",[id,hours+' hours']);return id;
 };
 const enroll=async(course,who=teacher)=>{await member(who);return scalar('select public.create_course_registration($1,$2,$3,$4,1200) value',
   [course,randomUUID(),who===pro,JSON.stringify(who===pro?[]:[{family_name:'王',given_name:'小美'}])]);};
 const claim=async(o,who,method)=>{await service();return scalar('select public.claim_course_payment($1,$2,true,$3) value',[o,who,method]);};
 const renew=async(o,who,provider,status)=>{await service();return scalar('select public.renew_course_payment($1,$2,$3,$4) value',[o,who,provider,status]);};
 const confirm=async(provider,tx)=>{await service();return scalar('select public.confirm_course_payment($1,120000,$2) value',[provider,tx]);};
 const notice=async()=>{await service();return scalar("select public.claim_course_payment_reminder(true,'sender@example.test') value");};
 const complete=async n=>{await service();return scalar("select public.complete_course_notification($1,$2,'accepted') value",[n.id,n.lease_token]);};
 const start=await createCourse();const o=await enroll(start,pro);
 await db.exec('reset role');
 const data=await query('select payment_due_at=(select starts_at from courses where id=$1) ok from course_orders where id=$2',[start,o.id]);assert.equal(data[0].ok,true);
 await member(consumer);await assert.rejects(scalar('select public.renew_course_payment($1,$2,$3,$4) value',[o.id,pro,'anything','1C250']),{code:'42501'});
 await service();assert.equal(await renew(o.id,consumer,'x','1C250'),null);
 for (const method of ['card','apple','google','atm']) {
  const cid=await createCourse();const order=await enroll(cid);const first=await claim(order.id,teacher,method);
  await query('select public.store_course_payment_link($1,$2,$3,$4)',[first.provider_order_no,'https://bank.example.test/pay','tx-old',method==='atm'?'12345678901234':null]);
  assert.equal((await claim(order.id,teacher,method)).payment_url,'https://bank.example.test/pay');
  if(method==='atm')assert.ok(Date.parse(first.link_expires_at)<Date.now()+30*86400000);
  await db.exec('reset role');await query("update course_payment_attempts set link_expires_at=now()-interval '1 minute' where order_id=$1",[order.id]);
  await assert.rejects(renew(order.id,teacher,first.provider_order_no,'1C200'),{code:'22023'});
  const second=await renew(order.id,teacher,first.provider_order_no,method==='atm'?'1A250':method==='card'?'1C250':'1M250');
  assert.equal(second.create_attempt,true);assert.equal(second.attempt_no,2);assert.notEqual(second.provider_order_no,first.provider_order_no);
  assert.equal((await renew(order.id,teacher,first.provider_order_no,'1C250')).changed,true);
  await query('select public.store_course_payment_link($1,$2,$3,$4)',[second.provider_order_no,'https://bank.example.test/new','tx-new',method==='atm'?'22345678901234':null]);
  const paid=await confirm(first.provider_order_no,'tx-old');assert.equal(paid.status,'paid');
  assert.equal((await confirm(first.provider_order_no,'tx-old')).status,'paid');
  await confirm(second.provider_order_no,'tx-new');await confirm(second.provider_order_no,'tx-new');
  await db.exec('reset role');
  assert.equal((await query('select count(*)::int n from course_manual_cases where order_id=$1',[order.id]))[0].n,1);
  assert.equal((await query("select count(*)::int n from course_registrations where order_id=$1 and status='active'",[order.id]))[0].n,1);
 }
 // An explicit create rejection is retried on the same registration; no bank exists.
 const failed=await enroll(await createCourse());const f=await claim(failed.id,teacher,'card');
 await service();await query('select public.fail_course_payment_creation($1)',[f.provider_order_no]);
 assert.equal((await renew(failed.id,teacher,f.provider_order_no,'NOT_CREATED')).create_attempt,true);
 // Postponement updates only pending order deadlines, retaining bank attempt history.
 await db.exec('reset role');await query("update courses set starts_at=starts_at+interval '1 day',ends_at=ends_at+interval '1 day' where id=$1",[start]);
 assert.equal((await query('select o.payment_due_at=c.starts_at ok from course_orders o join courses c on c.id=o.course_id where o.id=$1',[o.id]))[0].ok,true);
 // Expiry retains enrollment; only customer-requested staff cancellation permits a replacement.
 await query("update course_orders set payment_due_at=now()-interval '1 minute' where id=$1",[o.id]);
 await assert.rejects(enroll(start,pro),{code:'23505'});
 await member(admin);await query('select cancel_course_registration($1,$2)',[o.registrations[0].id,'客人主動要求取消']);
 const replacement=await enroll(start,pro);assert.notEqual(replacement.id,o.id);
 await db.exec('reset role');
 assert.equal((await query('select status from course_registrations where order_id=$1',[o.id]))[0].status,'cancelled');
 // Isolate reminders from other cases with pending seats.
 await db.exec('reset role');await query("update courses set published=false where id<>$1",[start]);
 await query('update courses set published=false where id=$1',[start]);
 const rc=await createCourse(120);const ro=await enroll(rc);
 await db.exec('reset role');await query("update course_orders set created_at=now()-interval '25 hours' where id=$1",[ro.id]);
 const first=await notice();assert.equal(first.payload.kind,'course_payment');assert.equal(first.payload.final,false);
 assert.equal(first.payload.order_id,ro.id);assert.deepEqual(first.payload.participants,['王小美']);assert.equal('zoom_url' in first.payload,false);
 await complete(first);assert.equal(await notice(),null);
 await db.exec('reset role');await query("update courses set starts_at=now()+interval '23 hours',ends_at=now()+interval '25 hours' where id=$1",[rc]);
 assert.equal(await notice(),null); // Actual first send less than 24h ago.
 await db.exec('reset role');await query("update course_notifications set sent_at=now()-interval '25 hours' where id=$1",[first.id]);
 await query("update course_notifications set next_attempt_at=now() where order_id=$1 and kind='payment_final'",[ro.id]);
 const final=await notice();assert.equal(final.payload.final,true);await complete(final);assert.equal(await notice(),null);
 // 12h-left signup: single reminder at +1h; below one hour no reminder.
 for(const hours of [12,0.5]){
  const cid=await createCourse(hours);const ord=await enroll(cid);assert.equal(await notice(),null);
  await db.exec('reset role');await query("update course_orders set created_at=now()-interval '61 minutes' where id=$1",[ord.id]);
  if(hours===12){const n=await notice();assert.equal(n.payload.order_id,ord.id);assert.equal(n.payload.final,true);await complete(n);}
  else { // Realistic <1h order cannot have existed 61 minutes before its deadline: expire it too.
   await query("update course_orders set payment_due_at=now()-interval '1 second' where id=$1",[ord.id]);assert.equal(await notice(),null);
   await db.exec('reset role');
 assert.equal((await query('select status from course_registrations where order_id=$1',[ord.id]))[0].status,'pending');
  }
 }
 // A late worker sends final only, and payment before sending invalidates the queued reminder.
 const lc=await createCourse(20);const lo=await enroll(lc);
 await db.exec('reset role');await query("update course_orders set created_at=now()-interval '28 hours' where id=$1",[lo.id]);
 const ln=await notice();assert.equal(ln.payload.final,true);
 await query("select public.complete_course_notification($1,$2,'transient')",[ln.id,ln.lease_token]);
 const la=await claim(lo.id,teacher,'card');await confirm(la.provider_order_no,'captured');
 await db.exec('reset role');await query("update course_notifications set next_attempt_at=now() where id=$1",[ln.id]);assert.equal(await notice(),null);
 await db.exec('reset role');
 assert.equal((await query('select status from course_notifications where id=$1',[ln.id]))[0].status,'unknown');
 // Email fallback and cancelled/unknown-payment exclusions, without external delivery.
 const ec=await createCourse(120);const eo=await enroll(ec);
 await db.exec('reset role');await query("update course_orders set created_at=now()-interval '25 hours' where id=$1",[eo.id]);
 await service();const em=await scalar("select public.claim_course_payment_reminder(false,'sender@example.test') value");
 assert.equal(em.channel,'email');assert.equal(em.target,'teacher@example.test');await complete(em);
 const cc=await createCourse(120);const co=await enroll(cc);
 await db.exec('reset role');await query("update course_orders set created_at=now()-interval '25 hours' where id=$1",[co.id]);
 await query("update course_registrations set status='cancelled' where order_id=$1",[co.id]);assert.equal(await notice(),null);
 const uc=await createCourse(120);const uo=await enroll(uc);
 await db.exec('reset role');await query("update course_orders set created_at=now()-interval '25 hours',status='review' where id=$1",[uo.id]);assert.equal(await notice(),null);
 console.log('Validated deadline, four renewals, late/duplicate callbacks, staff cancellation/re-enrollment, reminder spacing/coalescing and payment exclusion.');
 } finally {await db.close();}
});
