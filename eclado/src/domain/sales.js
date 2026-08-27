export const SALES_COUNTED_STATUSES = new Set(['paid', 'preparing', 'shipped', 'delivered']);
export const DEFAULT_POPULAR_PRODUCT_LIMIT = 8;

export function normalizeSalesName(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

export function emptySalesStats() {
  return { byId: {}, byName: {} };
}

export function buildSalesStats(orders) {
  const byId = {};
  const byName = {};

  (orders || []).forEach(order => {
    if (order?.product_id != null && order?.sold_qty != null) {
      const productId = Number(order.product_id);
      const soldQty = Math.max(0, Number(order.sold_qty) || 0);
      if (!Number.isNaN(productId) && productId > 0) byId[productId] = soldQty;
      return;
    }
    if (!SALES_COUNTED_STATUSES.has(order?.status)) return;
    const items = Array.isArray(order.items) ? order.items : [];
    items.forEach(item => {
      const qty = Math.max(1, Number(item?.qty) || 1);
      const productId = Number(item?.product_id ?? item?.productId ?? item?.id);
      if (!Number.isNaN(productId) && productId > 0) {
        byId[productId] = (byId[productId] || 0) + qty;
        return;
      }
      const name = normalizeSalesName(item?.name || item?.nameZh || item?.name_zh);
      if (name) byName[name] = (byName[name] || 0) + qty;
    });
  });

  return { byId, byName };
}

export function getProductSalesCount(product, salesStats) {
  const idCount = Number(salesStats?.byId?.[Number(product.id)] || 0);
  const names = [product.nameZh, product.name, product.name_zh].map(normalizeSalesName).filter(Boolean);
  const nameCount = names.reduce((sum, name) => sum + Number(salesStats?.byName?.[name] || 0), 0);
  return idCount + nameCount;
}

export function getPopularProducts(products, salesStats, limit = DEFAULT_POPULAR_PRODUCT_LIMIT) {
  const ranked = (products || [])
    .filter(product => product && product.active !== false)
    .map((product, index) => ({
      product,
      index,
      sales: getProductSalesCount(product, salesStats),
    }));

  const sold = ranked
    .filter(item => item.sales > 0)
    .sort((a, b) => b.sales - a.sales || a.index - b.index);
  const fallback = ranked.filter(item => item.sales <= 0);

  return [...sold, ...fallback].slice(0, limit).map(item => item.product);
}

// ─── PROMOTION HELPERS ────────────────────────────────────────────────────────
// Supabase integer[] 有時是數字、有時是字串，統一成數字 id
