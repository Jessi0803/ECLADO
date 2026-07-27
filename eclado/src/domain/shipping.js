export const STANDARD_SHIPPING_FEE = 120;
export const FREE_SHIPPING_PRODUCT_ID = 9;

// Frontend preview only. The database RPC remains authoritative at checkout.
export function calculateShipping(items) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  return items.every(item => Number(item.id ?? item.product_id) === FREE_SHIPPING_PRODUCT_ID)
    ? 0
    : STANDARD_SHIPPING_FEE;
}
