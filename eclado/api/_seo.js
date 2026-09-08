const SITE_ORIGIN = 'https://ecladotaiwan.com';
const DEFAULT_SUPABASE_URL = 'https://ilvdvlkdpntwmaijncaz.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_BasrQNdstdbX_InrQWmCuw_Jb1Lscnl';

const LEGACY_PRODUCT_SLUGS = {
  '平衡爽膚水': 'rebalancing-toner', '完美潔面卸妝膏': 'perfect-cleansing-smoothie-balm',
  '乳酸菌亮白面膜': 'alphabiome-brightening-mask', '金箔片': 'gold-patch',
  '光采素顏霜': 'melaser-radiance-cream', '亮顏防曬bb霜': 'whitening-enhancer-sun-blemish-balm',
  '保濕補水霜': 'moisture-supplement-cream', '急救安瓶-水合複合': 'rescuer-hydra-complex-ampoule',
  '急救安瓶-胜肽再生': 'rescuer-filagen-ampoule', '急救安瓶-維他命美白': 'rescuer-multi-vitamin-ampoule',
  '急救安瓶-積雪草毛孔': 'rescuer-cica-pore-ampoule', '洋甘菊舒緩安瓶': 'azulene-cure-solution-ampoule',
  '氧氣泡泡': 'oxygen-bubble-pack', '純淨潔顏露': 'purifying-cleanser',
  '記憶多肽精華': 'cell-phyto-anti-wrinkle-serum', '記憶抗皺眼霜': 'cell-phyto-anti-wrinkle-eye-cream',
  '記憶修護霜': 'cell-memory-cream', '控油修護安瓶': 'a-c-control-ampoule-f',
  '淨痘修護霜': 'a-c-pimpeel-cream', '蛋白胜肽霜': 'exo-filagen-cream',
  '棉花水光套組': 'rejuven-fiber-ampoule-system', '舒緩凍膜': 'soothing-mask',
  '黃金天鵝絨面膜': 'ultra-gold-velvet-mask', '極致珍珠緞面膜': 'ultra-pearl-velvet-mask',
  '溫和增效潔面乳': 'enhancer-mild-cleanser', '精萃防曬霜': 'exo-clinica-uv-suncream',
  '精萃爽膚水': 'exo-clinica-toner', '精萃凝膠': 'exo-clinica-gel',
  '酵素潔顏粉': 'enzyme-deep-cleanser-pure-powder', '積雪草泥膜': 'a-c-centella-mask',
  '爆水按摩霜': 'shining-moisturizing-massage-cream', 'ac痘痘安瓶': 'ac-jet-ampoule',
  'c-p50安瓶組': 'c-p-50-ampoule', 'celvix-pro': 'eclado-celvix-pro',
  'l-輪廓安瓶': 'l-contour-ampoule', 'pha溫和煥膚': 'pha-soft-peel-15',
  'vono煥膚組': 'vono-prime-peel', '呼吸安瓶': 'respiration-ampoule',
  '呼吸爽膚水': 'respiration-toner', '呼吸雪霜': 'respiration-snow-cream',
  '呼吸精華液': 'respiration-serum', '黃金檀香刮痧板': 'golden-sandalwood-gua-sha-tool',
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function absoluteUrl(value = '/') {
  try { return new URL(value, SITE_ORIGIN).href; } catch { return SITE_ORIGIN; }
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function pageHead({ title, description, path, image = '/assets/images/hero-cover.jpg', type = 'website', robots = 'index,follow', jsonLd = [] }) {
  const canonical = absoluteUrl(path);
  const imageUrl = absoluteUrl(image);
  const schemas = (Array.isArray(jsonLd) ? jsonLd : [jsonLd]).filter(Boolean);
  return `<!--seo-head-start-->
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="${escapeHtml(robots)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:type" content="${escapeHtml(type)}">
  <meta property="og:url" content="${escapeHtml(canonical)}">
  <meta property="og:image" content="${escapeHtml(imageUrl)}">
  <meta property="og:locale" content="zh_TW">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}">
  ${schemas.map(schema => `<script type="application/ld+json" data-eclado-json-ld>${safeJson(schema)}</script>`).join('\n  ')}
  <script data-eclado-seo-shell>document.documentElement.classList.add('js')</script>
  <style data-eclado-seo-shell>.js .seo-shell{display:none}.seo-shell{max-width:1120px;margin:0 auto;padding:110px 24px 72px;font-family:Arial,"Noto Sans TC",sans-serif;color:#202020}.seo-shell nav{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:32px}.seo-shell a{color:#041384}.seo-shell h1{font-size:clamp(32px,6vw,64px);font-weight:400;line-height:1.2}.seo-shell h2{margin-top:38px}.seo-shell p,.seo-shell li{line-height:1.85}.seo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px}.seo-card{border:1px solid #e6e6e6;padding:20px}.seo-card img,.seo-hero{width:100%;height:auto;max-height:560px;object-fit:contain}.seo-breadcrumb{font-size:13px}.seo-price{font-size:24px}.seo-muted{color:#666}.seo-skip{position:absolute;left:-9999px}</style>
  <!--seo-head-end-->`;
}

function siteNavigation() {
  return `<nav aria-label="主要導覽"><a href="/">首頁</a><a href="/shop">全部商品</a><a href="/journal">保養專欄</a><a href="/about">品牌故事</a><a href="/info">購物說明</a><a href="/contact">聯絡我們</a></nav>`;
}

function breadcrumb(items) {
  return `<nav class="seo-breadcrumb" aria-label="麵包屑">${items.map((item, index) => `${index ? '<span aria-hidden="true">›</span>' : ''}<a href="${escapeHtml(item.path)}">${escapeHtml(item.name)}</a>`).join('')}</nav>`;
}

function breadcrumbSchema(items) {
  return {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({ '@type': 'ListItem', position: index + 1, name: item.name, item: absoluteUrl(item.path) })),
  };
}

function renderProductBody(product) {
  const slug = String(product.slug || '').trim();
  const path = `/products/${encodeURIComponent(slug)}`;
  const nameZh = product.name_zh || product.nameZh || '';
  const name = product.name || '';
  const description = product.description || product.desc || product.subtitle || '';
  const image = product.image_url || product.img || product.image_urls?.[0] || '';
  const features = Array.isArray(product.features) ? product.features : [];
  const price = Number(product.price || 0);
  const items = [{ name: '首頁', path: '/' }, { name: '全部商品', path: '/shop' }, { name: nameZh, path }];
  return `<main class="seo-shell">${breadcrumb(items)}<article>
    ${image ? `<img class="seo-hero" src="${escapeHtml(image)}" alt="${escapeHtml(nameZh)}">` : ''}
    <p class="seo-muted">${escapeHtml([product.category, product.series].filter(Boolean).join('｜'))}</p>
    <h1>${escapeHtml(nameZh)}</h1><p>${escapeHtml(name)}${product.size ? ` · ${escapeHtml(product.size)}` : ''}</p>
    ${price ? `<p class="seo-price">NT$ ${price.toLocaleString('en-US')}</p>` : ''}
    <h2>商品描述</h2>${String(description).split(/\n+/).filter(Boolean).map(text => `<p>${escapeHtml(text)}</p>`).join('')}
    ${features.length ? `<h2>商品特色</h2><ul>${features.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
    ${product.ingredients ? `<h2>主要成分</h2><p>${escapeHtml(product.ingredients)}</p>` : ''}
    ${product.skin_type || product.skinType ? `<h2>適合膚質</h2><p>${escapeHtml(product.skin_type || product.skinType)}</p>` : ''}
    <p><a href="/shop">瀏覽全部商品</a></p>
  </article></main>`;
}

function productSeo(product) {
  const slug = String(product.slug || '').trim();
  const path = `/products/${encodeURIComponent(slug)}`;
  const nameZh = product.name_zh || product.nameZh || '';
  const description = product.description || product.desc || product.subtitle || `選購 ${nameZh}，查看產品特色、規格與專業保養資訊。`;
  const image = product.image_url || product.img || product.image_urls?.[0] || '/assets/images/shop-hero-cleansing-wide.png';
  const activeVariants = Array.isArray(product.variants)
    ? product.variants.filter(variant => variant.active !== false)
    : [];
  const primaryVariant = activeVariants.find(variant => variant.is_default || variant.isDefault)
    || activeVariants[0]
    || null;
  const price = Number(primaryVariant?.price || product.price || 0);
  const stock = primaryVariant?.stock ?? product.stock;
  const items = [{ name: '首頁', path: '/' }, { name: '全部商品', path: '/shop' }, { name: nameZh, path }];
  return {
    title: `${nameZh}｜ECLADO`, description: String(description).replace(/\s+/g, ' ').slice(0, 155), path, image, type: 'product',
    jsonLd: [{
      '@context': 'https://schema.org', '@type': 'Product', name: nameZh,
      alternateName: product.name || undefined, description, image: product.image_urls?.length ? product.image_urls : [image],
      sku: primaryVariant?.sku || product.sku || undefined, brand: { '@type': 'Brand', name: 'ECLADO' },
      ...(price > 0 ? {
        offers: { '@type': 'Offer', url: absoluteUrl(path), priceCurrency: 'TWD', price, availability: Number(stock) > 0 ? 'https://schema.org/InStock' : 'https://schema.org/PreOrder' },
      } : {}),
    }, breadcrumbSchema(items)],
  };
}

function injectSeoDocument(template, seo, body) {
  let html = template
    .replace(/<!--seo-head-start-->[\s\S]*?<!--seo-head-end-->/g, '')
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(seo.title)}</title>`);
  html = html.replace('</head>', `${pageHead(seo)}\n</head>`);
  const wrappedBody = `<!--seo-body-start-->${body}<!--seo-body-end-->`;
  if (/<!--seo-body-start-->[\s\S]*?<!--seo-body-end-->/.test(html)) {
    return html.replace(/<!--seo-body-start-->[\s\S]*?<!--seo-body-end-->/, wrappedBody);
  }
  return html.replace('<div id="root"></div>', `<div id="root">${wrappedBody}</div>`);
}

async function fetchStorefrontCatalog() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY;
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/get_storefront_catalog`, {
    method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' }, body: '{}',
  });
  if (!response.ok) throw new Error(`Storefront catalog HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload?.products)) throw new Error('Invalid storefront catalog');
  const variants = Array.isArray(payload.variants) ? payload.variants : [];
  return payload.products
    .filter(product => product.publication_status !== 'event_only')
    .map(product => ({
      ...product,
      variants: variants.filter(variant => Number(variant.product_id) === Number(product.id)),
    }));
}

module.exports = {
  LEGACY_PRODUCT_SLUGS, SITE_ORIGIN, absoluteUrl, breadcrumb, breadcrumbSchema, escapeHtml,
  fetchStorefrontCatalog, injectSeoDocument, pageHead, productSeo, renderProductBody, safeJson, siteNavigation,
};
