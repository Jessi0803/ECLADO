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
    expect(sql).toContain("order_status in ('paid', 'preparing', 'shipped', 'delivered')");
    expect(sql).not.toContain("order_status = 'paid'");
  }
});

test('功能清單描述與庫存 trigger 行為一致', () => {
  const inventory = read('docs/FUNCTION-INVENTORY.md');
  expect(inventory).toContain('`paid`、`preparing`、`shipped`、`delivered` 都視為占用庫存');
  expect(inventory).toContain('改成 `cancelled` 或 `returned` 後，庫存加回');
  expect(inventory).not.toContain('從 `paid` 改成任何非 `paid` 狀態時，庫存加回');
});
