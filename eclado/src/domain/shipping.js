import { getProfessionalOrderProgress } from './memberShopping.js';

export const STANDARD_SHIPPING_FEE = 120;
export const FREE_SHIPPING_PRODUCT_ID = 9;
export const SF_EXPRESS_TRACKING_URL = 'https://htm.sf-express.com/tw/tc/';
export const FULFILLMENT_DELIVERY = 'delivery';
export const FULFILLMENT_ONSITE_PICKUP = 'onsite_pickup';

export function areAllCustomOrderItems(items) {
  return Array.isArray(items) && items.length > 0
    && items.every(item => (item.isCustomOrder ?? item.is_custom_order) === true);
}

// Frontend preview only. The database RPC remains authoritative at checkout.
export function calculateShipping(items, user, merchandiseAmount = 0, fulfillmentMethod = FULFILLMENT_DELIVERY) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  if (fulfillmentMethod === FULFILLMENT_ONSITE_PICKUP) return 0;
  if (getProfessionalOrderProgress(merchandiseAmount, user)?.freeShipping) return 0;
  return items.every(item => Number(item.id ?? item.product_id) === FREE_SHIPPING_PRODUCT_ID)
    ? 0
    : STANDARD_SHIPPING_FEE;
}
