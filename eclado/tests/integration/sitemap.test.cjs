const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');

const {
  buildSitemap,
  fetchActiveProducts,
} = require('../../api/sitemap.js');

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

test('sitemap reads products through the public storefront RPC', async () => {
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        products: [
          { name: 'Respiration Ampoule', name_zh: '呼吸安瓶' },
          { name: 'Rebalancing Toner', name_zh: '平衡爽膚水' },
        ],
      }),
    };
  };

  const products = await fetchActiveProducts();

  assert.equal(request.url.endsWith('/rest/v1/rpc/get_storefront_catalog'), true);
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.body, '{}');
  assert.equal(products.length, 2);
});

test('sitemap includes storefront product URLs', () => {
  const sitemap = buildSitemap([
    { slug: 'fixed-respiration-url', name: 'Renamed Respiration Ampoule', name_zh: '呼吸安瓶' },
    { name: 'Rebalancing Toner', name_zh: '平衡爽膚水' },
  ]);

  assert.match(sitemap, /https:\/\/ecladotaiwan\.com\/products\/fixed-respiration-url/);
  assert.doesNotMatch(sitemap, /products\/renamed-respiration-ampoule/);
  assert.match(sitemap, /https:\/\/ecladotaiwan\.com\/products\/rebalancing-toner/);
});

test('sitemap rejects malformed storefront responses', async () => {
  global.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
  });

  await assert.rejects(fetchActiveProducts(), /invalid product payload/);
});
