import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase-professional-application-admin-notifications.sql'),
  'utf8',
);

test('美容師申請管理員通知具有一次性 claim 與寄送狀態', () => {
  expect(sql).toContain('admin_notification_sent_at');
  expect(sql).toContain('admin_notification_attempts');
  expect(sql).toContain('admin_notification_error');
  expect(sql).toContain('claim_professional_application_admin_notification');
  expect(sql).toContain('complete_professional_application_admin_notification');
  expect(sql).toContain("application.status = 'pending'");
  expect(sql).toContain('application.user_id = p_user_id');
});

test('通知狀態 RPC 只授權 service role', () => {
  expect(sql).toContain("auth.role() <> 'service_role'");
  expect(sql).toContain('from public, anon, authenticated');
  expect(sql).toContain('to service_role');
  expect(sql).not.toContain('to anon;');
});
