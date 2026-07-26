import { getMemberPrice } from './catalog.jsx';

export function normProductIds(p) {
  const raw = p?.product_ids;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(x => Number(x)).filter(n => !Number.isNaN(n));
  if (typeof raw === 'string') {
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.map(x => Number(x)).filter(n => !Number.isNaN(n)) : [];
    } catch { return []; }
  }
  return [];
}

export function isPromotionLive(p) {
  const now = Date.now();
  if (p?.start_at && new Date(p.start_at).getTime() > now) return false;
  if (p?.end_at && new Date(p.end_at).getTime() < now) return false;
  return true;
}

export function getPromotionDiscountOrder(p) {
  return p?.discount_order === 'amount_then_rate' ? 'amount_then_rate' : 'rate_then_amount';
}

export function applyPromotionFormula(base, rate, amount, order) {
  const subtotal = Math.max(0, Number(base) || 0);
  const discountRate = Number(rate) || 1;
  const discountAmount = Math.max(0, Number(amount) || 0);
  if (order === 'amount_then_rate') {
    return Math.max(0, (subtotal - discountAmount) * discountRate);
  }
  return Math.max(0, subtotal * discountRate - discountAmount);
}

// 用購物車與目前生效的活動，回傳折扣計算結果
export function calculateDiscount(cart, promotions, user) {
  const unit = item => getMemberPrice(item, user);
  const subtotal = cart.reduce((s, i) => s + unit(i) * i.qty, 0);

  if (!Array.isArray(promotions) || promotions.length === 0) {
    return { subtotal, discount: 0, finalSubtotal: subtotal, promotion: null };
  }
  const live = promotions.filter(p => isPromotionLive(p));
  for (const p of live) {
    const ids = new Set(normProductIds(p));
    const promoItems = cart.filter(i => ids.has(Number(i.id)));
    if (promoItems.length === 0) continue;
    const promoSubtotal = promoItems.reduce((s, i) => s + unit(i) * i.qty, 0);
    const rate = Number(p.discount_rate) || 1;
    const amount = Number(p.discount_amount) || 0;
    const afterPromo = applyPromotionFormula(promoSubtotal, rate, amount, getPromotionDiscountOrder(p));
    const discount = Math.round(promoSubtotal - afterPromo);
    return { subtotal, discount, finalSubtotal: subtotal - discount, promotion: p };
  }
  return { subtotal, discount: 0, finalSubtotal: subtotal, promotion: null };
}

// 計算單一商品的活動顯示價（回傳 { price, label, promo } 或 null）
export function getPromoDisplayPrice(product, user, promotions) {
  const basePrice = getMemberPrice(product, user);
  const live = (promotions || []).filter(p => isPromotionLive(p) && normProductIds(p).includes(Number(product.id)));
  if (!live.length) return null;
  const p = live[0];
  const rate = Number(p.discount_rate) || 1;
  const amount = Number(p.discount_amount) || 0;
  const discounted = Math.round(applyPromotionFormula(basePrice, rate, amount, getPromotionDiscountOrder(p)));
  if (discounted >= basePrice) return null;
  const parts = [];
  if (rate < 1) parts.push(`${Math.round(rate * 10)}折`);
  if (amount > 0) parts.push(`−NT$ ${amount.toLocaleString()}`);
  return { price: discounted, label: parts.join(' + '), promo: p };
}
