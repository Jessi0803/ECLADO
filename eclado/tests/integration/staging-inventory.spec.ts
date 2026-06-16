import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertStagingSupabaseUrl } from '../support/staging-safety';

type StagingEnv = {
  url: string;
  serviceRoleKey: string;
};

type ProductRow = { id: number; stock: number };

type OrderStatus = 'awaiting_confirm' | 'paid' | 'preparing' | 'shipped' | 'delivered' | 'returned';

const envPath = join(process.cwd(), '.env.staging');
const shouldRun = process.env.RUN_STAGING_INTEGRATION === '1';
const stagingEnv = loadStagingEnv();
const integrationEnabled = shouldRun && stagingEnv !== null;

test.describe('staging Supabase inventory trigger', () => {
  test.skip(
    !integrationEnabled,
    'Set RUN_STAGING_INTEGRATION=1 and fill .env.staging to run staging Supabase integration tests.',
  );

  test('付款後扣庫存，出貨流程不補回，退貨才補回', async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium', 'Run staging integration once on chromium only.');
    expect(stagingEnv).not.toBeNull();
    assertStagingSupabaseUrl(stagingEnv!.url);

    const supabase = new SupabaseRest(stagingEnv!);
    const productId = Math.floor(1_000_000_000 + Math.random() * 500_000_000);
    const testStock = 10;
    const orderQty = 2;
    const orderId = `PW-STAGING-${Date.now()}`;
    const productPath = `/products?id=eq.${productId}`;
    const orderPath = `/orders?id=eq.${encodeURIComponent(orderId)}`;

    try {
      await supabase.post('/products', {
        id: productId,
        name: 'playwright-staging-product',
        name_zh: 'Playwright staging product',
        category: 'test',
        price: 1,
        pro_price: 1,
        stock: testStock,
        min_stock: 0,
        active: false,
      });

      await supabase.post('/orders', {
        id: orderId,
        member: 'Playwright Staging',
        type: 'consumer',
        items: [
          {
            id: productId,
            name: 'Playwright staging product',
            qty: orderQty,
            price: 1,
            stock_at_order: testStock,
          },
        ],
        total: orderQty,
        status: 'awaiting_confirm',
        date: new Date().toISOString().slice(0, 10),
        note: 'Playwright staging inventory trigger test',
      });

      await expectProductStock(supabase, productId, testStock);

      await updateStatus(supabase, orderPath, 'paid');
      await expectProductStock(supabase, productId, testStock - orderQty);

      for (const status of ['preparing', 'shipped', 'delivered'] satisfies OrderStatus[]) {
        await updateStatus(supabase, orderPath, status);
        await expectProductStock(supabase, productId, testStock - orderQty);
      }

      await updateStatus(supabase, orderPath, 'returned');
      await expectProductStock(supabase, productId, testStock);
    } finally {
      await supabase.delete(orderPath, { ignoreMissing: true });
      await supabase.delete(productPath, { ignoreMissing: true });
    }
  });
});

function loadStagingEnv(): StagingEnv | null {
  const fromFile = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, 'utf8')) : {};
  const url = normalizeSupabaseUrl(process.env.STAGING_SUPABASE_URL || fromFile.STAGING_SUPABASE_URL || '');
  const serviceRoleKey = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || fromFile.STAGING_SUPABASE_SERVICE_ROLE_KEY || '';

  if (!url || !serviceRoleKey) {
    return null;
  }

  return { url, serviceRoleKey };
}

function parseEnvFile(contents: string) {
  const values: Record<string, string> = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalsAt = trimmed.indexOf('=');
    if (equalsAt === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsAt).trim();
    const value = trimmed.slice(equalsAt + 1).trim().replace(/^['"]|['"]$/g, '');
    values[key] = value;
  }

  return values;
}

function normalizeSupabaseUrl(url: string) {
  return url.trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
}

async function updateStatus(supabase: SupabaseRest, orderPath: string, status: OrderStatus) {
  await supabase.patch(orderPath, { status });
}

async function expectProductStock(supabase: SupabaseRest, productId: number, expectedStock: number) {
  const product = await supabase.first<ProductRow>(`/products?id=eq.${productId}&select=id,stock`);
  expect(product?.stock).toBe(expectedStock);
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
      if (options.ignoreMissing && response.status === 404) {
        return null as T;
      }

      const text = await response.text();
      throw new Error(`${method} ${path} failed with ${response.status}: ${text}`);
    }

    if (response.status === 204) {
      return null as T;
    }

    return (await response.json()) as T;
  }
}
