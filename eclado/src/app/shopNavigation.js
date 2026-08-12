import { PRODUCT_NAV_LINKS } from './navigation.js';

export const SHOP_CATEGORY_EVENT = 'eclado-shop-category-change';

export function categoryFromLocation() {
  const requested = new URLSearchParams(window.location.search).get('category');
  return PRODUCT_NAV_LINKS.includes(requested) ? requested : '所有產品';
}

export function shopPath(category) {
  return category && category !== '所有產品'
    ? `/shop?category=${encodeURIComponent(category)}`
    : '/shop';
}

export function goShopCategory(category, setPage) {
  const nextCategory = PRODUCT_NAV_LINKS.includes(category) ? category : '所有產品';
  setPage('shop');
  window.history.replaceState({ page: 'shop', category: nextCategory }, '', shopPath(nextCategory));
  window.dispatchEvent(new CustomEvent(SHOP_CATEGORY_EVENT, { detail: nextCategory }));
}
