const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { test } = require('node:test');

test('member carts enforce ownership, atomic validation, patching and retry deduplication', {
  skip: !process.env.PGLITE_MODULE,
}, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
  const db = new PGlite();
  const a = '11111111-1111-4111-8111-111111111111';
  const b = '22222222-2222-4222-8222-222222222222';
  const item = (id, qty = 1) => ({ id, variantId: '', qty });
  const sync = async (uid, items = [], id = null, mode = 'patch') => (await db.query(
    'select public.sync_my_cart($1,$2,$3,$4::jsonb) result', [uid, id, mode, JSON.stringify(items)]
  )).rows[0].result.items;
  let seq = 0;
  const op = () => `33333333-3333-4333-8333-${String(++seq).padStart(12, '0')}`;
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as
      $$ select nullif(current_setting('test.uid', true),'')::uuid $$;
      insert into auth.users values ('${a}'),('${b}');
      grant usage on schema public, auth to authenticated;
      grant execute on function auth.uid() to authenticated;`);
    const sql = readFileSync(resolve(__dirname, '../../supabase-member-carts.sql'), 'utf8');
    await db.exec(sql);
    await db.exec(sql);
    await db.exec(`set role authenticated; set test.uid='${a}'`);
    await assert.rejects(sync(b), /owner mismatch/);
    await assert.rejects(db.query('select * from public.member_carts'), /permission denied/);
    await assert.rejects(db.query('select * from public.member_cart_operations'), /permission denied/);
    const first = op();
    assert.deepEqual(await sync(a, [{ ...item(1, 2), price: 1 }], first), [item(1, 2)]);
    await sync(a, [item(1, 4)], op());
    assert.deepEqual(await sync(a, [item(1, 2)], first), [item(1, 4)]);
    assert.deepEqual(await sync(a, [item(1, 3), item(2)], op(), 'merge'), [item(1, 4), item(2)]);
    assert.deepEqual(await sync(a, [item(1, 0)], op()), [item(2)]);
    await assert.rejects(sync(a, [item(3), item(4, 100)], op()), /Invalid cart item/);
    assert.deepEqual(await sync(a), [item(2)]);
    await assert.rejects(sync(a, [item(3)], null), /Invalid cart operation/);
    await sync(a, [item(2, 4)], op());
    const consumed = op();
    assert.deepEqual(await sync(a, [item(2), item(99)], consumed, 'consume'), [item(2, 3)]);
    assert.deepEqual(await sync(a, [item(2), item(99)], consumed, 'consume'), [item(2, 3)]);
    await db.exec(`set test.uid='${b}'`);
    assert.deepEqual(await sync(b), []);
    await assert.rejects(sync(a), /owner mismatch/);
    await db.exec("set test.uid='';");
    await assert.rejects(sync(b), /owner mismatch/);
    await db.exec('reset role; set role anon;');
    await assert.rejects(sync(b), /permission denied/);
  } finally { await db.close(); }
});
