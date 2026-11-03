const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('storefront display: public reads, authorized RPC writes, validation and migration reapply', {skip:!process.env.PGLITE_MODULE}, async () => {
  const { PGlite } = require(process.env.PGLITE_MODULE);
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create function public.has_backoffice_permission(permission text) returns boolean language sql as $$
        select permission = 'member_pricing.manage' and coalesce(current_setting('test.manage',true),'false')='true'; $$;`);
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase-storefront-display-settings.sql'), 'utf8');
    await db.exec(sql);
    await db.exec('set role anon');
    assert.equal((await db.query('select show_fulfillment from public.storefront_display_settings')).rows[0].show_fulfillment, true);
    await assert.rejects(db.query('select public.save_storefront_display_settings(false)'), e => e.code === '42501');
    await assert.rejects(db.query('update public.storefront_display_settings set show_fulfillment=false'), e => e.code === '42501');
    await db.exec('reset role; set role authenticated');
    await assert.rejects(db.query('select public.save_storefront_display_settings(false)'), e => e.code === '42501');
    await db.exec("set test.manage='true'");
    assert.deepEqual((await db.query('select public.save_storefront_display_settings(false) value')).rows[0].value, {show_fulfillment:false});
    await assert.rejects(db.query('select public.save_storefront_display_settings(null)'), e => e.code === '22023');
    await assert.rejects(db.query('update public.storefront_display_settings set show_fulfillment=true'), e => e.code === '42501');
    await db.exec('reset role');
    await db.exec(sql);
    assert.equal((await db.query('select show_fulfillment from public.storefront_display_settings')).rows[0].show_fulfillment, false);
    await db.exec("set role authenticated; set test.manage='true'");
    assert.deepEqual((await db.query('select public.save_storefront_display_settings(true) value')).rows[0].value, {show_fulfillment:true});
  } finally { await db.close(); }
});
