import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(
  path.resolve('supabase-professional-price-quote-hardening.sql'),
  'utf8',
);
const verifySql = fs.readFileSync(
  path.resolve('supabase-promotion-pricing-engine-verify.sql'),
  'utf8',
);

test('hardening wrapper removes raw professional pricing inputs from both item copies', () => {
  expect(sql).toContain("item - 'professional_price' - 'apply_tier_multiplier'");
  expect(sql).toContain("jsonb_set(sanitized, '{items}', sanitized_items, true)");
  expect(sql).toContain("jsonb_set(sanitized, '{pricing_snapshot,items}', sanitized_items, true)");
  expect(sql).toContain('public.quote_order_pricing_internal_20260916(p_items, p_fulfillment_method)');
});

test('raw pricing and renamed discount helpers are not client-callable', () => {
  expect(sql).toContain(
    'revoke all on function public.quote_order_pricing_internal_20260916(jsonb, text)',
  );
  expect(sql).toContain(
    'revoke all on function public.sanitize_public_order_quote(jsonb)',
  );
  expect(sql).toContain('from public, anon, authenticated');
  expect(sql).toContain('public.create_order_with_pricing_discount_v2');
});

test('public two-argument compatibility signature remains available', () => {
  expect(sql).toContain('create or replace function public.quote_order_pricing(');
  expect(sql).toContain('grant execute on function public.quote_order_pricing(jsonb, text) to anon, authenticated');
  expect(sql).toContain("notify pgrst, 'reload schema'");
});

test('migration fails closed unless coupon and gift pricing layers are present', () => {
  expect(sql).toContain("to_regprocedure('public.quote_order_pricing(jsonb,text,text,text)') is null");
  expect(sql).toContain(
    "to_regprocedure('public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text,text)') is null",
  );
  expect(sql).toContain(
    "to_regprocedure('public.create_order_with_pricing(jsonb,text,text,text,text,text,text,text)') is null",
  );
  expect(sql).toContain("coupon and gift pricing migrations must be fully applied before hardening");
});

test('post-deployment verification inspects the wrapped pricing core', () => {
  expect(verifySql).toContain(
    "to_regprocedure('public.quote_order_pricing_internal_20260916(jsonb,text)')",
  );
  expect(verifySql).toContain("to_regprocedure('public.quote_order_pricing(jsonb,text)')");
});
