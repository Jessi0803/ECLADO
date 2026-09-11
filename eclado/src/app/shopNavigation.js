import { PRODUCT_NAV_LINKS, PRODUCT_SERIES_LINKS } from './navigation.js';

export const SHOP_CATEGORY_EVENT = 'eclado-shop-category-change';

export const SHOP_CATEGORY_SLUGS = {
  '清潔卸妝': 'cleansing',
  '化妝水': 'toner',
  '安瓶精華': 'ampoule-serum',
  '乳霜': 'cream',
  '面膜': 'mask',
  '防曬底妝': 'sun-makeup',
  '其他': 'other',
  '院線課程儀器（含試用包）': 'professional',
};

export const SHOP_SERIES_SLUGS = {
  '清潔': 'cleansing',
  '微囊精萃': 'micro-essence',
  '院線組合': 'professional-kits',
  'Air jet': 'air-jet',
  '急救安瓶': 'rescuer',
  '面膜': 'mask',
  'Deep': 'deep',
  'Extra': 'extra',
  'Cell': 'cell',
  'AC': 'ac',
  'SOS': 'respiration',
  '試用包': 'trial',
  'Special': 'special',
};

function valueFromSlug(slugMap, slug, fallback) {
  return Object.entries(slugMap).find(([, candidate]) => candidate === slug)?.[0] || fallback;
}

export function shopFilterFromLocation() {
  const pathMatch = window.location.pathname.replace(/\/$/, '').match(/^\/shop\/(category|series)(?:\/([^/]+))?$/);
  if (pathMatch) {
    const view = pathMatch[1];
    const slug = String(pathMatch[2] || '').toLowerCase();
    return view === 'series'
      ? { view, value: valueFromSlug(SHOP_SERIES_SLUGS, slug, '所有系列') }
      : { view, value: valueFromSlug(SHOP_CATEGORY_SLUGS, slug, '所有產品') };
  }
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view') === 'series' ? 'series' : 'category';
  if (view === 'series') {
    const rawSeries = params.get('series');
    const requested = rawSeries === '呼吸系列' || rawSeries === '呼吸' ? 'SOS' : rawSeries;
    return { view, value: PRODUCT_SERIES_LINKS.includes(requested) ? requested : '所有系列' };
  }
  const requested = params.get('category');
  return { view, value: PRODUCT_NAV_LINKS.includes(requested) ? requested : '所有產品' };
}

export function categoryFromLocation() {
  const filter = shopFilterFromLocation();
  return filter.view === 'category' ? filter.value : '所有產品';
}

export function shopPath(view = 'category', value = '') {
  if (view === 'series') {
    return value && value !== '所有系列' && SHOP_SERIES_SLUGS[value]
      ? `/shop/series/${SHOP_SERIES_SLUGS[value]}`
      : '/shop/series';
  }
  return value && value !== '所有產品' && SHOP_CATEGORY_SLUGS[value]
    ? `/shop/category/${SHOP_CATEGORY_SLUGS[value]}`
    : '/shop';
}

export function goShopFilter(view, value, setPage) {
  const nextView = view === 'series' ? 'series' : 'category';
  const allowed = nextView === 'series' ? PRODUCT_SERIES_LINKS : PRODUCT_NAV_LINKS;
  const fallback = nextView === 'series' ? '所有系列' : '所有產品';
  const nextValue = allowed.includes(value) ? value : fallback;
  setPage('shop');
  window.history.replaceState({ page: 'shop', view: nextView, value: nextValue }, '', shopPath(nextView, nextValue));
  window.dispatchEvent(new CustomEvent(SHOP_CATEGORY_EVENT, { detail: { view: nextView, value: nextValue } }));
}

export function goShopCategory(category, setPage) {
  goShopFilter('category', category, setPage);
}

export function goShopSeries(series, setPage) {
  goShopFilter('series', series, setPage);
}
