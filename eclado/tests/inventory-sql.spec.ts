import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

test('庫存 trigger 將出貨流程狀態視為占用庫存', () => {
  for (const file of ['supabase-full-setup.sql', 'supabase-inventory-reservation.sql', 'supabase-inventory-status-fix.sql']) {
    const sql = read(file);
    expect(sql).toContain("order_status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered')");
    expect(sql).not.toContain("order_status = 'paid'");
  }
});

test('功能清單描述與庫存 trigger 行為一致', () => {
  const inventory = read('docs/FUNCTION-INVENTORY.md');
  expect(inventory).toContain('`paid`、`preparing`、`ready_for_pickup`、`picked_up`、`shipped`、`delivered` 都視為占用庫存');
  expect(inventory).toContain('改成 `cancelled` 或 `returned` 後，庫存加回');
  expect(inventory).not.toContain('從 `paid` 改成任何非 `paid` 狀態時，庫存加回');
});

test('現場自取運費分支不會再被宅配規則覆寫', () => {
  const sql = read('supabase-authoritative-pricing.sql');
  expect(sql).toContain("if normalized_fulfillment_method = 'onsite_pickup' then\n    shipping_amount := 0;\n  elsif member_role");
  expect(sql).not.toContain("if normalized_fulfillment_method = 'onsite_pickup' then\n    shipping_amount := 0;\n  elsif member_role in ('pro', 'instructor', 'distributor')\n    and subtotal_amount - discount_amount < 5000");
});

test('專業會員保留五千元起購，滿一萬五千元才免運', () => {
  const sql = read('supabase-authoritative-pricing.sql');
  expect(sql).toContain("subtotal_amount - discount_amount < 5000");
  expect(sql).toContain("subtotal_amount - discount_amount >= 15000");
  expect(sql).toContain("'professional_minimum', 5000");
  expect(sql).toContain("'professional_free_shipping_threshold', 15000");
  expect(sql).not.toContain("'professional_free_shipping_threshold', 10000");
});

test('公開熱門商品統計排除客訂規格銷量', () => {
  for (const file of ['supabase-security-hardening-20260827.sql', 'supabase-exclude-custom-orders-from-popular.sql']) {
    const sql = read(file);
    expect(sql).toContain("coalesce(item.value ->> 'is_custom_order', 'false') <> 'true'");
  }
});

test('後台付款方式查詢不暴露完整金流指示資料', () => {
  for (const file of ['supabase-order-payment-instructions.sql', 'supabase-admin-order-payment-methods.sql']) {
    const sql = read(file);
    expect(sql).toContain('returns table(order_id text, payment_method text)');
    expect(sql).toContain('if not public.is_eclado_admin()');
    expect(sql).toContain('select instruction.order_id, instruction.payment_method');
    expect(sql).not.toContain('select instruction.*');
  }
});

test('後台付款狀態查詢只回傳安全的付款嘗試摘要', () => {
  const sql = read('supabase-admin-order-payment-details.sql');
  expect(sql).toContain('create or replace function public.get_admin_order_payment_details()');
  expect(sql).toContain('if not public.is_eclado_admin()');
  expect(sql).toContain('attempt.payment_state');
  expect(sql).toContain('left(attempt.provider_description, 300)');
  expect(sql).not.toContain('payment_url');
  expect(sql).not.toContain('atm_account');
  expect(sql).not.toContain('provider_transaction_no');
});

test('重複付款狀態更新不會再次扣庫存，履約狀態互轉也不重複扣補', () => {
  for (const file of ['supabase-full-setup.sql', 'supabase-inventory-reservation.sql']) {
    const sql = read(file);
    expect(sql).toContain('not public.order_consumes_inventory(old.status) and public.order_consumes_inventory(new.status)');
    expect(sql).toContain('public.order_consumes_inventory(old.status) and not public.order_consumes_inventory(new.status)');
    expect(sql).toContain('public.order_consumes_inventory(old.status) and public.order_consumes_inventory(new.status) and old.items is distinct from new.items');
    expect(sql).not.toContain('if new.status = \'paid\' then');
  }
});

test('預購與超過現貨數量只扣下單當下可用庫存，且不允許負庫存', () => {
  for (const file of ['supabase-full-setup.sql', 'supabase-inventory-reservation.sql', 'supabase-preorder-inventory.sql']) {
    const sql = read(file);
    expect(sql).toContain('stock_qty := least(item_qty, stock_at_order)');
    expect(sql).toContain('set stock = greatest(0, stock + (direction * stock_qty))');
  }
});

test('付款建單 claim 以資料列鎖與狀態欄位阻擋同訂單並行或重複建單', () => {
  for (const file of ['supabase-authoritative-pricing.sql', 'supabase-order-payment-deadlines.sql']) {
    const sql = read(file);
    expect(sql).toContain('where order_id = p_order_id\n  for update');
    expect(sql).toContain("raise exception 'Payment has already been created'");
    expect(sql).toContain("raise exception 'Payment creation is already in progress'");
    expect(sql).toContain("target_order.status not in ('awaiting_confirm', 'unpaid')");
    expect(sql).toContain("raise exception 'Order payment has expired'");
  }
});

test('付款嘗試狀態與訂單履約狀態分開保存', () => {
  for (const file of ['supabase-order-payment-instructions.sql', 'supabase-payment-result-flow.sql']) {
    const sql = read(file);
    expect(sql).toContain("payment_state text not null default 'pending'");
    expect(sql).toContain("'pending', 'paid', 'failed', 'expired', 'cancelled'");
  }
  const migration = read('supabase-payment-result-flow.sql');
  expect(migration).toContain("'ready_for_pickup', 'picked_up'");
});

test('重新付款保留原訂單並為每次金流建立獨立嘗試', () => {
  const sql = read('supabase-payment-retry.sql');
  expect(sql).toContain('create table if not exists public.order_payment_attempts');
  expect(sql).toContain('unique (order_id, attempt_no)');
  expect(sql).toContain('provider_order_no text not null unique');
  expect(sql).toContain('create or replace function public.begin_order_payment_retry');
  expect(sql).toContain("target_order.status <> 'unpaid'");
  expect(sql).toContain("instruction.payment_state <> 'failed'");
  expect(sql).toContain("instruction.payment_method not in ('card', 'apple', 'google')");
  expect(sql).toContain("coalesce(payment_auth.attempt_no, 1), coalesce(instruction.attempt_no, 1)) + 1");
  expect(sql).toContain("instruction.payment_method, 'initiated'");
});
