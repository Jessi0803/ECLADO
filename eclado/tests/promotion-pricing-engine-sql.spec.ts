import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const sql = readFileSync(
  join(process.cwd(), 'supabase-promotion-pricing-engine.sql'),
  'utf8',
);

function bodyOf(signature: string, nextMarker: string) {
  return sql.match(new RegExp(
    `create or replace function public\\.${signature}([\\s\\S]*?)${nextMarker}`,
  ))?.[1] || '';
}

test('第二批提供不建立訂單的後端權威報價 RPC', () => {
  expect(sql).toContain('add column if not exists apply_tier_multiplier boolean not null default true');
  expect(sql).toContain('create or replace function public.quote_order_pricing(');
  expect(sql).toContain('grant execute on function public.quote_order_pricing(jsonb, text) to anon, authenticated');
  expect(sql).toContain("current_user_id uuid := auth.uid()");
  expect(sql).not.toContain('p_member_role');
  expect(sql).not.toContain('p_unit_price');
  expect(sql).not.toContain('p_discount');
});

test('建立訂單與試算共用同一個計價核心', () => {
  const createOrder = bodyOf(
    'create_order_with_pricing\\(',
    'revoke all on function public\\.create_order_with_pricing',
  );
  expect(createOrder).toContain(
    'quote_result := public.quote_order_pricing(p_items, normalized_fulfillment_method)',
  );
  expect(createOrder).not.toContain('from public.promotions promotion');
  expect(createOrder).not.toContain('from public.product_variants');
});

test('第二批只接受現有自動折扣，不會提前套用優惠券或贈品', () => {
  const quote = bodyOf(
    'quote_order_pricing\\(',
    'revoke all on function public\\.quote_order_pricing',
  );
  expect(quote).toContain("promotion.benefit_type = 'legacy_discount'");
  expect(quote).toContain("promotion.activation_type = 'automatic'");
  expect(quote).toContain('promotion.archived_at is null');
  expect(quote).toContain("publication_status in ('active', 'event_only')");
  expect(quote).not.toContain("publication_status in ('active', 'event_only', 'gift_only')");
});

test('會員價、專業門檻、運費與活動擇優規則仍存在權威核心', () => {
  expect(sql).toContain('tier.professional_price_multiplier');
  expect(sql).toContain('(eligible.subtotal - promotion.discount_amount) * promotion.discount_rate');
  expect(sql).toContain('eligible.subtotal * promotion.discount_rate - promotion.discount_amount');
  expect(sql).toContain('round(eligible.subtotal - priced.final_subtotal) as discount');
  expect(sql).toContain("subtotal_amount - discount_amount < 5000");
  expect(sql).toContain("subtotal_amount - discount_amount >= 15000");
  expect(sql).toContain('public.calculate_order_shipping(order_items)');
  expect(sql).toContain('order by candidate.discount desc, candidate.created_at asc, candidate.id asc');
  expect(sql).toContain("'version', 3");
  expect(sql).toContain("'engine', 'authoritative_quote_v1'");
});
