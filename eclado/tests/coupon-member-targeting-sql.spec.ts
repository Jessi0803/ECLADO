import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const migration = fs.readFileSync(path.join(root, 'supabase-coupon-member-targeting.sql'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'supabase-coupon-discount-engine.sql'), 'utf8');

test('指定會員優惠券使用正規化關聯表與受權限保護的會員搜尋', () => {
  expect(migration).toContain('create table if not exists public.coupon_campaign_members');
  expect(migration).toContain('unique (coupon_campaign_id, user_id)');
  expect(migration).toContain("public.has_backoffice_permission('promotions.manage')");
  expect(migration).toContain('create or replace function public.search_coupon_members');
  expect(migration).toContain('create or replace function public.get_coupon_campaign_members');
  expect(migration).not.toContain('grant select on table public.profiles');
});

test('指定會員模式不允許訪客且由同一後端函式驗證試算與建單', () => {
  expect(migration).toContain("audience_mode = 'members'");
  expect(migration).toContain('and allow_guest is false');
  expect(migration).toContain('target.user_id = auth.uid()');
  expect(engine.match(/public\.coupon_campaign_allows_identity/g)?.length).toBeGreaterThanOrEqual(2);
  expect(engine).toContain("audience_mode_value not in ('roles', 'members')");
  expect(engine).toContain("audience_mode_value = 'members' and cardinality(selected_member_ids) = 0");
});

test('優惠券儲存會同步指定會員名單並保留既有身分模式相容性', () => {
  expect(engine).toContain("coalesce(nullif(p_payload ->> 'audience_mode', ''), 'roles')");
  expect(engine).toContain('delete from public.coupon_campaign_members target');
  expect(engine).toContain('insert into public.coupon_campaign_members');
  expect(engine).toContain('on conflict (coupon_campaign_id, user_id) do nothing');
});

test('指定會員搜尋會帶出並比對美容師聯絡人與皮膚管理院', () => {
  const contactMigration = fs.readFileSync(path.join(root, 'supabase-coupon-member-contact-name.sql'), 'utf8');
  expect(contactMigration).toContain('drop function if exists public.search_coupon_members(text, integer)');
  expect(contactMigration).toContain("coalesce(application.contact_name, '') ilike");
  expect(contactMigration).toContain("coalesce(application.studio_name, '') ilike");
  expect(contactMigration.match(/public\.has_backoffice_permission\('promotions\.manage'\)/g)?.length).toBe(2);
  expect(contactMigration).toContain('grant execute on function public.search_coupon_members(text, integer) to authenticated');
  expect(contactMigration).not.toContain('to anon');
});
