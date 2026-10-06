import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase-member-quarterly-sales.sql'),
  'utf8',
);
const calendarSql = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase-professional-sales-calendar-quarters.sql'),
  'utf8',
);

test('專業會員保留資格歷程並依 user_id 歸戶', () => {
  expect(sql).toContain('create table if not exists public.professional_memberships');
  expect(sql).toContain("role text not null check (role in ('instructor', 'distributor'))");
  expect(sql).toContain("time zone 'Asia/Taipei'");
  expect(sql).toContain('target_order.user_id = p_member_id');
  expect(sql).toContain('target_order.paid_at');
});

test('專業會員採自然季並以資格起訖日裁切部分季度', () => {
  expect(calendarSql).toContain("date_trunc('quarter', membership.started_on::timestamp)");
  expect(calendarSql).toContain('greatest(membership.started_on, membership.quarter_start) as period_start');
  expect(calendarSql).toContain("extract(quarter from membership.quarter_start)::integer as calendar_quarter");
  expect(calendarSql).toContain('adjustment.quarter_start = online.quarter_start');
  expect(calendarSql).toContain("time zone 'Asia/Taipei'");
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
  expect(calendarSql).toContain('create or replace function public.save_professional_sales_adjustment_v2');
  expect(calendarSql).toContain('grant execute on function public.save_professional_sales_adjustment_v2(uuid, date, numeric, text) to authenticated');
});
