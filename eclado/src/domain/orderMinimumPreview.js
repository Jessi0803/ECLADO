// A rejected quote may include a display-only preview. It is never a valid
// checkout quote and must not be passed as an expected order/payment quote.
const adjustmentTypes = new Set(['legacy_discount', 'percentage_discount', 'fixed_discount', 'buy_x_get_y', 'student_price_restoration']);

export function isOrderMinimumRejection(error) {
  return error?.code === '22023' && error.message === '專業會員單筆訂單最低金額為 NT$ 5,000';
}

export function getOrderMinimumPreview(error) {
  if (error?.code !== '22023' || typeof error.details !== 'string') return null;
  let data;
  try { data = JSON.parse(error.details); } catch { return null; }
  if (data?.kind !== 'cart_minimum_preview' || data.version !== 1) return null;
  const keys = ['subtotal', 'discount', 'merchandise_amount', 'minimum', 'remaining'];
  if (keys.some(key => typeof data[key] !== 'number' || !Number.isFinite(data[key]) || data[key] < 0)) return null;
  if (data.minimum <= 0 || data.merchandise_amount >= data.minimum || data.remaining <= 0
    || Math.abs(data.subtotal - data.discount - data.merchandise_amount) > 0.000001
    || Math.abs(data.minimum - data.merchandise_amount - data.remaining) > 0.000001) return null;
  const adjustments = (Array.isArray(data.adjustments) ? data.adjustments : [])
    .filter(row => row && adjustmentTypes.has(row.adjustment_type) && typeof row.amount === 'number' && Number.isFinite(row.amount) && row.amount > 0)
    .map(row => ({ name: typeof row.name === 'string' ? row.name : '活動優惠', amount: row.amount, adjustment_type: row.adjustment_type }));
  return { subtotal: data.subtotal, discount: data.discount, merchandiseAmount: data.merchandise_amount,
    minimum: data.minimum, remaining: data.remaining, adjustments,
    hasActivity: adjustments.some(row => row.adjustment_type !== 'student_price_restoration') };
}
