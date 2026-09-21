import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase-professional-sales-opening-balance.sql'),
  'utf8',
);

test('線下補登以資格季度為單位保存並只能透過 RPC 存取', () => {
  expect(sql).toContain('create table if not exists public.professional_sales_adjustments');
  expect(sql).toContain('unique (membership_id, quarter_number)');
  expect(sql).toContain('amount numeric(12, 0) not null check (amount >= 0)');
  expect(sql).toContain('revoke all on table public.professional_sales_adjustments from anon, authenticated');
  expect(sql).not.toContain('grant select on table public.professional_sales_adjustments');
});

test('起始日與補登需要會員寫入權限、不可設為未來並留下操作紀錄', () => {
  expect(sql.match(/public\.has_backoffice_permission\('members\.write'\)/g)?.length).toBe(2);
  expect(sql).toContain('p_started_on > today');
  expect(sql).toContain('Start date overlaps another membership period');
  expect(sql).toContain("'professional_memberships.start_changed'");
  expect(sql).toContain("'professional_sales_adjustments.saved'");
  expect(sql).toContain('grant execute on function public.set_professional_membership_start(uuid, date) to authenticated');
  expect(sql).not.toContain('to anon');
});

test('季度總額合併官網訂單與線下補登', () => {
  expect(sql).toContain('online.online_sales_amount + coalesce(adjustment.amount, 0) as sales_amount');
  expect(sql).toContain("target_order.status in ('paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered')");
  expect(sql).toContain('limit 40');
});

const emptyPeriodSql = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase-professional-memberships-empty-periods.sql'),
  'utf8',
);

test('同日切換身分的空資格紀錄會被清除且不影響回溯起始日', () => {
  expect(emptyPeriodSql).toContain('where membership.ended_on = membership.started_on');
  expect(emptyPeriodSql).toContain('and membership.started_on >= effective_on');
  expect(emptyPeriodSql).toContain("and coalesce(other.ended_on, 'infinity'::date) > other.started_on");
  expect(emptyPeriodSql.match(/public\.has_backoffice_permission\('members\.write'\)/g)?.length).toBe(2);
  expect(emptyPeriodSql).not.toContain('to anon');
});
