const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const productPageHandler = require('../../api/product-page.js');
const {
  LEGACY_PRODUCT_SLUGS,
  injectSeoDocument,
  productSeo,
  renderProductBody,
} = require('../../api/_seo.js');

const template = '<!doctype html><html><head><title>Fallback</title></head><body><div id="root"></div><script src="/assets/main.js"></script></body></html>';

test('SEO renderer places product content and metadata in initial HTML', () => {
  const product = {
    slug: 'test-toner', name: 'Test Toner', name_zh: '測試化妝水', description: '商品說明',
    category: '化妝水', series: 'Deep', size: '500ml', price: 1200, stock: 3,
    image_url: '/assets/test.png', features: ['保濕膚感'], ingredients: '玻尿酸', skin_type: '一般膚質',
  };
  const html = injectSeoDocument(template, productSeo(product), renderProductBody(product));

  assert.match(html, /<title>測試化妝水｜ECLADO<\/title>/);
  assert.match(html, /<meta name="description"/);
  assert.match(html, /<link rel="canonical" href="https:\/\/ecladotaiwan\.com\/products\/test-toner">/);
  assert.match(html, /<meta property="og:title"/);
  assert.match(html, /"@type":"Product"/);
  assert.match(html, /"@type":"BreadcrumbList"/);
  assert.match(html, /<h1>測試化妝水<\/h1>/);
  assert.match(html, /<h2>商品描述<\/h2><p>商品說明<\/p>/);
  assert.match(html, /<a href="\/shop">/);
  assert.match(html, /<script src="\/assets\/main\.js"><\/script>/);
});

test('legacy slugs and Vercel routing preserve real redirect and 404 handling', () => {
  assert.equal(Object.keys(LEGACY_PRODUCT_SLUGS).length, 42);
  assert.equal(LEGACY_PRODUCT_SLUGS['平衡爽膚水'], 'rebalancing-toner');

  const config = JSON.parse(readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8'));
  assert.deepEqual(config.rewrites.find(rule => rule.source === '/products/:slug'), {
    source: '/products/:slug', destination: '/api/product-page?slug=:slug',
  });
  assert.equal(config.rewrites.some(rule => rule.source === '/(.*)'), false);
});

function responseRecorder() {
  return {
    headers: {}, statusCode: 200, body: '',
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    send(body = '') { this.body = body; return this; },
    end(body = '') { this.body = body; return this; },
  };
}

test('product fallback returns HTTP 301 for legacy slugs', async () => {
  const res = responseRecorder();
  await productPageHandler({ method: 'GET', query: { slug: encodeURIComponent('平衡爽膚水') }, headers: {} }, res);
  assert.equal(res.statusCode, 301);
  assert.equal(res.headers.Location, '/products/rebalancing-toner');
});

test('product fallback returns HTTP 404 and noindex for unknown products', async () => {
  const originalFetch = global.fetch;
  global.fetch = async url => String(url).includes('/rest/v1/rpc/get_storefront_catalog')
    ? { ok: true, json: async () => ({ products: [] }) }
    : { ok: true, text: async () => template };
  try {
    const res = responseRecorder();
    await productPageHandler({ method: 'GET', query: { slug: 'missing-product' }, headers: { host: 'example.test', 'x-forwarded-proto': 'https' } }, res);
    assert.equal(res.statusCode, 404);
    assert.match(res.body, /<meta name="robots" content="noindex,nofollow">/);
    assert.match(res.body, /<h1>找不到此商品<\/h1>/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('product template ignores request hosts and uses trusted origin without redirects', async () => {
  const originalFetch = global.fetch;
  const originalSite = process.env.PUBLIC_SITE_URL;
  process.env.PUBLIC_SITE_URL = 'https://trusted.example.test';
  const calls = [];
  global.fetch = async (url, options = {}) => {
    if (String(url).includes('/rest/v1/rpc/get_storefront_catalog')) return {
      ok: true, json: async () => ({ products: [{ id: 1, slug: 'test-toner', name_zh: '測試化妝水' }] }),
    };
    calls.push(String(url));
    assert.equal(String(url), 'https://trusted.example.test/');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    return { ok: true, text: async () => template };
  };
  try {
    for (const method of ['GET', 'HEAD']) {
      const res = responseRecorder();
      await productPageHandler({ method, query: { slug: 'test-toner' }, headers: {
        host: 'attacker.example', 'x-forwarded-host': '127.0.0.1:1234', 'x-forwarded-proto': 'http',
      } }, res);
      assert.equal(res.statusCode, 200);
      if (method === 'GET') assert.match(res.body, /<script src="\/assets\/main\.js"><\/script>/);
      else assert.equal(res.body, '');
    }
    assert.equal(calls.length, 2);
  } finally {
    global.fetch = originalFetch;
    if (originalSite === undefined) delete process.env.PUBLIC_SITE_URL; else process.env.PUBLIC_SITE_URL = originalSite;
  }
});

test('template fetch failures retain safe product HTML instead of following an external redirect', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    if (String(url).includes('/rest/v1/rpc/get_storefront_catalog')) return {
      ok: true, json: async () => ({ products: [{ id: 1, slug: 'test-toner', name_zh: '測試化妝水' }] }),
    };
    assert.equal(options.redirect, 'error');
    throw new TypeError('redirect blocked');
  };
  try {
    const res = responseRecorder();
    await productPageHandler({ method: 'GET', query: { slug: 'test-toner' }, headers: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /<h1>測試化妝水<\/h1>/);
    assert.doesNotMatch(res.body, /attacker/);
  } finally { global.fetch = originalFetch; }
});

test('preview templates use isolated deployment configuration rather than request headers', async () => {
  const originalFetch = global.fetch;
  const keys = ['VERCEL_ENV', 'VERCEL_BRANCH_URL', 'PUBLIC_SITE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: 'preview.example.test',
    SUPABASE_URL: 'https://isolated.example.test', SUPABASE_ANON_KEY: 'test-anon' });
  delete process.env.PUBLIC_SITE_URL;
  let templateReads = 0;
  global.fetch = async (url, options = {}) => {
    if (String(url).includes('/rest/v1/rpc/get_storefront_catalog')) {
      assert.equal(new URL(String(url)).host, 'isolated.example.test');
      return { ok: true, json: async () => ({ products: [] }) };
    }
    templateReads++;
    assert.equal(String(url), 'https://preview.example.test/');
    assert.equal(options.redirect, 'error');
    return { ok: true, text: async () => template };
  };
  try {
    const res = responseRecorder();
    await productPageHandler({ method: 'GET', query: { slug: 'missing' }, headers: { host: 'attacker.test' } }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(templateReads, 1);
    assert.match(res.body, /<script src="\/assets\/main\.js"><\/script>/);
  } finally {
    global.fetch = originalFetch;
    for (const key of keys) if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
});
