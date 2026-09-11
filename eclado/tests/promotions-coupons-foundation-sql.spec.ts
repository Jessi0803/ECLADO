import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const sql = readFileSync(
  join(process.cwd(), 'supabase-promotions-coupons-foundation.sql'),
  'utf8',
);

test('優惠券第一批 migration 建立完整加法資料結構', () => {
  for (const table of [
    'promotion_scopes',
    'coupon_campaigns',
    'coupon_promotions',
    'coupon_redemptions',
    'promotion_gift_reservations',
    'order_adjustments',
  ]) {
    expect(sql).toContain(`create table if not exists public.${table}`);
    expect(sql).toContain(`alter table public.${table} enable row level security`);
  }

  expect(sql).toContain("'gift_only'");
  expect(sql).toContain("default 'legacy_discount'");
  expect(sql).toContain("activation_type in ('automatic', 'coupon_only')");
  expect(sql).toContain("threshold_type in ('amount', 'quantity')");
  expect(sql).toContain("when benefit_type = 'quantity_gift' then 'quantity'");
  expect(sql).toContain("target_type in ('all_regular', 'all_sellable', 'product', 'variant', 'category', 'series')");
});

test('優惠券與贈品交易表不允許前端直接寫入', () => {
  const configurationGrant = sql.match(
    /grant select, insert, update, delete on table([\s\S]*?)to authenticated;/,
  )?.[1] || '';
  const transactionalGrant = sql.match(
    /grant select on table([\s\S]*?)to authenticated;/,
  )?.[1] || '';

  expect(configurationGrant).toContain('public.promotion_scopes');
  expect(configurationGrant).toContain('public.coupon_campaigns');
  expect(configurationGrant).toContain('public.coupon_promotions');
  expect(configurationGrant).not.toContain('public.coupon_redemptions');
  expect(configurationGrant).not.toContain('public.promotion_gift_reservations');
  expect(configurationGrant).not.toContain('public.order_adjustments');

  expect(transactionalGrant).toContain('public.coupon_redemptions');
  expect(transactionalGrant).toContain('public.promotion_gift_reservations');
  expect(transactionalGrant).toContain('public.order_adjustments');
});

test('優惠券代碼不會寫入管理員稽核內容', () => {
  expect(sql).toContain('create or replace function public.capture_promotion_configuration_audit()');
  const auditFunction = sql.match(
    /create or replace function public\.capture_promotion_configuration_audit\(\)([\s\S]*?)revoke all on function public\.capture_promotion_configuration_audit/,
  )?.[1] || '';

  expect(auditFunction).not.toContain("to_jsonb(new) -> 'code'");
  expect(auditFunction).not.toContain("to_jsonb(old) -> 'code'");
  expect(auditFunction).toContain("'stacking_policy'");
});

test('第一批不取代現行結帳活動計算', () => {
  expect(sql).not.toContain('create or replace function public.create_order_with_pricing');
  expect(sql).not.toContain('create or replace function public.calculate_checkout_quote');
  expect(sql).toContain('Additive schema only');
});
