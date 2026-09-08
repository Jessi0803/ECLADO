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
