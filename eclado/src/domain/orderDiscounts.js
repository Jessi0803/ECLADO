// Public names/amounts only. Old orders retain their aggregate snapshot fallback.
export function getOrderPriceAdjustments(order = {}) {
  const snapshot = order.pricing_snapshot || order.pricingSnapshot;
  const source = order.adjustments || snapshot?.adjustments;
  const discount = Number(order.discount) || 0;
  if (Array.isArray(source)) {
    const rows = source.filter(row => row && ['legacy_discount', 'percentage_discount', 'fixed_discount', 'buy_x_get_y'].includes(row.adjustment_type)
      && Number.isFinite(Number(row.amount)) && Number(row.amount) > 0).map(row => ({ name: row.name || row.name_snapshot || '活動優惠', amount: Number(row.amount) }));
    if (rows.length && Math.abs(rows.reduce((total, row) => total + row.amount, 0) - discount) < 0.000001) return rows;
  }
  return discount > 0 ? [{ name: order.promotion_name || order.promotionName || '活動／優惠券折抵', amount: discount }] : [];
}
