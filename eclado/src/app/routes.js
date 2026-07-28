// ─── HISTORY / ROUTING ────────────────────────────────────────────────────────
export const PAGE_PATHS = {
  home: '/', shop: '/shop', cart: '/cart', checkout: '/checkout',
  login: '/login', 'pro-login': '/pro-login', 'reset-password': '/reset-password',
  'professional-apply': '/professional-apply', account: '/account', about: '/about', info: '/info',
  'line-callback': '/line-callback', privacy: '/privacy', contact: '/contact',
};
const PATH_PAGES = Object.fromEntries(Object.entries(PAGE_PATHS).map(([k, v]) => [v, k]));
export function pageFromPath(path) {
  const p = path.replace(/\/$/, '') || '/';
  if (p === '/pro-login') return 'login';
  if (/^\/products\/[^/]+$/.test(p)) return 'product';
  return PATH_PAGES[p] || 'home';
}

export function getProductSlug(name) {
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
