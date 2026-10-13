const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('member assisted link: owner only, active orders only, no guest or anonymous access', { skip:!process.env.PGLITE_MODULE }, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql as
        $$select nullif(current_setting('test.uid', true), '')::uuid$$;
      create table public.orders (
        id text primary key, user_id uuid, order_source text,
        status text, payment_due_at timestamptz
      );
      create table public.assisted_order_requests (
        order_id text primary key references public.orders(id), link_token text
      );
      insert into public.orders values
        ('MY-ACTIVE', '22222222-2222-4222-8222-222222222222', 'admin_assisted', 'awaiting_confirm', now() + interval '1 day'),
        ('MY-CANCELLED', '22222222-2222-4222-8222-222222222222', 'admin_assisted', 'cancelled', now() + interval '1 day'),
        ('MY-EXPIRED', '22222222-2222-4222-8222-222222222222', 'admin_assisted', 'unpaid', now() - interval '1 day'),
        ('GUEST-ACTIVE', null, 'admin_assisted', 'unpaid', now() + interval '1 day'),
        ('MY-ONLINE', '22222222-2222-4222-8222-222222222222', 'online', 'unpaid', now() + interval '1 day');
      insert into public.assisted_order_requests values
        ('MY-ACTIVE', 'private-member-token'),
        ('MY-CANCELLED', 'private-cancelled-token'),
        ('MY-EXPIRED', 'private-expired-token'),
        ('GUEST-ACTIVE', 'private-guest-token'),
        ('MY-ONLINE', 'private-online-token');
    `);
    const migration = fs.readFileSync(path.resolve(__dirname, '../../supabase-assisted-order-member-link.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    const one = async (sql, values) => (await db.query(sql, values)).rows[0];
    const permission = await one(`select
      has_function_privilege('anon', 'public.get_my_assisted_order_link(text)', 'execute') as anon,
      has_function_privilege('authenticated', 'public.get_my_assisted_order_link(text)', 'execute') as member`);
    assert.equal(permission.anon, false);
    assert.equal(permission.member, true);
    await db.exec('set role anon');
    await assert.rejects(db.query('select public.get_my_assisted_order_link($1)', ['MY-ACTIVE']), /permission denied/);
    await db.exec('reset role');
    await assert.rejects(db.query('select public.get_my_assisted_order_link($1)', ['MY-ACTIVE']), /請先登入/);
    await db.exec('set role authenticated');
    await db.exec("select set_config('test.uid', '11111111-1111-4111-8111-111111111111', false)");
    await assert.rejects(db.query('select public.get_my_assisted_order_link($1)', ['MY-ACTIVE']), /無法繼續付款/);
    await db.exec("select set_config('test.uid', '22222222-2222-4222-8222-222222222222', false)");
    assert.deepEqual((await one('select public.get_my_assisted_order_link($1) as link', ['MY-ACTIVE'])).link,
      { order_id:'MY-ACTIVE', link_token:'private-member-token' });
    for (const id of ['MY-CANCELLED', 'MY-EXPIRED', 'GUEST-ACTIVE', 'MY-ONLINE', 'UNKNOWN']) {
      await assert.rejects(db.query('select public.get_my_assisted_order_link($1)', [id]), /無法繼續付款/);
    }
  } finally { await db.exec('reset role'); await db.close(); }
});
