import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Config ───────────────────────────────────────────────────────────────────

// Production Supabase credentials (used in the served HTML pages)
const PROD_SUPABASE_HOST = 'ilvdvlkdpntwmaijncaz.supabase.co';
const PROD_ANON_KEY = 'sb_publishable_BasrQNdstdbX_InrQWmCuw_Jb1Lscnl';

const envPath = join(process.cwd(), '.env.staging');
const shouldRun = process.env.RUN_STAGING_INTEGRATION === '1';
const stagingEnv = loadStagingEnv();
const integrationEnabled = shouldRun && stagingEnv !== null;

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Email 連結點擊流程 (Playwright + Resend + staging Supabase)', () => {
  test.slow(); // allow 3× timeout (135s) for email polling

  test.skip(
    !integrationEnabled,
    'Set RUN_STAGING_INTEGRATION=1 and fill .env.staging (including RESEND_API_KEY) to run.',
  );

  // ── 驗證信連結 ──────────────────────────────────────────────────────────────

  test('使用者點擊驗證信連結後 email_confirmed_at 寫入資料庫', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Run email-click integration once on chromium only.');

    const env = stagingEnv!;
    const testEmail = `test-eclado-verify-${Date.now()}@example.com`;
    let userId: string | null = null;

    try {
      // Intercept all production Supabase auth calls → proxy to staging
      await proxyAuthToStaging(page, env);

      // Navigate to /login so Supabase JS SDK initialises (sets up PKCE code_verifier)
      await page.goto('/login');
      await page.waitForLoadState('networkidle');

      // Trigger signUp via the page's JS so that PKCE code_verifier is stored in browser localStorage
      const signupResult = await page.evaluate(
        async ({ email }) => {
          const { data, error } = await (window as any).supabase.auth.signUp({
            email,
            password: 'testpass-click-123',
          });
          return { id: data?.user?.id ?? null, error: error?.message ?? null };
        },
        { email: testEmail },
      );

      expect(signupResult.error, `signUp failed: ${signupResult.error}`).toBeNull();
      userId = signupResult.id;
      expect(userId, 'Expected a userId from signUp').not.toBeNull();

      // Poll Resend for the verification email (up to 30 s)
      const email = await pollResendForEmail(env.resendApiKey, testEmail, 30_000);
      expect(email, `Resend 找不到寄給 ${testEmail} 的驗證信`).not.toBeNull();

      // Extract the confirmation link from the email HTML body
      const confirmLink = await fetchEmailLink(env.resendApiKey, email!.id, /confirm|verify/i);
      expect(confirmLink, '找不到驗證連結').not.toBeNull();

      // Redirect the Supabase confirmation link's host to staging, then follow it in the SAME page
      // so the browser (with code_verifier in localStorage) handles the PKCE exchange.
      const rewrittenLink = confirmLink!.replace(PROD_SUPABASE_HOST, new URL(env.url).host);
      await page.goto(rewrittenLink);
      await page.waitForURL(url => !url.hostname.includes('supabase'), { timeout: 20_000 });
      await page.waitForLoadState('networkidle');

      // Verify that email_confirmed_at is now set in staging auth.users
      const confirmed = await fetchEmailConfirmedAt(env, userId!);
      expect(confirmed, 'email_confirmed_at 應該有值，代表驗證成功').not.toBeNull();
    } finally {
      if (userId) await deleteAuthUser(env, userId);
    }
  });

  // ── 忘記密碼連結 ────────────────────────────────────────────────────────────

  test('使用者點擊忘記密碼連結後能成功更新密碼', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Run email-click integration once on chromium only.');

    const env = stagingEnv!;
    const testEmail = `test-eclado-reset-${Date.now()}@example.com`;
    let userId: string | null = null;

    try {
      // Create a confirmed staging user via admin API (no browser needed for setup)
      const created = await adminCreateUser(env, testEmail, 'testpass-reset-123');
      userId = created.id;
      expect(userId, '建立測試帳號失敗').not.toBeNull();

      // Intercept production Supabase auth calls → staging
      await proxyAuthToStaging(page, env);

      // Navigate to login so Supabase JS SDK is ready
      await page.goto('/login');
      await page.waitForLoadState('networkidle');

      // Trigger password recovery via the page's SDK so Supabase uses the correct redirect_to
      const recoverResult = await page.evaluate(
        async ({ email, redirectTo }) => {
          const { error } = await (window as any).supabase.auth.resetPasswordForEmail(email, {
            redirectTo,
          });
          return { error: error?.message ?? null };
        },
        { email: testEmail, redirectTo: `${page.url().replace(/\/login.*/, '')}/reset-password` },
      );

      expect(recoverResult.error, `resetPasswordForEmail failed: ${recoverResult.error}`).toBeNull();

      // Poll Resend for the reset email (up to 30 s, must be the reset email not the verify email)
      const email = await pollResendForEmail(
        env.resendApiKey,
        testEmail,
        30_000,
        subject => /reset|recover|password|重設|密碼/i.test(subject),
      );
      expect(email, `Resend 找不到重設密碼信給 ${testEmail}`).not.toBeNull();

      // Extract reset link from the email HTML
      const resetLink = await fetchEmailLink(env.resendApiKey, email!.id, /reset|recover/i);
      expect(resetLink, '找不到重設密碼連結').not.toBeNull();

      // Follow the link in the SAME page context (PKCE recovery token is validated browser-side)
      const rewrittenLink = resetLink!.replace(PROD_SUPABASE_HOST, new URL(env.url).host);
      await page.goto(rewrittenLink);
      await page.waitForURL(/reset-password/, { timeout: 20_000 });
      await page.waitForLoadState('networkidle');

      // Fill in a new password on the /reset-password page
      const newPassword = 'newpass-eclado-789';
      const inputs = page.locator('form input[type="password"]');
      await inputs.nth(0).fill(newPassword);
      await inputs.nth(1).fill(newPassword);
      await page.getByRole('button', { name: '更新密碼' }).click();

      // Confirm success message appears
      await expect(page.getByText(/密碼已更新/)).toBeVisible({ timeout: 10_000 });
    } finally {
      if (userId) await deleteAuthUser(env, userId);
    }
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Intercept all production Supabase auth requests in the page and proxy them
 * to the staging Supabase project, swapping out the apikey / authorization headers.
 */
async function proxyAuthToStaging(page: Page, env: StagingEnv) {
  await page.route(`**/${PROD_SUPABASE_HOST}/auth/v1/**`, async route => {
    const originalUrl = route.request().url();
    const stagingUrl = originalUrl.replace(PROD_SUPABASE_HOST, new URL(env.url).host);

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(route.request().headers())) {
      headers[k] = v;
    }

    // Swap production anon key → staging anon key
    if (headers['apikey'] === PROD_ANON_KEY) headers['apikey'] = env.anonKey;
    if (headers['authorization'] === `Bearer ${PROD_ANON_KEY}`) {
      headers['authorization'] = `Bearer ${env.anonKey}`;
    }

    try {
      const body = route.request().postData();
      const resp = await fetch(stagingUrl, {
        method: route.request().method(),
        headers,
        body: body ?? undefined,
      });
      const responseBody = await resp.arrayBuffer();
      await route.fulfill({
        status: resp.status,
        headers: Object.fromEntries(resp.headers.entries()),
        body: Buffer.from(responseBody),
      });
    } catch {
      await route.abort();
    }
  });
}

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
  const json = (await res.json()) as { data?: ResendEmail[] };
  return (
    (json.data ?? []).find(
      e =>
        Array.isArray(e.to) &&
        e.to.some(addr => addr.toLowerCase() === toEmail.toLowerCase()) &&
        (subjectFilter ? subjectFilter(e.subject) : true),
    ) ?? null
  );
}

