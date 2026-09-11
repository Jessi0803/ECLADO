import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.resolve('supabase-promotion-gifts-engine.sql'), 'utf8');
const productSaveSql = fs.readFileSync(path.resolve('supabase-save-product-with-variants.sql'), 'utf8');
const eventCatalogSql = fs.readFileSync(path.resolve('supabase-event-only-products.sql'), 'utf8');

test('batch 4 adds amount and quantity gifts to the authoritative quote', () => {
  expect(sql).toContain("promotion.benefit_type in ('amount_gift', 'quantity_gift')");
  expect(sql).toContain('variant.gift_enabled = true');
  expect(sql).toContain("product.publication_status in ('active', 'event_only', 'gift_only')");
  expect(sql).toContain("'repeat_count', repeat_count");
  expect(sql).toContain('authoritative_quote_v3_gifts');
});

test('gift stock is reserved atomically and cannot become a backorder', () => {
  expect(sql).toContain('promotion_gift_reservations');
  expect(sql).toContain('order by variant.id for update');
  expect(sql).toContain("'reserved', payment_expiry");
  expect(sql).toContain('and reservation.expires_at > now()');
  expect(sql).toContain("allocated := item_qty; missing := 0");
  expect(sql).toContain("case when is_gift then 'promotion_gift'");
  expect(sql).toContain('set gift_stock = gift_stock - item_qty');
  expect(sql).toContain('protect_reserved_gift_inventory');
});

test('payment consumes and cancellation releases the gift reservation', () => {
  expect(sql).toContain("set status='consumed', consumed_at=now()");
  expect(sql).toContain('trg_sync_gift_reservation_from_order_status');
  expect(sql).toContain("new.status in ('cancelled','returned')");
  expect(sql).toContain("status='released'");
  expect(sql).toContain('set gift_stock = gift_stock + allocation.stock_deducted_qty');
});

test('admin save requires enabled gift inventory', () => {
  expect(sql).toContain("benefit not in ('percentage_discount','fixed_discount','amount_gift','quantity_gift')");
  expect(sql).toContain('Gift must use enabled gift inventory');
  expect(sql).toContain("has_backoffice_permission('promotions.manage')");
});

test('public catalog RPCs hide gift inventory operational fields', () => {
  for (const field of ['gift_enabled', 'gift_stock', 'gift_min_stock']) {
    expect(sql).toContain(`'${field}'`);
  }
});

test('catalog product save accepts the gift-only publication status', () => {
  expect(productSaveSql).toContain("('draft', 'active', 'event_only', 'gift_only', 'archived')");
  for (const field of ['gift_enabled', 'gift_stock', 'gift_min_stock']) {
    expect(productSaveSql).toContain(field);
  }
  expect(productSaveSql).toContain("normalized_publication_status = 'gift_only'");
});

test('event catalog migration preserves gift-only products and exposes its RPC', () => {
  expect(eventCatalogSql.match(/'draft', 'active', 'event_only', 'gift_only', 'archived'/g)?.length).toBe(2);
  expect(eventCatalogSql).toContain('create or replace function public.get_event_catalog()');
  expect(eventCatalogSql).toContain('grant execute on function public.get_event_catalog() to anon, authenticated');
  expect(eventCatalogSql).toContain("notify pgrst, 'reload schema'");
});

test('final admin save preserves discount threshold type', () => {
  expect(sql).toContain("p_payload->>'threshold_type'");
  expect(sql).toContain("threshold_type=threshold_kind");
  expect(sql).toContain("Quantity threshold must be a whole number");
});
