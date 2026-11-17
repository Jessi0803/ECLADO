const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

test('course registration, payment confirmation and single-seat cancellation use isolated transactions', {
  skip: !process.env.PGLITE_MODULE,
}, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
  const db = new PGlite();
  const teacher = randomUUID(), student = randomUUID(), pro = randomUUID(), consumer = randomUUID(), admin = randomUUID();
  const binding = randomUUID(), course = randomUUID(), nextCourse = randomUUID();
  const query = async (sql, values = []) => (await db.query(sql, values)).rows;
  const scalar = async (sql, values) => (await query(sql, values))[0].value;
  const member = id => db.exec(`reset role; set test.member = '${id}'; set role authenticated`);
  const service = () => db.exec('reset role; set role service_role');
  const enroll = (self, participants, key = randomUUID(), price = 1200, id = course) =>
    scalar('select public.create_course_registration($1,$2,$3,$4,$5) value', [id, key, self, JSON.stringify(participants), price]);
  const claim = (order, user, create = true) => scalar('select public.claim_course_payment($1,$2,$3) value', [order, user, create]);
  const confirm = (provider, amount, tx) => scalar('select public.confirm_course_payment($1,$2,$3) value', [provider, amount, tx]);
  const mine = () => scalar('select public.get_my_course_orders($1) value', [course]);
  const roster = () => scalar('select public.get_admin_course_roster($1) value', [course]);

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
    for (const file of ['supabase-courses-foundation.sql', 'supabase-course-registration.sql', 'supabase-course-payments.sql',
      'supabase-course-notifications.sql', 'supabase-course-income.sql']) {
      await db.exec(readFileSync(resolve(__dirname, '../..', file), 'utf8'));
    }
    await query(`insert into public.courses (id,name,description,image_path,starts_at,ends_at,price_twd,published)
      values ($1,'實作課程','介紹','12345678-1111-4444-8888-123456789abc.webp',now()+interval '2 hours',now()+interval '3 hours',1200,true),
             ($2,'另一堂課','介紹','22345678-1111-4444-8888-123456789abc.webp',now()+interval '2 hours',now()+interval '3 hours',1200,true)`, [course, nextCourse]);
    await query("insert into public.course_meeting_details values ($1,'https://zoom.us/j/123')", [course]);

    await member(consumer);
    await assert.rejects(enroll(true, []), { code: '42501' });
    await member(pro);
    await assert.rejects(enroll(true, [{ family_name: '李', given_name: '丁' }]), { code: '22023' });
    await assert.rejects(enroll(true, [], randomUUID(), 999), { code: '22023' });
    const proOrder = await enroll(true, []);
    assert.equal(proOrder.total_twd, 1200);
    assert.equal(proOrder.registrations[0].status, 'pending');
    assert.equal((await mine()).zoom_url, null);
    await assert.rejects(claim(proOrder.id, pro), { code: '42501' });

    await member(teacher);
    const free = await enroll(true, [], randomUUID(), 1200, nextCourse);
    assert.equal(free.status, 'free');
    assert.equal(free.total_twd, 0);
    assert.equal(free.registrations[0].status, 'active');
    await service();
    assert.equal((await claim(free.id, teacher)).provider_order_no, null);
    await member(teacher);
    const key = randomUUID();
    const people = [{ binding_id: binding }, { family_name: '王', given_name: '小美' }];
    const mixed = await enroll(true, people, key);
    assert.equal(mixed.total_twd, 2400);
    assert.equal(mixed.registrations.find(r => r.kind === 'instructor_self').status, 'active');
    assert.equal(mixed.registrations.filter(r => r.status === 'pending').length, 2);
    assert.equal((await enroll(true, people, key)).id, mixed.id);
    await assert.rejects(enroll(true, [], key), { code: '22023' });
    await assert.rejects(enroll(true, []), { code: '23505' });
    await assert.rejects(enroll(false, [{ binding_id: randomUUID() }]), { code: '22023' });
    await assert.rejects(enroll(false, [{ family_name: 123, given_name: '小美' }]), { code: '22023' });
    assert.equal((await mine()).zoom_url, 'https://zoom.us/j/123');

    await service();
    assert.equal(await claim(mixed.id, pro), null);
    const first = await claim(mixed.id, teacher);
    const retry = await claim(mixed.id, teacher);
    assert.equal(first.create_attempt, true);
    assert.equal(retry.create_attempt, false);
    assert.equal(first.provider_order_no, retry.provider_order_no);
    await assert.rejects(confirm(first.provider_order_no, 239999, 'tx-a'), { code: '22023' });
    await query('select public.store_course_payment_link($1,$2,$3)', [first.provider_order_no, 'https://pay.example.test/pay', 'tx-a']);
    assert.equal((await claim(mixed.id, teacher)).payment_url, 'https://pay.example.test/pay');
    const paid = await confirm(first.provider_order_no, 240000, 'tx-a');
    assert.equal(paid.status, 'paid');
    assert.equal(paid.registrations.filter(r => r.status === 'active').length, 3);
    assert.deepEqual(await confirm(first.provider_order_no, 240000, 'tx-a'), paid);

    await member(teacher);
    const personal = await scalar('select public.get_my_course_orders(null) value');
    const bookedCourse = personal.courses.find(item => item.id === course);
    assert.equal(bookedCourse.zoom_url, 'https://zoom.us/j/123');
    assert.equal(bookedCourse.orders[0].registrations.length, 3);
    assert.equal(Object.hasOwn(bookedCourse.orders[0], 'atm_account'), false);
    await member(consumer);
    assert.deepEqual(await scalar('select public.get_my_course_orders(null) value'), { courses: [] });
    await service();

    const proAttempt = await claim(proOrder.id, pro);
    await db.exec('reset role');
    await query("update public.course_orders set payment_due_at = now()-interval '1 minute' where id=$1", [proOrder.id]);
    await service();
    const late = await confirm(proAttempt.provider_order_no, 120000, 'tx-b');
    assert.equal(late.status, 'review');
    assert.equal(late.registrations[0].status, 'cancelled');
    assert.deepEqual(await confirm(proAttempt.provider_order_no, 120000, 'tx-b'), late);

    await member(pro);
    const standalone = await enroll(true, [], randomUUID(), 1200, nextCourse);
    await service();
    const rejected = await claim(standalone.id, pro);
    await query('select public.fail_course_payment_creation($1)', [rejected.provider_order_no]);
    assert.equal((await claim(standalone.id, pro)).summary.status, 'failed');
    await member(pro);
    const replacement = await enroll(true, [], randomUUID(), 1200, nextCourse);
    await service();
    const replacementAttempt = await scalar("select public.claim_course_payment($1,$2,true,'atm') value", [replacement.id, pro]);
    assert.equal(replacementAttempt.payment_method, 'atm');
    await query('select public.store_course_payment_link($1,$2,$3,$4)',
      [replacementAttempt.provider_order_no, 'https://bank.example.test/pay', 'tx-c', '12345678901234']);
    const reopened = await scalar("select public.claim_course_payment($1,$2,true,'google') value", [replacement.id, pro]);
    assert.equal(reopened.create_attempt, false);
    assert.equal(reopened.payment_method, 'atm');
    assert.equal(reopened.summary.atm_account, '12345678901234');
    const proPaid = await confirm(replacementAttempt.provider_order_no, 120000, 'tx-c');
    assert.equal(proPaid.registrations[0].status, 'active');

    const selected = paid.registrations.find(r => r.name === '王小美');
    const other = paid.registrations.find(r => r.name === '學生乙');
    const manual = (ids, request = randomUUID()) => scalar(
      'select public.queue_manual_course_notification($1,$2,$3,$4) value',
      [course, request, ids, '請提早登入'],
    );
    const nextNotice = () => scalar(
      'select public.claim_course_notification(true,$1) value', ['sender@example.test'],
    );
    const finish = (job, result) => scalar(
      'select public.complete_course_notification($1,$2,$3) value', [job.id, job.lease_token, result],
    );
    const income = () => scalar('select public.get_admin_course_income($1) value', [course]);
    await member(teacher);
    await assert.rejects(query('select public.cancel_course_registration($1,$2)', [selected.id, '無法出席']), { code: '42501' });
    await assert.rejects(manual([selected.id]), { code: '42501' });
    await assert.rejects(income(), { code: '42501' });
    await member(admin);
    await assert.rejects(nextNotice(), { code: '42501' });
    assert.equal(await manual([selected.id]), 1);
    const noticeKey = randomUUID();
    assert.equal(await manual([selected.id, other.id], noticeKey), 1);
    assert.equal(await manual([selected.id, other.id], noticeKey), 1);
    await query('select public.cancel_course_registration($1,$2)', [selected.id, '無法出席']);
    await query('select public.cancel_course_registration($1,$2)', [selected.id, '重送']);
    let list = await roster();
    assert.equal(list.registrations.filter(r => r.status === 'active').length, 2);
    assert.equal(list.registrations.find(r => r.id === selected.id).payment_status, 'paid');
    assert.equal(list.cases.filter(item => item.registration_id === selected.id).length, 1);
    assert.equal(list.cases.filter(item => item.kind === 'payment_exception').length, 1);
    assert.equal(await manual([selected.id]), 0);
    assert.deepEqual(await income(), { paid_twd: 2400, review_twd: 1200, paid_orders: 1, refund_twd: 0, net_twd: 3600 });
    const refundCase = list.cases.find(item => item.registration_id === selected.id);
    const resolveRefund = amount => query('select public.resolve_course_case_and_record_refund($1,$2,$3)',
      [refundCase.id, '已在銀行完成退款', amount]);
    await assert.rejects(resolveRefund(1201), { code: '22023' });
    await resolveRefund(600);
    await resolveRefund(600);
    await assert.rejects(resolveRefund(601), { code: '22023' });
    assert.deepEqual(await income(), { paid_twd: 2400, review_twd: 1200, paid_orders: 1, refund_twd: 600, net_twd: 3000 });

    await service();
    const job = await nextNotice();
    assert.equal(job.target, 'teacher-line');
    assert.equal(job.payload.delegated, true);
    assert.equal(job.payload.message, '請提早登入');
    assert.equal(job.payload.zoom_url, 'https://zoom.us/j/123');
    assert.equal(await finish({ ...job, lease_token: randomUUID() }, 'accepted'), false);
    assert.equal(await finish(job, 'line_rejected'), true);
    await db.exec('reset role');
    await query("update public.course_notifications set next_attempt_at = now() - interval '1 minute' where id=$1", [job.id]);
    await service();
    const fallback = await nextNotice();
    assert.equal(fallback.id, job.id);
    assert.equal(fallback.target, 'teacher@example.test');
    assert.equal(fallback.channel, 'email');
    assert.equal(await finish(fallback, 'accepted'), true);
    let autoCount = 0;
    for (let pending; (pending = await nextNotice());) {
      if (pending.payload.name === '實作課程') {
        assert.equal(pending.target, 'teacher-line');
        assert.equal(pending.payload.automatic, true);
        autoCount++;
      }
      await finish(pending, 'accepted');
    }
    assert.equal(autoCount, 1);
    assert.equal(await nextNotice(), null);
    await member(admin);
    const history = await scalar('select public.get_admin_course_notifications($1,0) value', [course]);
    assert.equal(history.length, 3);
    assert.deepEqual(history.map(item => item.status).sort(), ['sent','sent','skipped']);
    assert.ok(history.every(item => item.payer_name === '師資甲' && !Object.hasOwn(item, 'target')));
    await db.exec('reset role');
    await query("update public.course_notifications set status = 'failed' where id = $1", [history[0].id]);
    await member(admin);
    const exceptions = await scalar('select public.get_admin_course_notifications($1,0,true) value', [course]);
    assert.deepEqual(exceptions.map(item => item.id), [history[0].id]);
    const overview = (await scalar('select public.get_admin_courses() value')).find(item => item.id === course);
    assert.equal(overview.notification_exception_count, 1);
    const openCases = (await roster()).cases.filter(item => !item.resolved_at);
    assert.equal(overview.open_case_count, openCases.length);


    await db.exec('reset role');
    await query("update public.courses set starts_at=now()-interval '2 hours', ends_at=now()-interval '1 hour' where id=$1", [course]);
    await member(teacher);
    assert.equal((await mine()).zoom_url, null);
    assert.equal((await scalar('select public.get_my_course_orders(null) value')).courses.find(item => item.id === course).zoom_url, null);
    await member(admin);
    await assert.rejects(query('select public.cancel_course_registration($1,$2)', [other.id, '課後']), { code: '22023' });
    await query('select public.record_course_after_class_case($1,$2)', [other.id, '課後聯繫']);
    list = await roster();
    assert.equal(list.registrations.find(r => r.id === other.id).status, 'active');
    assert.equal(list.cases.find(item => item.registration_id === other.id).kind, 'after_course');
  } finally {
    await db.close();
  }
});
