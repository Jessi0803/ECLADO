import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertStagingSupabaseUrl } from '../support/staging-safety';

type StagingEnv = {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  resendApiKey: string;
};

type ResendEmail = {
  id: string;
  to: string[];
  from: string;
  subject: string;
  created_at: string;
  last_event: string;
};

const envPath = join(process.cwd(), '.env.staging');
const shouldRun = process.env.RUN_STAGING_INTEGRATION === '1';
const stagingEnv = loadStagingEnv();
const integrationEnabled = shouldRun && stagingEnv !== null;

test.describe('Email 寄送驗證 (Resend + staging Supabase)', () => {
  test.skip(
    !integrationEnabled,
    'Set RUN_STAGING_INTEGRATION=1 and fill .env.staging (including RESEND_API_KEY) to run.',
  );

  // ── 驗證信 ───────────────────────────────────────────────────────────────────

  test('新會員註冊後 Resend 確實寄出驗證信', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Run email integration once on chromium only.');

    const env = stagingEnv!;
    assertStagingSupabaseUrl(env.url);
    const testEmail = `test-eclado-reg-${Date.now()}@example.com`;
    let userId: string | null = null;

    try {
      // 建立測試用帳號（觸發 Supabase 寄驗證信）
      const res = await fetch(`${env.url}/auth/v1/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: env.anonKey,
        },
        body: JSON.stringify({ email: testEmail, password: 'testpass123456' }),
      });
      expect(res.ok, `signup failed: ${res.status}`).toBe(true);
      const body = await res.json();
      userId = body?.id ?? null;

      // 等 Resend 處理（最多 15 秒）
      const email = await pollResendForEmail(env.resendApiKey, testEmail, 15_000);

      expect(email, `Resend 找不到寄給 ${testEmail} 的信`).not.toBeNull();
      expect(email!.subject.toLowerCase()).toMatch(/confirm|verify|驗證|確認/);
    } finally {
      if (userId) await deleteAuthUser(env, userId);
    }
  });

  // ── 忘記密碼信 ───────────────────────────────────────────────────────────────

  test('忘記密碼後 Resend 確實寄出重設密碼信', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Run email integration once on chromium only.');

    const env = stagingEnv!;
    assertStagingSupabaseUrl(env.url);
    const testEmail = `test-eclado-reset-${Date.now()}@example.com`;
    let userId: string | null = null;

    try {
      // 先建立帳號（忘記密碼必須有存在的帳號才會寄信）
      const signupRes = await fetch(`${env.url}/auth/v1/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: env.anonKey,
        },
        body: JSON.stringify({ email: testEmail, password: 'testpass123456' }),
      });
      expect(signupRes.ok).toBe(true);
      const signupBody = await signupRes.json();
      userId = signupBody?.id ?? null;

      // 觸發忘記密碼
      const resetRes = await fetch(`${env.url}/auth/v1/recover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: env.anonKey,
        },
        body: JSON.stringify({
          email: testEmail,
          redirect_to: 'https://ecladotaiwan.com/reset-password',
        }),
      });
      expect(resetRes.ok, `recover failed: ${resetRes.status}`).toBe(true);

      // 等 Resend 處理（最多 15 秒，且要找到忘記密碼那封，不是驗證信）
      const email = await pollResendForEmail(
        env.resendApiKey,
        testEmail,
        15_000,
        subject => /reset|recover|password|重設|密碼/i.test(subject),
      );

      expect(email, `Resend 找不到重設密碼信給 ${testEmail}`).not.toBeNull();
      expect(email!.subject.toLowerCase()).toMatch(/reset|recover|password|重設|密碼/);
    } finally {
      if (userId) await deleteAuthUser(env, userId);
    }
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function pollResendForEmail(
  apiKey: string,
  toEmail: string,
  timeoutMs: number,
  subjectFilter?: (subject: string) => boolean,
): Promise<ResendEmail | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(2000);
    const found = await findResendEmail(apiKey, toEmail, subjectFilter);
    if (found) return found;
  }
  return null;
}

async function findResendEmail(
  apiKey: string,
  toEmail: string,
  subjectFilter?: (subject: string) => boolean,
): Promise<ResendEmail | null> {
  const res = await fetch('https://api.resend.com/emails?limit=20', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return null;
  const json = await res.json() as { data?: ResendEmail[] };
  const emails = json.data ?? [];
  return emails.find(e =>
    Array.isArray(e.to) &&
    e.to.some(addr => addr.toLowerCase() === toEmail.toLowerCase()) &&
    (subjectFilter ? subjectFilter(e.subject) : true),
  ) ?? null;
}

async function deleteAuthUser(env: StagingEnv, userId: string) {
  await fetch(`${env.url}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: {
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${env.serviceRoleKey}`,
    },
  });
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadStagingEnv(): StagingEnv | null {
  const fromFile = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, 'utf8')) : {};
  const url = normalizeSupabaseUrl(process.env.STAGING_SUPABASE_URL || fromFile.STAGING_SUPABASE_URL || '');
  const anonKey = process.env.STAGING_SUPABASE_ANON_KEY || fromFile.STAGING_SUPABASE_ANON_KEY || '';
  const serviceRoleKey = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || fromFile.STAGING_SUPABASE_SERVICE_ROLE_KEY || '';
  const resendApiKey = process.env.RESEND_API_KEY || fromFile.RESEND_API_KEY || '';
  if (!url || !anonKey || !serviceRoleKey || !resendApiKey) return null;
  return { url, anonKey, serviceRoleKey, resendApiKey };
}

function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

function normalizeSupabaseUrl(url: string): string {
  return url.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
}