/** Fetch a single email by ID and extract the first href matching urlPattern */
async function fetchEmailLink(apiKey: string, emailId: string, urlPattern: RegExp): Promise<string | null> {
  const res = await fetch(`https://api.resend.com/emails/${emailId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { html?: string; text?: string };

  const html = json.html ?? json.text ?? '';
  // Match href="..." or plain URLs containing the pattern keyword
  const hrefMatches = [...html.matchAll(/href=["']([^"']+)["']/g)].map(m => m[1]);
  return hrefMatches.find(href => urlPattern.test(href)) ?? null;
}

async function fetchEmailConfirmedAt(env: StagingEnv, userId: string): Promise<string | null> {
  const res = await fetch(`${env.url}/auth/v1/admin/users/${userId}`, {
    headers: {
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${env.serviceRoleKey}`,
    },
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { email_confirmed_at?: string };
  return json.email_confirmed_at ?? null;
}

async function adminCreateUser(
  env: StagingEnv,
  email: string,
  password: string,
): Promise<{ id: string }> {
  const res = await fetch(`${env.url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${env.serviceRoleKey}`,
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const json = (await res.json()) as { id: string };
  return { id: json.id };
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
  const url = normalizeSupabaseUrl(
    process.env.STAGING_SUPABASE_URL || fromFile.STAGING_SUPABASE_URL || '',
  );
  const anonKey =
    process.env.STAGING_SUPABASE_ANON_KEY || fromFile.STAGING_SUPABASE_ANON_KEY || '';
  const serviceRoleKey =
    process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY ||
    fromFile.STAGING_SUPABASE_SERVICE_ROLE_KEY ||
    '';
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
    values[trimmed.slice(0, eq).trim()] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }
  return values;
}

function normalizeSupabaseUrl(url: string): string {
  return url.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
}
