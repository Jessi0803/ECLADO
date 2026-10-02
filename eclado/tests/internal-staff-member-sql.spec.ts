import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.resolve('supabase-internal-staff-member.sql'), 'utf8');

test('內部人員角色由後台 RPC 設定並保留師資經銷季度範圍', () => {
  expect(sql).toContain("'consumer', 'pro', 'instructor', 'distributor', 'staff', 'pending'");
  expect(sql).toContain("public.has_backoffice_permission('members.write')");
  expect(sql).toContain("if p_role in ('instructor', 'distributor') then");
  expect(sql).not.toContain("if p_role in ('instructor', 'distributor', 'staff') then");
});

test('內部價為專業價五折並可購買專業商品', () => {
  expect(sql).toContain("'staff', '內部人員', 0.50, true, true");
  expect(sql).toContain("viewer_role in ('pro', 'instructor', 'distributor', 'staff')");
});

test('內部人員固定免運但不加入追加出貨角色', () => {
  expect(sql).toContain("profile.role = 'staff'");
  const shippingGroups = fs.readFileSync(path.resolve('supabase-professional-shipping-groups.sql'), 'utf8');
  expect(shippingGroups).toContain("select coalesce(p_role, '') in ('pro', 'instructor', 'distributor')");
  expect(shippingGroups).toContain("elsif member_role = 'staff' then");
});

test('優惠券可由管理員明確選擇內部人員且不改寫既有受眾', () => {
  expect(sql).toContain("array['consumer', 'pro', 'instructor', 'distributor', 'staff']::text[]");
  expect(sql).not.toMatch(/update\s+public\.coupon_campaigns\s+set\s+audience_roles/i);
});
