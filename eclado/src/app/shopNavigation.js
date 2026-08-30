import { PRODUCT_NAV_LINKS, PRODUCT_SERIES_LINKS } from './navigation.js';

export const SHOP_CATEGORY_EVENT = 'eclado-shop-category-change';

export function shopFilterFromLocation() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view') === 'series' ? 'series' : 'category';
  if (view === 'series') {
    const rawSeries = params.get('series');
    const requested = rawSeries === '呼吸系列' ? '呼吸' : rawSeries;
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
    return value && value !== '所有系列'
      ? `/shop?view=series&series=${encodeURIComponent(value)}`
      : '/shop?view=series';
  }
  return value && value !== '所有產品'
    ? `/shop?view=category&category=${encodeURIComponent(value)}`
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
