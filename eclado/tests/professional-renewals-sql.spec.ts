import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(path.resolve(process.cwd(), 'supabase-professional-renewals.sql'), 'utf8');

test('續約申請、審核與未申請降級由後端交易函式處理', () => {
  expect(sql).toContain('create table if not exists public.professional_renewal_applications');
  expect(sql).toContain('create or replace function public.submit_professional_renewal_application()');
  expect(sql).toContain('create or replace function public.finalize_professional_renewal_year');
  expect(sql).toContain('create or replace function public.review_professional_renewal_application');
  expect(sql).toContain("update public.profiles\n    set role = 'pro'");
  expect(sql).toContain("extract(month from today)::integer not between 10 and 12");
  expect(sql).toContain('for update');
});

test('A 條件依有效日比例計算且年度路徑禁止零進貨季度', () => {
  expect(sql).toContain('ceil(30000::numeric * activity.effective_days / activity.quarter_days)');
  expect(sql).toContain('ceil(120000::numeric * annual.effective_days / annual.year_days)');
  expect(sql).toContain('annual.has_no_zero_quarter');
  expect(sql).toContain('p_as_of date default null');
  expect(sql).toContain('quarter_end - 1');
});

test('品牌專班證明使用 private bucket、短效存取所需 RLS 與人工審核', () => {
  expect(sql).toContain("'professional-renewal-evidence'");
  expect(sql).toContain('false,\n  5242880');
  expect(sql).toContain('professional_renewal_evidence_objects_select_admin');
  expect(sql).toContain('create or replace function public.review_professional_award_evidence');
  expect(sql).toContain("status in ('pending', 'approved')");
  expect(sql).toContain("status = 'approved'");
  expect(sql).toContain("count(distinct lower(regexp_replace(btrim(student_name)");
});

test('季度通知快照有唯一版本、原子領取與失敗重試', () => {
  expect(sql).toContain('unique (user_id, quarter_start, version)');
  expect(sql).toContain('create or replace function public.claim_professional_quarterly_notices');
  expect(sql).toContain('for update skip locked');
  expect(sql).toContain("status = 'sending'");
  expect(sql).toContain('create or replace function public.create_professional_quarterly_notice_correction');
  expect(sql).toContain('supersedes_id');
});
