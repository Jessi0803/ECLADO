const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

test('ended courses grant each payer the saved fee once per active paid registration', {
  skip: !process.env.PGLITE_MODULE,
}, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
  const db = new PGlite();
  const teacher = randomUUID();
  const student = randomUUID();
  const pro = randomUUID();
  const locked = randomUUID();
  const deleted = randomUUID();
  const ended = randomUUID();
  const future = randomUUID();
  const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
  const run = async () => (await rows('select public.grant_finished_course_shopping_credit() as result'))[0].result;

  async function order(payer, role, course, status = 'paid', price = 1200) {
    const id = randomUUID();
    const count = status === 'free' ? 0 : 1;
    await rows(`insert into public.course_orders (id, course_id, payer_id, payer_name, payer_role,
      request_id, request_payload, course_name, unit_price_twd, paid_seats, total_twd, status, payment_due_at, paid_at)
      values ($1,$2,$3,'付款會員',$4,$5,'[]','課程',$9,$6,$7,$8,now()-interval '3 hours',
        case when $8 = 'paid' then now()-interval '4 hours' end)`,
      [id, course, payer, role, randomUUID(), count, count * price, status, price]);
    return { id, course };
  }

  async function seat(target, kind, status = 'active', memberId = null) {
    const id = randomUUID();
    await rows(`insert into public.course_registrations
      (id,course_id,order_id,member_id,participant_name,kind,status,confirmed_at)
      values ($1,$2,$3,$4,'參加者',$5,$6,case when $6 = 'active' then now()-interval '4 hours' end)`,
      [id, target.course, target.id, memberId, kind, status]);
    return id;
  }

  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('test.member', true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
      create function public.has_backoffice_permission(text) returns boolean language sql stable as $$ select false $$;
      create table public.backoffice_role_permissions (role text, permission text, primary key(role, permission));
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit int, allowed_mime_types text[]);
      create table storage.objects (bucket_id text, name text);
      create table public.profiles (id uuid primary key, name text, role text);
    `);
    for (const file of [
      'supabase-shopping-credit-foundation.sql', 'supabase-courses-foundation.sql',
      'supabase-course-registration.sql', 'supabase-course-shopping-credit.sql',
    ]) {
      await db.exec(readFileSync(resolve(__dirname, '../..', file), 'utf8'));
    }
    await rows(`insert into public.profiles values
      ($1,'師資甲','pro'),($2,'綁定學生','pro'),($3,'美容師','pro'),($4,'師資乙','instructor')`,
      [teacher, student, pro, locked]);
    await rows(`insert into public.courses (id,name,description,starts_at,ends_at,price_twd)
      values ($1,'已結束','內容',now()-interval '2 hours',now()-interval '1 hour',1200),
        ($2,'延期課程','內容',now()+interval '1 hour',now()+interval '2 hours',1200)`, [ended, future]);
    const paid = await order(teacher, 'instructor', ended);
    await rows('update public.course_orders set paid_seats = 3, total_twd = 3600 where id = $1', [paid.id]);
    const selected = await seat(paid, 'delegated', 'active', student);
    const manual = await seat(paid, 'delegated');
    await seat(paid, 'delegated', 'cancelled');
    await seat(paid, 'instructor_self', 'active', teacher);
    await seat(await order(teacher, 'instructor', ended, 'pending'), 'delegated', 'pending');
    await seat(await order(teacher, 'instructor', ended, 'review'), 'delegated');
    const proOrder = await order(pro, 'pro', ended, 'paid', 1800);
    const selfPaid = await seat(proOrder, 'pro_self', 'active', pro);
    await rows('update public.courses set price_twd = 2500 where id = $1', [ended]);
    const postponed = await seat(await order(teacher, 'instructor', future), 'delegated');
    await seat(await order(locked, 'instructor', ended), 'delegated');
    await seat(await order(deleted, 'instructor', ended), 'delegated');

    await rows(`insert into public.shopping_credit_accounts (user_id, available_balance, reserved_balance, status)
      values ($1, 200, 300, 'active'), ($2, 0, 0, 'deletion_pending')`, [teacher, locked]);
    await db.exec('set role authenticated');
    await assert.rejects(run(), { code: '42501' });
    await db.exec('reset role; set role anon');
    await assert.rejects(run(), { code: '42501' });
    await db.exec('reset role; set role service_role');
    assert.deepEqual(await run(), { status: 'complete', granted: 3 });
    assert.deepEqual(await run(), { status: 'complete', granted: 0 });

    await db.exec('reset role');
    const entries = await rows(`select user_id, amount, reserved_delta, reserved_balance_after, reason_code,
      metadata from public.shopping_credit_ledger order by id`);
    assert.equal(entries.length, 3);
    assert.deepEqual(new Set(entries.map(entry => entry.metadata.course_registration_id)), new Set([selected, manual, selfPaid]));
    const proEntry = entries.find(entry => entry.metadata.course_registration_id === selfPaid);
    assert.equal(proEntry.user_id, pro);
    assert.equal(Number(proEntry.amount), 1800);
    assert.equal(proEntry.reason_code, 'course_pro_grant');
    assert.equal(proEntry.metadata.course_order_id, proOrder.id);
    for (const entry of entries.filter(entry => entry.user_id === teacher)) {
      assert.equal(entry.user_id, teacher);
      assert.equal(Number(entry.amount), 1200);
      assert.equal(Number(entry.reserved_delta), 0);
      assert.equal(Number(entry.reserved_balance_after), 300);
      assert.equal(entry.reason_code, 'course_delegated_grant');
      assert.equal(entry.metadata.course_id, ended);
      assert.equal(entry.metadata.course_order_id, paid.id);
    }
    await db.exec(`set test.member = '${teacher}'; set role authenticated`);
    const [wallet] = await rows('select public.get_my_shopping_credit() as data');
    assert.equal(wallet.data.available_balance, 2600);
    assert.equal(wallet.data.entries.length, 2);

    await db.exec('reset role');
    await rows(`update public.courses set starts_at = now()-interval '2 hours', ends_at = now()-interval '1 hour'
      where id = $1`, [future]);
    await db.exec(`
      create function public.reject_test_wallet_update() returns trigger language plpgsql as
        $$ begin raise exception 'simulated wallet write failure'; end; $$;
      create trigger reject_test_wallet_update before update on public.shopping_credit_accounts
        for each row execute function public.reject_test_wallet_update();
      set role service_role;
    `);
    await assert.rejects(run(), /simulated wallet write failure/);
    await db.exec('reset role');
    assert.equal((await rows('select count(*)::integer as count from public.shopping_credit_ledger'))[0].count, 3);
    await db.exec('drop trigger reject_test_wallet_update on public.shopping_credit_accounts; set role service_role');
    assert.deepEqual(await run(), { status: 'complete', granted: 1 });
    assert.deepEqual(await run(), { status: 'complete', granted: 0 });
    await db.exec('reset role');
    const [entry] = await rows('select metadata, available_balance_after from public.shopping_credit_ledger order by id desc limit 1');
    assert.equal(entry.metadata.course_registration_id, postponed);
    assert.equal(Number(entry.available_balance_after), 3800);
  } finally {
    await db.close();
  }
});
