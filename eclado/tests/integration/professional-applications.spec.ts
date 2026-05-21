import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type StagingEnv = { url: string; serviceRoleKey: string };
type AppRow = { id: string; status: string; studio_name: string; source: string };

const envPath = join(process.cwd(), '.env.staging');
const shouldRun = process.env.RUN_STAGING_INTEGRATION === '1';
const stagingEnv = loadStagingEnv();
const integrationEnabled = shouldRun && stagingEnv !== null;

test.describe('professional_applications 審核流程 (staging Supabase)', () => {
  test.skip(
    !integrationEnabled,
    'Set RUN_STAGING_INTEGRATION=1 and fill .env.staging to run staging integration tests.',
  );

  // ── 寫入與讀取 ──────────────────────────────────────────────────────────────

  test('美容師申請可寫入並以 pending 狀態讀回', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Run staging integration once on chromium only.');

    const sb = new SupabaseRest(stagingEnv!);
    const appId = await insertTestApp(sb, 'read-test');

    try {
      const row = await sb.first<AppRow>(`/professional_applications?id=eq.${appId}&select=id,status,studio_name,source`);
      expect(row?.status).toBe('pending');
      expect(row?.studio_name).toBe('Playwright read-test 工作室');
      expect(row?.source).toBe('registration');
    } finally {
      await sb.delete(`/professional_applications?id=eq.${appId}`, { ignoreMissing: true });
    }
  });

  // ── 核准流程 ────────────────────────────────────────────────────────────────

  test('核准申請：status 更新為 approved', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Run staging integration once on chromium only.');

    const sb = new SupabaseRest(stagingEnv!);
    const appId = await insertTestApp(sb, 'approve-test');

    try {
      await sb.patch(`/professional_applications?id=eq.${appId}`, { status: 'approved' });
      const row = await sb.first<AppRow>(`/professional_applications?id=eq.${appId}&select=status`);
      expect(row?.status).toBe('approved');
    } finally {
      await sb.delete(`/professional_applications?id=eq.${appId}`, { ignoreMissing: true });
    }
  });

  // ── 拒絕流程 ────────────────────────────────────────────────────────────────

  test('拒絕申請：status 更新為 rejected', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Run staging integration once on chromium only.');

    const sb = new SupabaseRest(stagingEnv!);
    const appId = await insertTestApp(sb, 'reject-test');

    try {
      await sb.patch(`/professional_applications?id=eq.${appId}`, { status: 'rejected' });
      const row = await sb.first<AppRow>(`/professional_applications?id=eq.${appId}&select=status`);
      expect(row?.status).toBe('rejected');
    } finally {
      await sb.delete(`/professional_applications?id=eq.${appId}`, { ignoreMissing: true });
    }
  });

  // ── status 欄位值限制 ────────────────────────────────────────────────────────

  test('status 不接受非法值（DB constraint）', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Run staging integration once on chromium only.');

    const sb = new SupabaseRest(stagingEnv!);
    const appId = await insertTestApp(sb, 'constraint-test');

    try {
      await expect(
        sb.patch(`/professional_applications?id=eq.${appId}`, { status: 'invalid' }),
      ).rejects.toThrow();
    } finally {
      await sb.delete(`/professional_applications?id=eq.${appId}`, { ignoreMissing: true });
    }
  });

  // ── standalone 來源（professional-apply.html 頁面）───────────────────────────

  test('standalone source 寫入正常', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Run staging integration once on chromium only.');

    const sb = new SupabaseRest(stagingEnv!);
    const rows = await sb.post<AppRow[]>('/professional_applications', {
      studio_name: 'Playwright standalone 工作室',
      contact_name: 'Playwright 測試',
      phone: '0900000000',
      address: '台北市測試路1號',
      social_media: '@playwright_standalone',
      certificate: 'Playwright 測試證書',
      status: 'pending',
      source: 'standalone',
    });
    const appId = rows?.[0]?.id;
    expect(appId).toBeTruthy();

    try {
      const row = await sb.first<AppRow>(`/professional_applications?id=eq.${appId}&select=source,status`);
      expect(row?.source).toBe('standalone');
      expect(row?.status).toBe('pending');
    } finally {
      if (appId) await sb.delete(`/professional_applications?id=eq.${appId}`, { ignoreMissing: true });
    }
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

async function insertTestApp(sb: SupabaseRest, tag: string): Promise<string> {
  const rows = await sb.post<AppRow[]>('/professional_applications', {
    studio_name: `Playwright ${tag} 工作室`,
    contact_name: 'Playwright 測試',
    phone: '0900000000',
    address: '台北市測試路1號',
    social_media: '@playwright_test',
    certificate: 'Playwright 測試證書',
    status: 'pending',
    source: 'registration',
  });
  const id = rows?.[0]?.id;
  if (!id) throw new Error(`Failed to create test application for tag="${tag}"`);
  return id;
}

function loadStagingEnv(): StagingEnv | null {
  const fromFile = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, 'utf8')) : {};
  const url = normalizeSupabaseUrl(process.env.STAGING_SUPABASE_URL || fromFile.STAGING_SUPABASE_URL || '');
  const serviceRoleKey = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || fromFile.STAGING_SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
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

class SupabaseRest {
  constructor(private readonly env: StagingEnv) {}

  async first<T>(path: string) {
    const rows = await this.get<T[]>(path);
    return rows[0] ?? null;
  }

  async get<T>(path: string) { return this.call<T>('GET', path); }
  async post<T = unknown>(path: string, body: unknown) { return this.call<T>('POST', path, body); }
  async patch<T = unknown>(path: string, body: unknown) { return this.call<T>('PATCH', path, body); }
  async delete(path: string, opts: { ignoreMissing?: boolean } = {}) {
    return this.call('DELETE', path, undefined, opts);
  }

  private async call<T>(method: string, path: string, body?: unknown, opts: { ignoreMissing?: boolean } = {}) {
    const res = await fetch(`${this.env.url}/rest/v1${path}`, {
      method,
      headers: {
        apikey: this.env.serviceRoleKey,
        Authorization: `Bearer ${this.env.serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      if (opts.ignoreMissing && res.status === 404) return null as T;
      throw new Error(`${method} ${path} → HTTP ${res.status}: ${await res.text()}`);
    }
    if (res.status === 204) return null as T;
    return (await res.json()) as T;
  }
}
