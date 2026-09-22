import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.resolve(process.cwd(), 'supabase-member-admin-notes.sql'), 'utf8');

test('會員內部備註獨立於 profiles 且會員本人無法讀寫', () => {
  expect(sql).toContain('create table if not exists public.member_admin_notes');
  expect(sql).toContain('revoke all on table public.member_admin_notes from anon, authenticated');
  expect(sql).not.toMatch(/alter table public\.profiles/);
  expect(sql).toContain('check (char_length(note) between 1 and 1000)');
});

test('會員或訂單查看權限可讀、只有會員編輯權限可寫並留下操作紀錄', () => {
  expect(sql).toContain("public.has_backoffice_permission('members.read')");
  expect(sql).toContain("or public.has_backoffice_permission('orders.read')");
  expect(sql).toContain("if not public.has_backoffice_permission('members.write') then");
  expect(sql).toContain("'profiles.admin_note_saved'");
  expect(sql).not.toContain('to anon');
});
