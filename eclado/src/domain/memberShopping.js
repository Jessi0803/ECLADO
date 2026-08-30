import { getMemberRole } from './catalog.jsx';

export const PROFESSIONAL_ORDER_MINIMUM = 5000;
export const PROFESSIONAL_FREE_SHIPPING_THRESHOLD = 15000;
export const PROFESSIONAL_ORDER_ROLES = new Set(['pro', 'instructor', 'distributor']);

export function hasProfessionalOrderRules(user) {
  return PROFESSIONAL_ORDER_ROLES.has(getMemberRole(user));
}

export function getProfessionalOrderProgress(amount, user) {
  if (!hasProfessionalOrderRules(user)) return null;
  const merchandiseAmount = Math.max(0, Number(amount) || 0);
  if (merchandiseAmount < PROFESSIONAL_ORDER_MINIMUM) {
    return {
      eligible: false,
      freeShipping: false,
      remaining: PROFESSIONAL_ORDER_MINIMUM - merchandiseAmount,
      message: `尚差 NT$${(PROFESSIONAL_ORDER_MINIMUM - merchandiseAmount).toLocaleString()} 可達最低訂購門檻。`,
    };
  }
  if (merchandiseAmount < PROFESSIONAL_FREE_SHIPPING_THRESHOLD) {
    return {
      eligible: true,
      freeShipping: false,
      remaining: PROFESSIONAL_FREE_SHIPPING_THRESHOLD - merchandiseAmount,
      message: `再消費 NT$${(PROFESSIONAL_FREE_SHIPPING_THRESHOLD - merchandiseAmount).toLocaleString()} 即享免運`,
    };
  }
  return {
    eligible: true,
    freeShipping: true,
    remaining: 0,
    message: '✓ 已享免運優惠。',
  };
}

export function getProfessionalShoppingNotice(user) {
  if (!hasProfessionalOrderRules(user)) return null;
  const labels = {
    pro: '美容師',
    instructor: '師資',
    distributor: '經銷商',
  };
  return {
    label: labels[getMemberRole(user)] || '專業會員',
    minimum: PROFESSIONAL_ORDER_MINIMUM,
    freeShippingThreshold: PROFESSIONAL_FREE_SHIPPING_THRESHOLD,
  };
}
