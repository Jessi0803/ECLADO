const {
  LEGACY_PRODUCT_SLUGS,
  fetchStorefrontCatalog,
  injectSeoDocument,
  productSeo,
  renderProductBody,
} = require('./_seo.js');

function decodeSlug(value) {
  try { return decodeURIComponent(String(value || '')).toLowerCase(); } catch { return ''; }
}

function fallbackTemplate() {
  return '<!doctype html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ECLADO Taiwan</title></head><body><div id="root"></div></body></html>';
}

async function loadSiteTemplate(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!host) return fallbackTemplate();
  const protocol = req.headers['x-forwarded-proto'] || (String(host).includes('localhost') ? 'http' : 'https');
  try {
    const response = await fetch(`${protocol}://${host}/`);
    return response.ok ? await response.text() : fallbackTemplate();
  } catch {
    return fallbackTemplate();
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end('Method Not Allowed');
  }

  const requestedSlug = decodeSlug(req.query.slug);
  const legacyDestination = LEGACY_PRODUCT_SLUGS[requestedSlug];
  if (legacyDestination) {
    res.setHeader('Location', `/products/${legacyDestination}`);
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
    return res.status(301).end();
  }

  let products;
  try {
    products = await fetchStorefrontCatalog();
  } catch (error) {
    console.error('[product-page] catalog unavailable:', error.message);
    res.setHeader('Retry-After', '60');
    return res.status(503).send('商品資料暫時無法載入');
  }
  const product = products.find(item => decodeSlug(item.slug) === requestedSlug);
  const template = await loadSiteTemplate(req);
  if (!product) {
    const html = injectSeoDocument(template, {
      title: '找不到商品｜ECLADO Taiwan', description: '您開啟的商品不存在或已下架。',
      path: `/products/${encodeURIComponent(requestedSlug)}`, robots: 'noindex,nofollow',
    }, '<main class="seo-shell"><h1>找不到此商品</h1><p>商品可能已下架，或分享網址不正確。</p><p><a href="/shop">返回全部商品</a></p></main>');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(404).send(req.method === 'HEAD' ? '' : html);
  }

  const html = injectSeoDocument(template, productSeo(product), renderProductBody(product));
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(req.method === 'HEAD' ? '' : html);
};
