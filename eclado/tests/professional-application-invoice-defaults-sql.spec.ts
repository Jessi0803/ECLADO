import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(
  path.resolve(process.cwd(), 'supabase-professional-application-invoice-defaults.sql'),
  'utf8',
);

test('美容師申請保存選填公司抬頭與統編快照', () => {
  expect(sql).toContain('add column if not exists invoice_company_name text');
  expect(sql).toContain('add column if not exists invoice_tax_id text');
  expect(sql).toContain("btrim(invoice_tax_id) ~ '^[0-9]{8}$'");
  expect(sql).toContain('p_invoice_company_name text');
  expect(sql).toContain('p_invoice_tax_id text');
});

test('核准申請時同步發票預設值，空白申請不覆蓋既有資料', () => {
  expect(sql).toContain("new.status = 'approved'");
  expect(sql).toContain('trg_sync_approved_application_invoice_defaults');
  expect(sql).toContain('default_invoice_company_name = coalesce');
  expect(sql).toContain('profile.default_invoice_company_name');
  expect(sql).toContain('profile.default_invoice_tax_id');
});
