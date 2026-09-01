import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

test('42 組舊商品網址使用 301 導向當前英文 slug', () => {
  const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
  const redirects = config.redirects || [];

  expect(redirects).toHaveLength(42);
  expect(redirects.every((redirect: Record<string, unknown>) => redirect.statusCode === 301)).toBe(true);
  expect(redirects).toContainEqual({
    source: '/products/平衡爽膚水',
    destination: '/products/rebalancing-toner',
    statusCode: 301,
  });
  expect(redirects).toContainEqual({
    source: '/products/呼吸安瓶',
    destination: '/products/respiration-ampoule',
    statusCode: 301,
  });
  expect(new Set(redirects.map((redirect: Record<string, string>) => redirect.source)).size).toBe(42);
});

test('商品 slug 只在新增時依英文名稱產生，不跟著名稱更新', () => {
  const sql = readFileSync(join(root, 'supabase-product-stable-slugs.sql'), 'utf8');

  expect(sql).toContain('add column if not exists slug text');
  expect(sql).toContain('set slug = public.make_product_slug(name)');
  expect(sql).toContain("if tg_op = 'INSERT' then");
  expect(sql).toContain("before insert or update of slug on public.products");
  expect(sql).not.toContain('before insert or update of name');
  expect(sql).toContain('create unique index if not exists products_slug_unique');
});

test('未上架試用包使用對應正品的英文 slug', () => {
  const sql = readFileSync(join(root, 'supabase-product-stable-slugs.sql'), 'utf8');

  expect(sql).toContain("'cell-phyto-anti-wrinkle-serum-sample'");
  expect(sql).toContain("'cell-memory-cream-sample'");
  expect(sql).toContain("'enhancer-mild-cleanser-sample'");
  expect(sql).toContain("'exo-clinica-uv-suncream-sample'");
  expect(sql).toContain("'a-c-control-ampoule-f-sample'");
});
