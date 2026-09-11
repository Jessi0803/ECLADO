import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const {
  SITE_ORIGIN, absoluteUrl, breadcrumb, breadcrumbSchema, escapeHtml,
  fetchStorefrontCatalog, injectSeoDocument, productSeo, renderProductBody, siteNavigation,
} = require('../api/_seo.js');

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const template = await fs.readFile(path.join(distDir, 'index.html'), 'utf8');
const vite = await createServer({ root: rootDir, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
const { JOURNAL_ARTICLES, JOURNAL_DISCLAIMER } = await vite.ssrLoadModule('/src/data/journalArticles.js');
await vite.close();

const CATEGORY_SLUGS = {
  '清潔卸妝': 'cleansing', '化妝水': 'toner', '安瓶精華': 'ampoule-serum', '乳霜': 'cream',
  '面膜': 'mask', '防曬底妝': 'sun-makeup', '其他': 'other', '院線課程儀器（含試用包）': 'professional',
};
const SERIES_SLUGS = {
  '清潔': 'cleansing', '微囊精萃': 'micro-essence', '院線組合': 'professional-kits', 'Air jet': 'air-jet',
  '急救安瓶': 'rescuer', '面膜': 'mask', Deep: 'deep', Extra: 'extra', Cell: 'cell', AC: 'ac',
  SOS: 'respiration', '試用包': 'trial', Special: 'special',
};

function outputFile(route) {
  return route === '/' ? path.join(distDir, 'index.html') : path.join(distDir, `${route.replace(/^\//, '')}.html`);
}

async function writeRoute(route, seo, body) {
  const file = outputFile(route);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, injectSeoDocument(template, seo, body));
}

function isProfessionalProduct(product) {
  return product.is_pro_only || /院線|課程|儀器|試用包/.test(String(product.category || ''));
}

function productInCategory(product, category) {
  const value = String(product.category || '');
  const professional = isProfessionalProduct(product);
  if (category === '院線課程儀器（含試用包）') return professional;
  if (professional) return false;
  if (category === '清潔卸妝') return /清潔|卸妝/.test(value);
  if (category === '化妝水') return /化妝水/.test(value);
  if (category === '安瓶精華') return /安瓶|精華/.test(value);
  if (category === '乳霜') return /乳霜|面霜|眼霜/.test(value);
  if (category === '面膜') return /面膜/.test(value);
  if (category === '防曬底妝') return /防曬|底妝/.test(value);
  return category === '其他' && value === '其他';
}

function productCards(products) {
  return `<div class="seo-grid">${products.map(product => {
    const href = `/products/${encodeURIComponent(product.slug)}`;
    const image = product.image_url || product.image_urls?.[0] || '';
    return `<article class="seo-card">${image ? `<a href="${href}"><img src="${escapeHtml(image)}" alt="${escapeHtml(product.name_zh)}" loading="lazy"></a>` : ''}<h2><a href="${href}">${escapeHtml(product.name_zh)}</a></h2><p>${escapeHtml(product.name || '')}${product.size ? ` · ${escapeHtml(product.size)}` : ''}</p>${product.subtitle ? `<p>${escapeHtml(product.subtitle)}</p>` : ''}</article>`;
  }).join('')}</div>`;
}

function shopPage(title, route, products, intro) {
  const itemList = {
    '@context': 'https://schema.org', '@type': 'ItemList', name: title,
    itemListElement: products.map((product, index) => ({ '@type': 'ListItem', position: index + 1, name: product.name_zh, url: absoluteUrl(`/products/${product.slug}`) })),
  };
  return {
    seo: { title: `${title}｜ECLADO 韓國院線保養`, description: intro, path: route, image: '/assets/images/shop-hero-cleansing-wide.png', jsonLd: itemList },
    body: `<main class="seo-shell">${siteNavigation()}<h1>${escapeHtml(title)}</h1><p>${escapeHtml(intro)}</p>${productCards(products)}</main>`,
  };
}

function renderArticle(article) {
  return article.sections.map(section => `<section><h2>${escapeHtml(section.heading)}</h2>${section.paragraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('')}${section.table ? `<table><caption>${escapeHtml(section.table.caption || '')}</caption><thead><tr>${section.table.columns.map(column => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${section.table.rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>${section.table.note ? `<p>＊${escapeHtml(section.table.note)}</p>` : ''}` : ''}${section.figure ? `<figure><img class="seo-hero" src="${escapeHtml(section.figure.src)}" alt="${escapeHtml(section.figure.alt)}" loading="lazy"><figcaption>${escapeHtml(section.figure.caption || '')}</figcaption></figure>` : ''}${(section.notes || []).map(note => `<p>＊${escapeHtml(note)}</p>`).join('')}</section>`).join('');
}

const products = await fetchStorefrontCatalog();
if (!products.length) throw new Error('SEO prerender aborted: storefront catalog is empty');

const organization = { '@context': 'https://schema.org', '@type': 'Organization', name: 'ECLADO Taiwan', url: `${SITE_ORIGIN}/`, logo: `${SITE_ORIGIN}/assets/images/ECLADO%20LOGO%20with%20CI_BLUE.png` };
const website = { '@context': 'https://schema.org', '@type': 'WebSite', name: 'ECLADO Taiwan', url: `${SITE_ORIGIN}/` };
await writeRoute('/', {
  title: 'ECLADO Taiwan｜韓國專業院線保養',
  description: 'ECLADO 源自韓國專業皮膚管理領域，提供院線與居家保養產品、專業美容知識及完整肌膚照護選擇。',
  path: '/', image: '/assets/images/hero-cover.jpg', jsonLd: [organization, website],
}, `<main class="seo-shell">${siteNavigation()}<h1>從專業護理，到每日保養</h1><p>ECLADO 源自韓國專業皮膚管理領域，將產品研發、專業教育與美容現場經驗延伸為日常保養選擇。</p><h2>精選商品</h2>${productCards(products.slice(0, 8))}<h2>保養專欄</h2><div class="seo-grid">${JOURNAL_ARTICLES.slice(0, 6).map(article => `<article class="seo-card"><h3><a href="/journal/${article.slug}">${escapeHtml(article.title)}</a></h3><p>${escapeHtml(article.excerpt)}</p></article>`).join('')}</div></main>`);

const allShop = shopPage('全部商品', '/shop', products, '瀏覽 ECLADO 全部院線與居家保養商品，依功效與系列找到適合的保養選擇。');
await writeRoute('/shop', allShop.seo, allShop.body);
await writeRoute('/shop/series', ...Object.values(shopPage('所有系列', '/shop/series', products, '依 ECLADO 產品系列瀏覽專業保養商品。')));

for (const [category, slug] of Object.entries(CATEGORY_SLUGS)) {
  const route = `/shop/category/${slug}`;
  const page = shopPage(category, route, products.filter(product => productInCategory(product, category)), `瀏覽 ECLADO ${category}商品，查看產品特色、規格與專業保養資訊。`);
  await writeRoute(route, page.seo, page.body);
}
for (const [series, slug] of Object.entries(SERIES_SLUGS)) {
  const route = `/shop/series/${slug}`;
  const page = shopPage(`${series} 系列`, route, products.filter(product => String(product.series || '') === series), `瀏覽 ECLADO ${series} 系列商品與專業保養資訊。`);
  await writeRoute(route, page.seo, page.body);
}

for (const product of products) {
  if (!product.slug) throw new Error(`SEO prerender aborted: product ${product.id} has no slug`);
  const seo = productSeo(product);
  await writeRoute(decodeURIComponent(seo.path), seo, renderProductBody(product));
}

await writeRoute('/journal', {
  title: '保養專欄｜ECLADO', description: 'ECLADO 保養專欄，從成分、清潔、安瓶應用到院線級保養觀念，提供清楚而實用的專業保養知識。',
  path: '/journal', image: JOURNAL_ARTICLES[0]?.img,
}, `<main class="seo-shell">${siteNavigation()}<h1>保養專欄</h1><p>從膚況判斷、成分理解到院線保養邏輯，整理能實際帶回日常使用的專業保養觀點。</p><div class="seo-grid">${JOURNAL_ARTICLES.map(article => `<article class="seo-card"><h2><a href="/journal/${article.slug}">${escapeHtml(article.title)}</a></h2><p>${escapeHtml(article.excerpt)}</p></article>`).join('')}</div></main>`);

for (const article of JOURNAL_ARTICLES) {
  const route = `/journal/${article.slug}`;
  const crumbs = [{ name: '首頁', path: '/' }, { name: '保養專欄', path: '/journal' }, { name: article.title, path: route }];
  const articleSchema = { '@context': 'https://schema.org', '@type': 'Article', headline: article.title, description: article.seoDescription || article.excerpt, image: absoluteUrl(article.img), mainEntityOfPage: absoluteUrl(route), author: { '@type': 'Organization', name: 'ECLADO Taiwan' }, publisher: { '@type': 'Organization', name: 'ECLADO Taiwan' } };
  await writeRoute(route, {
    title: `${article.title}｜ECLADO 保養專欄`, description: article.seoDescription || article.excerpt,
    path: route, image: article.img, type: 'article', jsonLd: [articleSchema, breadcrumbSchema(crumbs)],
  }, `<main class="seo-shell">${breadcrumb(crumbs)}<article><p>${escapeHtml(article.category)}</p><h1>${escapeHtml(article.title)}</h1><p>${escapeHtml(article.excerpt)}</p><img class="seo-hero" src="${escapeHtml(article.img)}" alt="${escapeHtml(article.title)}">${renderArticle(article)}<aside><h2>閱讀提醒</h2><p>${escapeHtml(JOURNAL_DISCLAIMER)}</p></aside></article></main>`);
}

await writeRoute('/about', {
  title: '品牌故事｜ECLADO Taiwan', description: '認識 ECLADO 自 1998 年從韓國專業皮膚管理領域出發，以產品研發、專業教育與全球實務經驗建立的品牌故事。', path: '/about', image: '/assets/images/brand-story/brand-portrait.jpg',
}, `<main class="seo-shell">${siteNavigation()}<article><h1>品牌故事</h1><h2>從專業出發，讓日常綻放光采。</h2><p>ECLADO 源自韓國專業皮膚管理領域。自 1998 年起，以產品研發與教育為基礎，將美容現場累積的經驗，延伸為貼近生活的保養選擇。</p><h2>不只一件產品，更是完整的保養思考。</h2><p>每一張肌膚都有不同需要。ECLADO 重視產品之間的搭配，以及每一步保養的角色，串連院線產品、居家保養與專業教育。</p><h2>把研究放進保養的每個細節</h2><p>從配方設計到產品應用，品牌關注使用方式、膚感與保養需求之間的關係，持續回到實際使用的觀察與評估。</p><h2>從韓國走向世界</h2><p>以專業教育、產品研發與跨國交流累積信任，讓專業成為持續前行的力量。</p></article></main>`);

const informationalPages = [
  ['/info', '購物說明｜ECLADO Taiwan', '查看 ECLADO Taiwan 付款、運送、退換貨與常見問題等購物說明。', '購物說明', '<h2>退換貨說明</h2><p>未拆封商品依相關規定提供猶豫期；個人衛生用品拆封後不適用。商品瑕疵請聯絡客服協助。</p><h2>運送方式</h2><p>訂單依商品庫存與每週出貨排程安排配送。</p><h2>付款說明</h2><p>網站提供線上付款，實際可用方式以結帳頁顯示為準。</p>'],
  ['/contact', '聯絡我們｜ECLADO Taiwan', '聯絡 ECLADO Taiwan，洽詢產品、訂單、售後服務與合作需求。', '聯絡我們', '<p>產品諮詢、訂單問題、售後服務與合作需求，歡迎透過 LINE 官方帳號或電子郵件與我們聯繫。</p><p><a href="mailto:ecladotaiwan@gmail.com">ecladotaiwan@gmail.com</a></p><p><a href="https://lin.ee/5RLUjni">LINE 官方帳號</a></p>'],
  ['/privacy', '隱私權政策｜ECLADO Taiwan', 'ECLADO Taiwan 隱私權政策，說明個人資料蒐集、使用、保存及使用者權利。', '隱私權政策', '<p>本政策說明 ECLADO Taiwan 蒐集個人資料的目的、使用方式、第三方服務、保存期限、安全措施及使用者依法享有的權利。</p><h2>資料使用與保護</h2><p>資料僅於會員、訂單、配送、付款、服務通知及法令要求的必要範圍內使用，並採取存取控制與加密傳輸等保護措施。</p>'],
];
for (const [route, title, description, heading, content] of informationalPages) {
  await writeRoute(route, { title, description, path: route }, `<main class="seo-shell">${siteNavigation()}<h1>${heading}</h1>${content}</main>`);
}

const privateRoutes = ['/cart', '/checkout', '/login', '/pro-login', '/reset-password', '/professional-apply', '/account', '/line-callback', '/payment-result', '/order-lookup', '/events/limited'];
for (const route of privateRoutes) {
  await writeRoute(route, { title: 'ECLADO Taiwan', description: 'ECLADO Taiwan 會員與購物服務。', path: route, robots: 'noindex,nofollow' }, `<main class="seo-shell"><h1>ECLADO Taiwan</h1><p>此頁面需要啟用 JavaScript 才能使用。</p></main>`);
}

await fs.writeFile(path.join(distDir, '404.html'), injectSeoDocument(template, {
  title: '找不到頁面｜ECLADO Taiwan', description: '您開啟的頁面不存在。', path: '/404', robots: 'noindex,nofollow',
}, `<main class="seo-shell">${siteNavigation()}<h1>找不到此頁面</h1><p>網址可能已變更，請返回首頁或瀏覽全部商品。</p></main>`));

console.log(`SEO prerender complete: ${products.length} products, ${JOURNAL_ARTICLES.length} articles`);
