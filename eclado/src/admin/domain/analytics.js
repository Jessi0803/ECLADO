import { normalizeSalesName, SALES_COUNTED_STATUSES } from '../../domain/sales.js';

const PROFESSIONAL_ROLES = new Set(['pro', 'instructor', 'distributor']);

function monthKey(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function orderMonth(order) {
  const value = String(order?.date || order?.createdAt || '').trim();
  const match = value.match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : '';
}

export function buildMonthlyRevenue(orders, now = new Date(), monthCount = 6) {
  const months = [];
  for (let offset = monthCount - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    months.push({
      key: monthKey(date.getFullYear(), date.getMonth()),
      month: `${date.getMonth() + 1}月`,
      year: date.getFullYear(),
      revenue: 0,
      orders: 0,
      proRevenue: 0,
    });
  }

  const byMonth = new Map(months.map(month => [month.key, month]));
  (orders || []).forEach(order => {
    if (!SALES_COUNTED_STATUSES.has(order?.status)) return;
    const month = byMonth.get(orderMonth(order));
    if (!month) return;
    const total = Number(order.total) || 0;
    month.revenue += total;
    month.orders += 1;
    if (PROFESSIONAL_ROLES.has(order.type)) month.proRevenue += total;
  });

  return months;
}

export function revenueSummary(months) {
  const totalRevenue = months.reduce((sum, month) => sum + month.revenue, 0);
  const totalOrders = months.reduce((sum, month) => sum + month.orders, 0);
  return {
    totalRevenue,
    totalOrders,
    averageOrder: totalOrders ? Math.round(totalRevenue / totalOrders) : 0,
  };
}

export function revenueGrowth(currentRevenue, previousRevenue) {
  if (!previousRevenue) return currentRevenue > 0 ? null : 0;
  return ((currentRevenue - previousRevenue) / previousRevenue) * 100;
}

export function buildProductMonthlySales(products, orders, now = new Date(), monthCount = 6) {
  const months = buildMonthlyRevenue([], now, monthCount);
  const monthIndexes = new Map(months.map((month, index) => [month.key, index]));
  const sales = Object.fromEntries((products || []).map(product => [product.id, Array(monthCount).fill(0)]));
  const productsById = new Map((products || []).map(product => [Number(product.id), product]));
  const productsByName = new Map();
  (products || []).forEach(product => {
    [product.name, product.nameZh, product.name_zh]
      .map(normalizeSalesName)
      .filter(Boolean)
      .forEach(name => productsByName.set(name, product));
  });

  (orders || []).forEach(order => {
    if (!SALES_COUNTED_STATUSES.has(order?.status)) return;
    const index = monthIndexes.get(orderMonth(order));
    if (index == null) return;
    (Array.isArray(order.items) ? order.items : []).forEach(item => {
      const itemProductId = Number(item?.product_id ?? item?.productId ?? item?.id);
      const product = productsById.get(itemProductId)
        || productsByName.get(normalizeSalesName(item?.name || item?.nameZh || item?.name_zh));
      if (!product) return;
      const qty = Math.max(1, Number(item?.qty) || 1);
      sales[product.id][index] += qty;
    });
  });

  return sales;
}
