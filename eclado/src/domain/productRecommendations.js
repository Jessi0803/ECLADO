import { CLEANSING_PRODUCTS, PROFESSIONAL_RECOMMENDATIONS } from '../config/productRecommendations.js';
import { getProductSlug } from '../app/routes.js';
import { canAccessProfessionalCatalog, getCartKey, getProductVariants } from './catalog.jsx';

export function isRecommendationProductAvailable(product, user) {
  if (!product || product.active === false) return false;
  if (product.publicationStatus && product.publicationStatus !== 'active') return false;
  if (product.isProOnly && !canAccessProfessionalCatalog(user)) return false;
  // Zero stock follows the existing preorder policy; inactive variants do not.
  if (product.variants?.length && !getProductVariants(product).some(variant => variant.active)) return false;
  return true;
}

export function getProductRecommendations({ sources, products, user }) {
  const catalog = new Map(products.map(product => [getProductSlug(product), product]));
  const groups = sources.flatMap(source => {
    if (!isRecommendationProductAvailable(source, user) || source.recommendationOnly) return [];
    const slug = getProductSlug(source);
    if (CLEANSING_PRODUCTS.includes(slug)) {
      return CLEANSING_PRODUCTS.filter(target => target !== slug)
        .map(slug => ({ key: slug, label: '清潔搭配', products: [slug] }));
    }
    return PROFESSIONAL_RECOMMENDATIONS[slug] || [];
  });
  const seen = new Set();
  return groups.flatMap(group => {
    // Recommendations stay visible after purchase, including alternative ampoules.
    const options = group.products.filter(slug => !seen.has(slug))
      .map(slug => catalog.get(slug))
      .filter(product => isRecommendationProductAvailable(product, user));
    options.forEach(product => seen.add(getProductSlug(product)));
    return options.length ? [{ ...group, options }] : [];
  });
}

export function addRecommendationToCart(cart, product) {
  const cartKey = getCartKey(product);
  if (cart.some(item => getCartKey(item) === cartKey)) {
    return cart.map(item => getCartKey(item) === cartKey
      ? { ...item, qty: Math.min(99, item.qty + 1) } : item);
  }
  return [...cart, { ...product, cartKey, qty: 1, recommendationOnly: true }];
}
