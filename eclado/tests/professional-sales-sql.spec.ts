import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase-member-quarterly-sales.sql'),
  'utf8',
);

test('專業會員季度以資格生效日每三個曆月切分並依 user_id 歸戶', () => {
  expect(sql).toContain('create table if not exists public.professional_memberships');
  expect(sql).toContain("role text not null check (role in ('instructor', 'distributor'))");
  expect(sql).toContain('make_interval(months => series.quarter_index * 3)');
  expect(sql).toContain("time zone 'Asia/Taipei'");
  expect(sql).toContain('target_order.user_id = p_member_id');
  expect(sql).toContain('target_order.paid_at');
});

test('季度採購額使用商品實付快照、不含運費並排除無效訂單', () => {
  expect(sql).toContain('p_subtotal - coalesce(p_discount, 0)');
  expect(sql).toContain("p_pricing_snapshot ->> 'shipping'");
  expect(sql).toContain("target_order.status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered')");
  expect(sql).not.toMatch(/target_order\.status in \([^)]*cancelled/);
  expect(sql).not.toMatch(/target_order\.status in \([^)]*returned/);
});

test('角色變更與季度查詢由後端權限及原子 RPC 保護', () => {
  expect(sql).toContain("has_backoffice_permission('members.read')");
  expect(sql).toContain("has_backoffice_permission('members.write')");
  expect(sql).toContain('create or replace function public.set_member_role_with_membership');
  expect(sql).toContain('for update;');
  expect(sql).toContain('revoke all on function public.get_professional_sales_payload(uuid) from public, anon, authenticated');
  expect(sql).toContain('grant execute on function public.get_my_professional_sales() to authenticated');
});
