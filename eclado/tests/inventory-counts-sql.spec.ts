import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const sql = readFileSync(path.resolve('supabase-inventory-counts.sql'), 'utf8');

test('盤點單同時凍結一般與啟用中的贈品庫存及現場保留量', () => {
  expect(sql).toContain("variant.stock + coalesce(onsite.quantity, 0)");
  expect(sql).toContain("variant.gift_stock + coalesce(onsite.quantity, 0)");
  expect(sql).toContain("where product.publication_status <> 'gift_only'");
  expect(sql).toContain('where variant.gift_enabled is true');
  expect(sql).toContain("target_order.status in ('paid', 'preparing', 'ready_for_pickup')");
});

test('盤點輸入採逐項版號鎖，完成盤點則鎖定整張單與即時庫存', () => {
  expect(sql).toMatch(/item\.version = p_expected_version/);
  expect(sql).toContain("raise exception '此項目已被其他工作階段更新，請重新載入最新數量'");
  expect(sql).toMatch(/where session\.id = p_session_id\s+for update/);
  expect(sql).toMatch(/order by product_variant_id, inventory_type for update/);
  expect(sql).toMatch(/order by variant\.id for update/);
});

test('盤點差異套用完成當下可用庫存且不允許負數', () => {
  expect(sql).toContain('next_quantity := current_quantity + item.variance');
  expect(sql).toContain('remaining_shortage := greatest(-next_quantity, 0)');
  expect(sql).toContain('next_quantity := greatest(next_quantity, 0)');
  expect(sql).toContain('set gift_stock = next_quantity');
  expect(sql).toContain('set stock = next_quantity');
});

test('盤虧保留舊訂單優先，贈品補回則依 FIFO 回補', () => {
  expect(sql).toMatch(/order by inventory_allocation\.priority_at desc, inventory_allocation\.id desc/);
  expect(sql).toContain("backorder_qty = backorder_qty + take_quantity");
  expect(sql).toContain("case when item.inventory_type = 'sale' then 'resolved' else 'pending' end");
  expect(sql).toMatch(/order by allocation\.priority_at, allocation\.id, shortage_record\.id/);
  expect(sql).toContain("note = case when resolved_quantity + assign_quantity >= quantity then '贈品庫存已補回訂單'");
});

test('未填完整不可完成，完成後不可修改或刪除且永久保留', () => {
  expect(sql).toContain("where session_id = p_session_id and actual_quantity is null");
  expect(sql).toContain("raise exception '仍有尚未盤點的項目，無法完成盤點'");
  expect(sql).toContain("raise exception '盤點單已完成，無法修改'");
  expect(sql).toContain("raise exception '已完成的盤點單不可刪除'");
  expect(sql).toContain("set status = 'completed'");
});

test('庫存盤點 RPC 僅授權後台權限且不開放匿名呼叫', () => {
  expect(sql).toContain("has_backoffice_permission('inventory_counts.manage')");
  expect(sql).toContain('revoke all on function public.complete_inventory_count(uuid) from public, anon');
  expect(sql).toContain('revoke all on function public.update_inventory_count_item(bigint, integer, integer) from public, anon');
  expect(sql).toContain('grant execute on function public.complete_inventory_count(uuid) to authenticated');
});
