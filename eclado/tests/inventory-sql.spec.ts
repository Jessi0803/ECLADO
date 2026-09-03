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
  expect(inventory).toContain('改成 `cancelled` 或 `returned` 後，只加回實際配置且曾扣除的數量');
  expect(inventory).toContain('叫貨單「已到貨」目前不自動入庫');
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

test('後台角色採明確能力清單且商品小編不會被視為完整管理員', () => {
  const migration = read('supabase-backoffice-permissions.sql');
  expect(migration).toContain("('catalog_editor', 'catalog.read')");
  expect(migration).toContain("('catalog_editor', 'catalog.write')");
  expect(migration).toContain("('super_admin', 'backorders.manage')");
  expect(migration).toContain("role in ('admin', 'super_admin')");
  expect(migration).toContain('create or replace function public.has_backoffice_permission');
  expect(migration).toContain('create or replace function public.get_my_backoffice_access');
  expect(migration).not.toContain("('catalog_editor', 'orders.read')");
  expect(migration).not.toContain("('catalog_editor', 'members.read')");
  expect(migration).not.toContain("('admin', 'backorders.manage')");

  for (const file of [
    'supabase-admin-users.sql',
    'supabase-authoritative-pricing.sql',
    'supabase-full-setup.sql',
    'supabase-promotions.sql',
    'supabase-promotions-fix-rls.sql',
    'supabase-promotions-secure-rls.sql',
  ]) {
    expect(read(file)).toContain("role in ('admin', 'super_admin')");
  }
});

test('商品小編的商品 RPC 與 Storage 使用能力檢查並隔離進貨成本', () => {
  const catalog = read('supabase-security-hardening-20260827.sql');
  expect(catalog).toContain("has_backoffice_permission('catalog.read')");
  expect(catalog).toContain("has_backoffice_permission('catalog.write')");
  expect(catalog).toContain("to_jsonb(variant) - 'procurement_unit_cost_usd'");

  const saveProduct = read('supabase-save-product-with-variants.sql');
  expect(saveProduct).toContain("has_backoffice_permission('catalog.write')");
  expect(saveProduct).toContain("has_backoffice_permission('procurement.manage')");
  expect(saveProduct).toContain('select procurement_unit_cost_usd');

  const saveImages = read('supabase-save-product-images.sql');
  expect(saveImages).toContain("has_backoffice_permission('catalog.write')");

  const storage = read('supabase-product-images-foundation.sql');
  expect(storage).toContain("has_backoffice_permission('catalog.read')");
  expect(storage).toContain("has_backoffice_permission('catalog.write')");
});

test('重複付款狀態更新不會再次扣庫存，履約狀態互轉也不重複扣補', () => {
  const sql = read('supabase-order-inventory-allocation.sql');
  expect(sql).toContain('not public.order_consumes_inventory(old.status)\n    and public.order_consumes_inventory(new.status)');
  expect(sql).toContain('public.order_consumes_inventory(old.status)\n    and not public.order_consumes_inventory(new.status)');
  expect(sql).toContain('public.order_consumes_inventory(old.status)\n    and public.order_consumes_inventory(new.status)');
  expect(sql).not.toContain("if new.status = 'paid' then");
});

test('預購與超過現貨數量只扣付款當下可用規格庫存，且不允許負庫存', () => {
  const sql = read('supabase-order-inventory-allocation.sql');
  expect(sql).toContain('allocated := least(item_qty, greatest(coalesce(available_qty, 0), 0))');
  expect(sql).toContain('set stock = stock - allocated');
  expect(sql).toContain('backorder_qty, stock_deducted_qty');
});

test('新版庫存配置以規格庫存為準並保存付款配置、回補與 FIFO 軌跡', () => {
  const sql = read('supabase-order-inventory-allocation.sql');
  expect(sql).toContain('create table if not exists public.order_inventory_allocations');
  expect(sql).toContain('create table if not exists public.inventory_allocation_events');
  expect(sql).toContain('from public.product_variants\n  where id = p_variant_id\n  for update');
  expect(sql).toContain("'payment_allocate'");
  expect(sql).toContain("'fifo_allocate'");
  expect(sql).toContain("'release'");
  expect(sql).toContain('order by item.priority_at, orders.created_at, item.id');
  expect(sql).toContain("has_backoffice_permission('backorders.manage')");
  expect(sql).toContain('drop trigger if exists trg_orders_inventory_sync on public.orders');
  expect(sql).toContain("new.status in ('ready_for_pickup', 'picked_up', 'shipped', 'delivered')");
  expect(sql).toContain('allocation.backorder_qty > 0');
  expect(sql).not.toContain('update public.purchase_orders');
});

test('待補商品權限只授予最高管理員並保留商品小編角色', () => {
  const sql = read('supabase-super-admin-backorders.sql');
  expect(sql).toContain("values ('super_admin', 'backorders.manage')");
  expect(sql).toContain("lower(email) = 'k0919933386@gmail.com'");
  expect(sql).toContain("lower(auth_user.email) <> 'k0919933386@gmail.com'");
  expect(sql).toContain("admin_user.role in ('admin', 'super_admin')");
  expect(sql).toContain('Preserve catalog_editor');
  expect(sql).not.toContain("admin_user.role = 'catalog_editor'");
});

test('訪客訂單歸戶採單筆原子鎖定、雙權限與獨立稽核事件', () => {
  const sql = read('supabase-order-member-assignment.sql');
  expect(sql).toContain("has_backoffice_permission('orders.write')");
  expect(sql).toContain("has_backoffice_permission('members.write')");
  expect(sql).toContain('for update');
  expect(sql).toContain('and user_id is null');
  expect(sql).toContain("'orders.member_assigned'");
  expect(sql).toContain("'manual-order-member-assignment'");
  expect(sql).toContain('grant execute on function public.assign_guest_order_to_member(text, uuid) to authenticated');
  expect(sql).not.toContain('set email =');
  expect(sql).not.toContain('set phone =');
});

test('建單快照會以購買數量判斷部分缺貨而非只判斷庫存大於零', () => {
  const sql = read('supabase-authoritative-pricing.sql');
  expect(sql).toContain("'available_qty_at_order', least(quantity, item_stock)");
  expect(sql).toContain("'backorder_qty_at_order', greatest(quantity - item_stock, 0)");
  expect(sql).toContain("case when item_stock >= quantity then 'in_stock' else 'preorder' end");
  expect(sql).not.toContain("case when item_stock > 0 then 'in_stock' else 'preorder' end");
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
