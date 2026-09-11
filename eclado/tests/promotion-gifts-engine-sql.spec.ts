import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.resolve('supabase-promotion-gifts-engine.sql'), 'utf8');

test('batch 4 adds amount and quantity gifts to the authoritative quote', () => {
  expect(sql).toContain("promotion.benefit_type in ('amount_gift', 'quantity_gift')");
  expect(sql).toContain("product.publication_status = 'gift_only'");
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
});

test('payment consumes and cancellation releases the gift reservation', () => {
  expect(sql).toContain("set status='consumed', consumed_at=now()");
  expect(sql).toContain('trg_sync_gift_reservation_from_order_status');
  expect(sql).toContain("new.status in ('cancelled','returned')");
  expect(sql).toContain("status='released'");
});

test('admin save requires an active gift-only variant', () => {
  expect(sql).toContain("benefit not in ('percentage_discount','fixed_discount','amount_gift','quantity_gift')");
  expect(sql).toContain('Gift must use an active gift-only variant');
  expect(sql).toContain("has_backoffice_permission('promotions.manage')");
});

test('final admin save preserves discount threshold type', () => {
  expect(sql).toContain("p_payload->>'threshold_type'");
  expect(sql).toContain("threshold_type=threshold_kind");
  expect(sql).toContain("Quantity threshold must be a whole number");
});
