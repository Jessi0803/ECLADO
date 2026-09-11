import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.resolve('supabase-coupon-discount-engine.sql'), 'utf8');

test('batch 3 exposes sanitized coupon quote and compatible order overloads', () => {
  expect(sql).toContain('quote_order_pricing(jsonb, text, text, text)');
  expect(sql).toContain('create_order_with_pricing(\n  jsonb, text, text, text, text, text, text, text, text');
  expect(sql).toContain('p_coupon_code text');
  expect(sql).toContain('p_guest_email text');
  expect(sql).toContain('authoritative_quote_v2');
});

test('coupon quota is checked and transactionally reserved', () => {
  expect(sql).toContain('pg_advisory_xact_lock');
  expect(sql).toContain("redemption.status = 'reserved' and redemption.expires_at > now()");
  expect(sql).toContain('insert into public.coupon_redemptions');
  expect(sql).toContain('trg_sync_coupon_redemption_from_order_status');
  expect(sql).toContain("new.status in ('cancelled', 'returned')");
});

test('batch 3 calculates price benefits while allowing batch 4 gift-only coupons', () => {
  expect(sql).toContain("promotion.benefit_type in ('percentage_discount', 'fixed_discount')");
  expect(sql).toContain("gift_promotion.benefit_type in ('amount_gift', 'quantity_gift')");
  expect(sql).toContain('insert into public.order_adjustments');
});

test('percentage and fixed discounts support amount or quantity thresholds', () => {
  expect(sql).toContain("candidate.threshold_type = 'quantity'");
  expect(sql).toContain("activity.threshold_type = 'quantity'");
  expect(sql).toContain("sum((item ->> 'qty')::numeric)");
  expect(sql).toContain("'basis', activity.threshold_type");
  expect(sql).toContain("threshold_type = coalesce(nullif(p_payload ->> 'threshold_type', ''), 'amount')");
});

test('coupon configuration stays private and admin writes are transactional RPCs', () => {
  expect(sql).toContain('activation_type = \'automatic\'');
  expect(sql).toContain('save_discount_promotion(p_payload jsonb)');
  expect(sql).toContain('save_coupon_campaign(p_payload jsonb)');
  expect(sql).toContain("has_backoffice_permission('promotions.manage')");
  expect(sql).not.toContain('grant select on table public.coupon_campaigns to anon');
});

test('all-regular scope excludes event and gift-only products', () => {
  expect(sql).toContain("when 'all_regular' then product.publication_status = 'active'");
  expect(sql).toContain('promotion_item_matches_scope');
});
