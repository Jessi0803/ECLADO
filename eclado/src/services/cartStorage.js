export const CART_STORAGE_KEY = 'eclado_cart_v1';
const MAX_CART_QUANTITY = 99;

function normalizeQuantity(value) {
  const quantity = Math.floor(Number(value));
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.min(quantity, MAX_CART_QUANTITY);
}

// Persist identifiers only. Prices and eligibility always come from the catalog.
export function cartItems(cart) {
  return (Array.isArray(cart) ? cart : []).map(item => ({
    id: Number(item.id),
    variantId: String(item.variantId || item.variantSize || ''),
    qty: normalizeQuantity(item.qty),
    ...(item.recommendationOnly === true ? { recommendationOnly: true } : {}),
  })).filter(item => Number.isSafeInteger(item.id) && item.id > 0 && item.qty > 0);
}

export const cartItemKey = item => `${item.id}:${item.variantId || ''}`;

export function removePurchasedItems(current, purchased) {
  const quantities = new Map(cartItems(purchased).map(item => [cartItemKey(item), item.qty]));
  return current.map(item => ({ ...item,
    qty: item.qty - (quantities.get(cartItemKey({ ...item, variantId: String(item.variantId || item.variantSize || '') })) || 0),
  })).filter(item => item.qty > 0);
}

export function loadStoredCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];

    const merged = new Map();
    parsed.forEach(item => {
      const id = Number(item?.id);
      const variantId = String(item?.variantId || '');
      const qty = normalizeQuantity(item?.qty);
      if (!Number.isInteger(id) || id <= 0 || qty <= 0) return;
      const cartKey = `${id}:${variantId}`;
      const previous = merged.get(cartKey);
      merged.set(cartKey, {
        id,
        variantId,
        cartKey,
        qty: Math.min((previous?.qty || 0) + qty, MAX_CART_QUANTITY),
        ...(item.recommendationOnly === true && (!previous || previous.recommendationOnly === true) ? { recommendationOnly: true } : {}),
      });
    });

    return [...merged.values()];
  } catch {
    return [];
  }
}

export function saveStoredCart(cart) {
  try {
    const items = (Array.isArray(cart) ? cart : []).map(item => ({
      id: Number(item.id),
      variantId: String(item.variantId || item.variantSize || ''),
      qty: normalizeQuantity(item.qty),
      ...(item.recommendationOnly === true ? { recommendationOnly: true } : {}),
    })).filter(item => Number.isInteger(item.id) && item.id > 0 && item.qty > 0);

    if (items.length === 0) {
      localStorage.removeItem(CART_STORAGE_KEY);
      return;
    }
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Storage can be unavailable in private browsing or restricted WebViews.
  }
}

