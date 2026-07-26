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
  return PATH_PAGES[p] || 'home';
}
