import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.resolve('supabase-professional-shipping-groups.sql'), 'utf8');

test('合併出貨只新增 nullable 關聯並保留獨立訂單', () => {
  expect(sql).toContain('create table if not exists public.shipping_groups');
  expect(sql).toContain('add column if not exists shipping_group_id uuid');
  expect(sql).toContain('on delete set null');
  expect(sql).not.toMatch(/update\s+public\.orders\s+set\s+items/i);
});

test('追加資格集中限制為既有三種專業角色', () => {
  expect(sql).toContain("in ('pro', 'instructor', 'distributor')");
  expect(sql).toContain('Combined shipping is available only to professional members');
  expect(sql).toContain('target_group.user_id <> new.user_id');
});

test('首單仍需五千，只有已付款 open group 能豁免追加單門檻', () => {
  expect(sql).toContain('effective_merchandise_amount < 5000');
  expect(sql).toContain('and not is_additional_order');
  expect(sql).toContain('public.is_shipping_group_valid_order_status(target_order.status)');
  expect(sql).toContain("'paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered'");
});

test('追加單運費為零且金額使用折扣後、購物金前商品金額', () => {
  expect(sql).toContain('effective_merchandise_amount := subtotal_amount - total_discount');
  expect(sql).toContain('elsif is_additional_order then');
  expect(sql).toContain('shipping_amount := 0');
  expect(sql).toContain('total_amount := effective_merchandise_amount + shipping_amount');
});

test('付款成功才建立新批次，備貨只鎖定群組', () => {
  expect(sql).toContain('not public.is_shipping_group_valid_order_status(old.status)');
  expect(sql).toContain("and new.status = 'paid'");
  expect(sql).toContain("new.status in (\n      'preparing'");
  expect(sql).toContain("set status = 'locked'");
  expect(sql).not.toMatch(/update\s+public\.orders[\s\S]{0,120}set\s+status\s*=\s*'preparing'/i);
});

test('鎖定前已建立的未付款追加單仍可在鎖定後付款', () => {
  expect(sql).toContain('Existing grouped pending\n-- orders keep their group');
  expect(sql).toContain('new.shipping_group_id is null');
  expect(sql).toContain("pending_order_count");
});

test('滿一萬五只退首單原運費一次並寫入不可變購物金 ledger', () => {
  expect(sql).toContain('effective_total < 15000');
  expect(sql).toContain("target_group.user_id, 'grant', refund_amount");
  expect(sql).toContain("'shipping_refund'");
  expect(sql).toContain('shopping_credit_shipping_refund_unique_idx');
  expect(sql).toContain("metadata ->> 'shipping_group_id'");
  expect(sql).toContain('for update');
});

test('取消只排除累積並產生人工警示，不追回退款', () => {
  expect(sql).toContain("'requires_manual_review'");
  expect(sql).toContain('group_totals.effective_total < 15000');
  expect(sql).toContain("'below_minimum_warning'");
  expect(sql).not.toMatch(/reason_code[^\n]*shipping_refund[\s\S]{0,500}(debit|available_delta\s*=\s*-[a-z_]+)/i);
});

test('多個 open group 採 fail closed，不猜測或合併', () => {
  expect(sql).toContain('if group_count > 1 then');
  expect(sql).toContain('此會員有多個可追加出貨批次');
});

test('只有一張安全的舊 paid 訂單才 lazy 建立群組，多張舊訂單拒絕猜測', () => {
  expect(sql).toContain("target_order.status = 'paid'");
  expect(sql).toContain('target_order.shipping_group_id is null');
  expect(sql).toContain('if legacy_candidate_count > 1 then');
  expect(sql).toContain('多張可追加的舊訂單');
  expect(sql).toContain('set shipping_group_id = created_group_id');
});

test('群組資料不直接開放資料表，前後台透過受限 RPC', () => {
  expect(sql).toContain('alter table public.shipping_groups enable row level security');
  expect(sql).toContain('revoke all on table public.shipping_groups from anon, authenticated');
  expect(sql).toContain("public.has_backoffice_permission('orders.read')");
  expect(sql).toContain('grant execute on function public.get_my_appendable_shipping_group() to authenticated');
  expect(sql).toContain('trg_protect_order_shipping_group_relationship');
});
