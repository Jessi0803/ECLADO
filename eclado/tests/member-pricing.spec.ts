import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { parseFold, pricingFieldsFromRow, getProductMultiplier } from '../src/domain/memberPricing.js';

test('折數輸入：空值繼承、10折不打折、8.8折為88%，拒絕無效值', () => {
  expect(parseFold('', true)).toBeNull();
  expect(parseFold('10')).toBe(1);
  expect(parseFold('8.8')).toBe(0.88);
  expect(parseFold('6.55')).toBe(0.655);
  for (const value of ['', '0', '-1', '10.1', '8.888', 'NaN', 'Infinity', 'abc']) {
    expect(() => parseFold(value)).toThrow();
  }
});

test('個別倍率取代全域而非相乘；三身份互不影響', () => {
  const product = { pricingOverrides:{ instructor:0.88, distributor:null, staff:1 }, pricingDefaults:{ instructor:0.7, distributor:0.65, staff:0.5 } };
  expect(getProductMultiplier(product, 'instructor')).toBe(0.88);
  expect(getProductMultiplier(product, 'distributor')).toBe(0.65);
  expect(getProductMultiplier(product, 'staff')).toBe(1);
  expect(getProductMultiplier(product, 'consumer')).toBeNull();
  expect(getProductMultiplier(product, 'pro')).toBe(1);
  product.pricingDefaults.distributor = 0.6;
  expect(getProductMultiplier(product, 'distributor')).toBe(0.6);
  expect(getProductMultiplier(product, 'instructor')).toBe(0.88);
});

test('舊未勾選商品三身份皆不打折；新資料不再由舊flag決定價格', () => {
  const old = pricingFieldsFromRow({ apply_tier_multiplier:false });
  expect(old.pricingOverrides).toEqual({ instructor:1, distributor:1, staff:1 });
  expect(old.memberPricingReady).toBe(false);
  const modern = pricingFieldsFromRow({ apply_tier_multiplier:false, instructor_price_multiplier:null, staff_price_multiplier:0.4, pricing_defaults:{ instructor:0.8, distributor:0.6, staff:0.5 } });
  expect(getProductMultiplier(modern, 'instructor')).toBe(0.8);
  expect(getProductMultiplier(modern, 'staff')).toBe(0.4);
});

test('SQL守住權限、併發、一次性轉換、既有報價及稽核邊界', () => {
  const sql = fs.readFileSync('supabase-member-pricing.sql', 'utf8');
  expect(sql).toContain("has_backoffice_permission('member_pricing.manage')");
  expect(sql).toContain('order by role for update');
  expect(sql).toContain('previous_values is distinct from p_expected_multipliers');
  expect(sql).toContain("p_product -> 'expected_pricing_overrides'");
  expect(sql).toContain('where apply_tier_multiplier is false');
  expect(sql).toContain("if to_regprocedure('public.resolve_product_price_multiplier(public.products,text,numeric)') is null");
  expect(sql).toContain('Base pricing definition differs; migration aborted');
  expect(sql).toContain('revoke insert, update, delete on public.membership_tiers');
  expect(sql).toContain("capture_admin_audit_log('role')");
  expect(sql).not.toMatch(/update\s+public\.orders\b/i);
});
