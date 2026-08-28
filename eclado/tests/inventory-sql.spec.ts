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
