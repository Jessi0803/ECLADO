// ─── HISTORY / ROUTING ────────────────────────────────────────────────────────
export const PAGE_PATHS = {
  home: '/', shop: '/shop', cart: '/cart', checkout: '/checkout',
  login: '/login', 'pro-login': '/pro-login', 'reset-password': '/reset-password',
  'professional-apply': '/professional-apply', account: '/account', about: '/about', info: '/info',
  journal: '/journal',
  'line-callback': '/line-callback', 'payment-result': '/payment-result', 'order-lookup': '/order-lookup', privacy: '/privacy', contact: '/contact',
};
const PATH_PAGES = Object.fromEntries(Object.entries(PAGE_PATHS).map(([k, v]) => [v, k]));
export function pageFromPath(path) {
  const p = path.replace(/\/$/, '') || '/';
  if (p === '/pro-login') return 'login';
  if (/^\/products\/[^/]+$/.test(p)) return 'product';
  if (/^\/journal\/[^/]+$/.test(p)) return 'journal-article';
  return PATH_PAGES[p] || 'home';
}

export function journalSlugFromPath(path) {
  const match = String(path || '').replace(/\/$/, '').match(/^\/journal\/([^/]+)$/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]).toLowerCase();
  } catch {
    return '';
  }
}

export function getProductSlug(productOrName) {
  if (productOrName && typeof productOrName === 'object') {
    const fixedSlug = String(productOrName.slug || '').trim();
    if (fixedSlug) return fixedSlug;
  }
  const name = productOrName && typeof productOrName === 'object'
    ? (productOrName.name || productOrName.nameZh)
    : productOrName;
  return String(name || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function productSlugFromPath(path) {
  const match = String(path || '').replace(/\/$/, '').match(/^\/products\/([^/]+)$/);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]).toLowerCase();
  } catch {
    return '';
  }
}
