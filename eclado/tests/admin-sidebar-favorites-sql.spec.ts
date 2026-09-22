import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.resolve(process.cwd(), 'supabase-admin-sidebar-favorites.sql'), 'utf8');

test('後台常用設定每個帳號只能讀寫自己的一筆', () => {
  expect(sql).toContain('create table if not exists public.admin_preferences');
  expect(sql).toContain('user_id uuid primary key references auth.users(id) on delete cascade');
  expect(sql.match(/user_id = auth\.uid\(\)/g)?.length).toBe(4);
  expect(sql).toContain("array_to_string(sidebar_favorites, ',') ~ '^[a-z_,]*$'");
  expect(sql).not.toContain('to anon');
  expect(sql).not.toContain('for delete');
});
