import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.resolve('supabase-historical-orders.sql'), 'utf8');

test('歷史補登沿用 orders 並以來源與交易日期區分', () => {
  expect(sql).toContain("add column if not exists order_source text not null default 'online'");
  expect(sql).toContain('add column if not exists transaction_date date');
  expect(sql).toContain("check (order_source in ('online', 'historical_manual'))");
  expect(sql).not.toMatch(/create table if not exists public\.historical_orders/i);
});

test('後端固定歷史來源與既有完成狀態且不信任前端', () => {
  expect(sql).toContain('create or replace function public.create_historical_order');
  expect(sql).toContain("'delivered'");
  expect(sql).toContain("'historical_manual'");
  expect(sql).not.toMatch(/p_(status|order_source)\s/i);
  expect(sql).toContain("public.has_backoffice_permission('orders.write')");
});

test('商品快照使用管理員輸入的歷史價格並驗證資料', () => {
  expect(sql).toContain("historical_unit_price := (requested_item ->> 'unit_price')::numeric");
  expect(sql).toContain("'unit_price', historical_unit_price");
  expect(sql).toContain("'line_total', historical_unit_price * quantity");
  expect(sql).toContain('quantity <= 0');
  expect(sql).toContain('historical_unit_price < 0');
  expect(sql).toContain('p_transaction_date > today_taipei');
});

test('建立 order 與內部備註位於同一 transaction', () => {
  expect(sql.trimStart()).toMatch(/^--[\s\S]*?begin;/i);
  expect(sql.trimEnd()).toMatch(/commit;$/i);
  expect(sql).toContain('insert into public.orders');
  expect(sql).toContain('insert into public.order_admin_notes');
});

test('歷史訂單不觸發庫存 allocation、付款或物流資料', () => {
  expect(sql).toContain("when (new.order_source <> 'historical_manual')");
  expect(sql).toContain('execute function public.sync_inventory_allocation_for_order()');
  expect(sql).not.toMatch(/insert into public\.(order_payment_authorizations|order_payment_instructions|shipping_groups|coupon_redemptions|promotion_gift_reservations|shopping_credit_ledger)/i);
});

test('歷史訂單快照與來源不可被後續改寫', () => {
  expect(sql).toContain('Order source is immutable');
  expect(sql).toContain('Historical order snapshots are immutable');
  expect(sql).toContain("app.eclado_historical_order_write");
});

test('歷史補登只能透過管理員 RPC 單向作廢且不可永久刪除', () => {
  expect(sql).toContain('create or replace function public.cancel_historical_order');
  expect(sql).toContain("public.has_backoffice_permission('orders.write')");
  expect(sql).toContain("old.status = 'delivered'");
  expect(sql).toContain("new.status = 'cancelled'");
  expect(sql).toContain("app.eclado_historical_order_cancel");
  expect(sql).toContain('Historical orders cannot be permanently deleted');
  expect(sql).toContain('before insert or update or delete on public.orders');
});

test('熱門商品統計排除歷史補登', () => {
  expect(sql).toContain("orders.order_source <> 'historical_manual'");
  expect(sql).toContain('create or replace function public.get_public_sales_stats()');
});

test('內部備註不透過會員可讀的 orders row 保存', () => {
  expect(sql).toContain('create table if not exists public.order_admin_notes');
  expect(sql).toContain('revoke all on table public.order_admin_notes from anon, authenticated');
  expect(sql).toContain("public.has_backoffice_permission('orders.read')");
});
