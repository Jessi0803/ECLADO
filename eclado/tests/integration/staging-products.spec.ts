import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type StagingEnv = {
  url: string;
  serviceRoleKey: string;
};

type ProductRow = {
  id: number;
  image_url: string | null;
  active: boolean;
};

const PROD_PROJECT_REF = 'ilvdvlkdpntwmaijncaz';
const envPath = join(process.cwd(), '.env.staging');
const shouldRun = process.env.RUN_STAGING_INTEGRATION === '1';
const stagingEnv = loadStagingEnv();
const integrationEnabled = shouldRun && stagingEnv !== null;

test.describe('products 新增與上下架 (staging Supabase)', () => {
  test.skip(
    !integrationEnabled,
    'Set RUN_STAGING_INTEGRATION=1 and fill .env.staging to run staging Supabase product tests.',
  );

  test('新增商品可保存圖片欄位，並可下架及重新上架', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Run staging integration once on chromium only.');
    expect(stagingEnv).not.toBeNull();
    assertNotProduction(stagingEnv!);

    const supabase = new SupabaseRest(stagingEnv!);
    const productId = Math.floor(1_500_000_000 + Math.random() * 500_000_000);
    const productPath = `/products?id=eq.${productId}`;
    const imageUrl = 'data:image/png;base64,c3RhZ2luZy1wcm9kdWN0LWltYWdl';

    try {
      await supabase.post('/products', {
        id: productId,
        name: 'playwright-staging-upload-product',
        name_zh: 'Playwright staging upload product',
        category: 'test',
        size: '1ml',
        price: 1,
        pro_price: 1,
        stock: 1,
        min_stock: 0,
        image_url: imageUrl,
        active: true,
      });

      await expectProduct(supabase, productId, {
        image_url: imageUrl,
        active: true,
      });

      await supabase.patch(productPath, { active: false });
      await expectProduct(supabase, productId, { image_url: imageUrl, active: false });

      await supabase.patch(productPath, { active: true });
      await expectProduct(supabase, productId, { image_url: imageUrl, active: true });
    } finally {
      await supabase.delete(productPath, { ignoreMissing: true });
    }
  });
});

function assertNotProduction(env: StagingEnv) {
  if (new URL(env.url).hostname.includes(PROD_PROJECT_REF)) {
    throw new Error('Refusing to write product integration data to the production Supabase project.');
  }
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
    const equalsAt = trimmed.indexOf('=');
    if (equalsAt === -1) continue;
    values[trimmed.slice(0, equalsAt).trim()] = trimmed.slice(equalsAt + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

function normalizeSupabaseUrl(url: string) {
  return url.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
}

async function expectProduct(supabase: SupabaseRest, productId: number, expected: Partial<ProductRow>) {
  const row = await supabase.first<ProductRow>(`/products?id=eq.${productId}&select=id,image_url,active`);
  expect(row).toMatchObject({ id: productId, ...expected });
}

class SupabaseRest {
  constructor(private readonly env: StagingEnv) {}

  async first<T>(path: string) {
    const rows = await this.get<T[]>(path);
    return rows[0] ?? null;
  }

  async get<T>(path: string) {
    return this.call<T>('GET', path);
  }

  async post<T = unknown>(path: string, body: unknown) {
    return this.call<T>('POST', path, body);
  }

  async patch<T = unknown>(path: string, body: unknown) {
    return this.call<T>('PATCH', path, body);
  }

  async delete(path: string, options: { ignoreMissing?: boolean } = {}) {
    return this.call('DELETE', path, undefined, options);
  }

  private async call<T>(method: string, path: string, body?: unknown, options: { ignoreMissing?: boolean } = {}) {
    const response = await fetch(`${this.env.url}/rest/v1${path}`, {
      method,
      headers: {
        apikey: this.env.serviceRoleKey,
        Authorization: `Bearer ${this.env.serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      if (options.ignoreMissing && response.status === 404) return null as T;
      throw new Error(`${method} ${path} failed with ${response.status}: ${await response.text()}`);
    }

    if (response.status === 204) return null as T;
    return (await response.json()) as T;
  }
}
