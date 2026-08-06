const SITE_ORIGIN = 'https://ecladotaiwan.com';
const DEFAULT_SUPABASE_URL = 'https://ilvdvlkdpntwmaijncaz.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_BasrQNdstdbX_InrQWmCuw_Jb1Lscnl';

const STATIC_PATHS = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/shop', changefreq: 'daily', priority: '0.9' },
  { path: '/about', changefreq: 'monthly', priority: '0.6' },
  { path: '/info', changefreq: 'monthly', priority: '0.5' },
  { path: '/contact', changefreq: 'monthly', priority: '0.5' },
  { path: '/privacy', changefreq: 'yearly', priority: '0.3' },
];

function escapeXml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function getProductSlug(name) {
  return String(name || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeLastModified(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

async function fetchActiveProducts() {
  const supabaseUrl = process.env.SUPABASE_URL
    || process.env.VITE_SUPABASE_URL
    || DEFAULT_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY
    || process.env.VITE_SUPABASE_ANON_KEY
    || DEFAULT_SUPABASE_ANON_KEY;
  const query = new URLSearchParams({
    select: 'name,name_zh,updated_at',
    publication_status: 'eq.active',
    active: 'eq.true',
    order: 'id.asc',
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/products?${query}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
  });
  if (!response.ok) throw new Error(`Supabase products HTTP ${response.status}`);
  return response.json();
}

function renderUrl({ path, lastmod, changefreq, priority }) {
  return [
    '  <url>',
    `    <loc>${escapeXml(`${SITE_ORIGIN}${path}`)}</loc>`,
    lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : null,
    changefreq ? `    <changefreq>${changefreq}</changefreq>` : null,
    priority ? `    <priority>${priority}</priority>` : null,
    '  </url>',
  ].filter(Boolean).join('\n');
}

function buildSitemap(products = []) {
  const productEntries = products
    .map(product => {
      const slug = getProductSlug(product.name || product.name_zh);
      if (!slug) return null;
      return {
        path: `/products/${encodeURIComponent(slug)}`,
        lastmod: normalizeLastModified(product.updated_at),
        changefreq: 'weekly',
        priority: '0.8',
      };
    })
    .filter(Boolean);
  const entries = [...STATIC_PATHS, ...productEntries];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(renderUrl),
    '</urlset>',
    '',
  ].join('\n');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end('Method Not Allowed');
  }

  let products = [];
  try {
    products = await fetchActiveProducts();
  } catch (error) {
    console.error('[sitemap] unable to load active products:', error.message);
  }

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(buildSitemap(products));
};

module.exports.buildSitemap = buildSitemap;
module.exports.getProductSlug = getProductSlug;
