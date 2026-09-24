import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.resolve('supabase-shopping-credit-checkout.sql'), 'utf8');

test('購物金訂單保留總額並另外保存外部金流應付金額', () => {
  expect(sql).toContain('add column if not exists shopping_credit_amount bigint');
  expect(sql).toContain('add column if not exists payment_amount numeric');
  expect(sql).toContain('payment_amount + shopping_credit_amount = total');
  expect(sql).toContain("'shopping_credit_amount', requested_credit");
  expect(sql).toContain("'payment_amount', gateway_payment");
  expect(sql).toContain('new.payment_amount := new.total - requested_credit');
});

test('購物金只能支付折扣後商品並保留至少一元外部付款', () => {
  expect(sql).toContain('coalesce(new.subtotal, 0) - coalesce(new.discount, 0)');
  expect(sql).toContain('floor(new.total - 1)');
  expect(sql).toContain('minimum gateway payment');
  expect(sql).toContain('reserve_order_shopping_credit');
});

test('購物金與外部應付金額在首次 INSERT 就寫入不可變快照', () => {
  expect(sql).toContain("'app.eclado_order_shopping_credit_amount'");
  expect(sql).toContain('new.shopping_credit_amount := requested_credit');
  expect(sql).toContain('new.payment_amount := new.total - requested_credit');
  expect(sql).toContain("'{shopping_credit_amount}'");
  expect(sql).toContain("'{payment_amount}'");
  expect(sql).toContain('new.shopping_credit_amount is distinct from old.shopping_credit_amount');
  expect(sql).toContain('new.payment_amount is distinct from old.payment_amount');
  expect(sql).not.toMatch(/update public\.orders\s+set shopping_credit_amount/i);
});

test('付款、取消與逾期共用訂單狀態觸發器同步購物金', () => {
  expect(sql).toContain('trg_sync_shopping_credit_from_order_status');
  expect(sql).toContain('consume_order_shopping_credit');
  expect(sql).toContain('release_order_shopping_credit');
  expect(sql).toContain('refund_order_shopping_credit');
  expect(sql).toContain("when new.payment_due_at <= now() then 'order_expired'");
});

test('永豐付款 claim 使用 payment_amount 而非訂單總額', () => {
  expect(sql).toContain("'total', target_order.payment_amount");
  expect(sql).toContain("'order_total', target_order.total");
  expect(sql).toContain("'shopping_credit_amount', target_order.shopping_credit_amount");
});
