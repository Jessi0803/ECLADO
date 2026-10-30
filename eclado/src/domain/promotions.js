import { getMemberPrice, getMemberRole } from './catalog.jsx';

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

export function promotionAllowsUser(p, user) {
  // Rows created before audience targeting remain available to all identities.
  if (!user) return p?.allow_guest ?? true;
  const role = getMemberRole(user);
  const effectiveRole = ['consumer', 'pro', 'instructor', 'distributor', 'staff'].includes(role) ? role : 'consumer';
  return p?.audience_roles == null || p.audience_roles.includes(effectiveRole);
}

export function isPromotionLive(p, user) {
  const now = Date.now();
  const rate = Number(p?.discount_rate);
  const amount = Number(p?.discount_amount);
  if (p?.active === false || p?.archived_at || !promotionAllowsUser(p, user)) return false;
  if (String(p?.activation_type || 'automatic') !== 'automatic') return false;
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) return false;
  if (!Number.isFinite(amount) || amount < 0) return false;
  if (normProductIds(p).length === 0) return false;
  if (p?.start_at && new Date(p.start_at).getTime() > now) return false;
  if (p?.end_at && new Date(p.end_at).getTime() <= now) return false;
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
  const candidates = promotions
    .filter(p => isPromotionLive(p, user))
    .map(p => {
      const ids = new Set(normProductIds(p));
      const promoItems = cart.filter(i => ids.has(Number(i.id)));
      // Mutual exclusion needs the server's quantity allocation and thresholds.
      // Keep the student baseline until the authoritative quote arrives.
      if (p.allow_student_price_stacking === false && promoItems.some(item => getMemberRole(user) === 'pro'
        && user?.uid && item.studentPriceUserId === user.uid)) return null;
      const promoSubtotal = promoItems.reduce((s, i) => s + unit(i) * i.qty, 0);
      const rate = Number(p.discount_rate);
      const amount = Number(p.discount_amount);
      if (
        promoSubtotal <= 0
        || !Number.isFinite(rate) || rate < 0 || rate > 1
        || !Number.isFinite(amount) || amount < 0
      ) return null;
      const afterPromo = applyPromotionFormula(
        promoSubtotal,
        rate,
        amount,
        getPromotionDiscountOrder(p),
      );
      return { promotion: p, discount: Math.round(promoSubtotal - afterPromo) };
    })
    .filter(candidate => candidate?.discount > 0)
    .sort((a, b) => {
      if (b.discount !== a.discount) return b.discount - a.discount;
      const createdDiff = new Date(a.promotion.created_at || 0) - new Date(b.promotion.created_at || 0);
      if (createdDiff !== 0) return createdDiff;
      return String(a.promotion.id || '').localeCompare(String(b.promotion.id || ''));
    });
  const best = candidates[0];
  if (!best) return { subtotal, discount: 0, finalSubtotal: subtotal, promotion: null };
  return {
    subtotal,
    discount: Math.min(best.discount, subtotal),
    finalSubtotal: Math.max(0, subtotal - best.discount),
    promotion: best.promotion,
  };
}

// 計算單一商品的活動顯示價（回傳 { price, label, promo } 或 null）
export function getPromoDisplayPrice(product, user, promotions) {
  const basePrice = getMemberPrice(product, user);
  const candidates = (promotions || [])
    .filter(p => isPromotionLive(p, user) && normProductIds(p).includes(Number(product.id)))
    .filter(p => !(p.allow_student_price_stacking === false && getMemberRole(user) === 'pro'
      && user?.uid && product.studentPriceUserId === user.uid))
    .map(p => {
      const rate = Number(p.discount_rate);
      const amount = Number(p.discount_amount);
      if (
        !Number.isFinite(rate) || rate < 0 || rate > 1
        || !Number.isFinite(amount) || amount < 0
      ) return null;
      const price = Math.round(applyPromotionFormula(basePrice, rate, amount, getPromotionDiscountOrder(p)));
      return price < basePrice ? { p, price, rate, amount } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.price - b.price);
  if (!candidates.length) return null;
  const { p, price: discounted, rate, amount } = candidates[0];
  const parts = [];
  if (rate < 1) parts.push(`${Math.round(rate * 10)}折`);
  if (amount > 0) parts.push(`−NT$ ${amount.toLocaleString()}`);
  return { price: discounted, label: parts.join(' + '), promo: p };
}

// Storefront copy is independent of pricing: gift/threshold promotions also apply.
export const DEFAULT_PROMOTION_LABEL_COLOR = '#C94A3F';

export function getPromotionLabelColor(color) {
  return /^#[0-9a-f]{6}$/i.test(color || '') ? color : DEFAULT_PROMOTION_LABEL_COLOR;
}

export function getPromotionLabelTextColor(color) {
  const hex = getPromotionLabelColor(color).slice(1);
  const channels = [0, 2, 4].map(offset => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return luminance > 0.179 ? '#111111' : '#FFFFFF';
}

export function getProductDisplayPromotions(product, user, promotions = []) {
  const now = Date.now();
  return promotions.filter(p => {
    const specifiedProducts = p.storefront_scope_type === 'products'
      || (p.storefront_scope_type == null && (!p.benefit_type || p.benefit_type === 'legacy_discount'));
    if (!specifiedProducts || !normProductIds(p).includes(Number(product.id))) return false;
    if (p.active === false || p.archived_at || !promotionAllowsUser(p, user)) return false;
    if ((p.activation_type || 'automatic') !== 'automatic') return false;
    if (p.start_at && !(new Date(p.start_at).getTime() <= now)) return false;
    if (p.end_at && !(new Date(p.end_at).getTime() > now)) return false;
    return true;
  });
}
