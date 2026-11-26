const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

test('unpaid enrollments survive expiry/start/end; only staff cancellation changes enrollment', {skip:!process.env.PGLITE_MODULE},async()=>{
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
      'supabase-course-notifications.sql', 'supabase-course-income.sql', 'supabase-course-publication-schedule.sql', 'supabase-course-image-jpeg-fallback.sql', 'supabase-course-slugs.sql', 'supabase-course-payment-resume.sql', 'supabase-course-payment-reminders.sql', 'supabase-course-enrollment-retention.sql', 'supabase-course-expiry-recovery.sql']) {
      await db.exec(readFileSync(resolve(__dirname, '../..', file), 'utf8'));
    }


 await owner();await query("update profiles set email='pro@example.test' where id=$1",[pro]);
 const newCourse=async()=>{await owner();const id=randomUUID();await query("insert into courses(id,name,description,image_path,starts_at,ends_at,price_twd,published) values($1::uuid,'保留報名驗收','內容',$1::text||'.webp',now()+interval '2 days',now()+interval '2 days 2 hours',1200,true)",[id]);return id;};
 const enroll=async(c,who=pro,people=[],self=true)=>{await member(who);return scalar('select create_course_registration($1,$2,$3,$4,1200) value',[c,randomUUID(),self,JSON.stringify(people)]);};
 const mine=async(c,who=pro)=>{await member(who);return scalar('select get_my_course_orders($1) value',[c]);};
 const cancel=async(id,reason='客人來訊要求取消')=>{await member(admin);return query('select cancel_course_registration($1,$2)',[id,reason]);};
 const notice=async()=>{await service();return scalar("select claim_course_payment_reminder(true,'sender@example.test') value");};
 const c=await newCourse(),o=await enroll(c);const seat=o.registrations[0].id;
 await owner();await query("update course_orders set payment_due_at=now()-interval '1 minute' where id=$1",[o.id]);
 await service();assert.equal(await scalar('select expire_course_registrations() value'),0);
 let read=(await mine(c)).orders[0];assert.equal(read.status,'expired');assert.equal(read.registrations[0].status,'pending');
 await assert.rejects(enroll(c),{code:'23505'}); // It remains registered, cannot accidentally register twice.
 await owner();await query("update courses set starts_at=now()-interval '3 hours',ends_at=now()-interval '1 hour' where id=$1",[c]);
 assert.equal(await notice(),null);read=(await mine(c)).orders[0];assert.equal(read.status,'expired');assert.equal(read.registrations[0].status,'pending');
 await member(admin);let roster=await scalar('select get_admin_course_roster($1) value',[c]);
 assert.equal(roster.registrations[0].status,'pending');assert.equal(roster.registrations[0].payment_status,'expired');
 await member(pro);await assert.rejects(query('select cancel_course_registration($1,$2)',[seat,'不能自行取消']),{code:'42501'});
 await assert.rejects(cancel(seat,''),{code:'22023'});await cancel(seat);await cancel(seat);
 read=(await mine(c)).orders[0];assert.equal(read.status,'cancelled');assert.equal(read.registrations[0].status,'cancelled');
 await owner();assert.equal((await query('select cancelled_by from course_registrations where id=$1',[seat]))[0].cancelled_by,admin);
 // Partial unpaid cancellation retains other seats and pauses the original full-price payment.
 const mc=await newCourse();const multi=await enroll(mc,teacher,[{family_name:'甲',given_name:'同學'},{family_name:'乙',given_name:'同學'}]);
 await service();const a=await scalar("select claim_course_payment($1,$2,true,'atm') value",[multi.id,teacher]);
 await query('select store_course_payment_link($1,$2,$3,$4)',[a.provider_order_no,'https://bank.example.test/original','multi-tx','12345678901234']);
 const delegated=multi.registrations.filter(r=>r.kind==='delegated');await cancel(delegated[0].id);await cancel(delegated[0].id);
 read=(await mine(mc,teacher)).orders[0];assert.equal(read.status,'hold');assert.equal(read.total_twd,2400);
 assert.equal(read.registrations.find(r=>r.id===delegated[1].id).status,'pending');
 assert.equal(read.registrations.find(r=>r.kind==='instructor_self').status,'active');
 await service();const blocked=await scalar("select claim_course_payment($1,$2,true,'atm') value",[multi.id,teacher]);assert.equal(blocked.eligible,false);assert.equal(blocked.payment_url,null);
 const review=await scalar('select confirm_course_payment($1,240000,$2) value',[a.provider_order_no,'multi-tx']);
 assert.equal(review.status,'review');assert.equal(review.registrations.find(r=>r.id===delegated[1].id).status,'pending');
 assert.equal(review.registrations.find(r=>r.id===delegated[0].id).status,'cancelled');
 await scalar('select confirm_course_payment($1,240000,$2) value',[a.provider_order_no,'multi-tx']);
 await owner();assert.equal((await query("select count(*)::int n from course_manual_cases where registration_id=$1",[delegated[0].id]))[0].n,1);
 // Verified receipt after the deadline also does not cancel an enrollment or reveal Zoom.
 const lc=await newCourse();const late=await enroll(lc);await service();const la=await scalar("select claim_course_payment($1,$2,true,'card') value",[late.id,pro]);
 await owner();await query("update course_orders set payment_due_at=now()-interval '1 second' where id=$1",[late.id]);
 await service();const lr=await scalar('select confirm_course_payment($1,120000,$2) value',[la.provider_order_no,'late-tx']);
 assert.equal(lr.status,'review');assert.equal(lr.registrations[0].status,'pending');assert.equal((await mine(lc)).zoom_url,null);
 // After staff cancels a single unpaid seat, re-enrollment is possible only if the course is still open.
 const rc=await newCourse();const ro=await enroll(rc);await cancel(ro.registrations[0].id);const replacement=await enroll(rc);assert.notEqual(replacement.id,ro.id);
 // The pre-class reminder still works; expiry stops reminders without changing pending registrations.
 await owner();await query('update courses set published=false where id<>$1',[rc]);
 await query("update course_orders set created_at=now()-interval '25 hours' where id=$1",[replacement.id]);const n=await notice();assert.equal(n.payload.order_id,replacement.id);
 await query("select complete_course_notification($1,$2,'accepted')",[n.id,n.lease_token]);
 await owner();await query("update courses set starts_at=now()-interval '1 minute',ends_at=now()+interval '1 hour' where id=$1",[rc]);assert.equal(await notice(),null);
 read=(await mine(rc)).orders.find(x=>x.id===replacement.id);assert.equal(read.registrations[0].status,'pending');
 }finally{await db.close();}
});
