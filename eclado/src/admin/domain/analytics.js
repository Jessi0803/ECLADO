import { normalizeSalesName, SALES_COUNTED_STATUSES } from '../../domain/sales.js';

const PROFESSIONAL_ROLES = new Set(['pro', 'instructor', 'distributor']);
export const ECOMMERCE_LAUNCH_DATE = '2026-09-18';
const DAY_MS = 24 * 60 * 60 * 1000;

function monthKey(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function taipeiDateParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = type => parts.find(item => item.type === type)?.value || '';
  return { year: Number(part('year')), month: Number(part('month')), day: Number(part('day')) };
}

function orderMonth(order) {
  const value = String(order?.date || order?.createdAt || '').trim();
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}`;
  const parts = taipeiDateParts(value);
  return parts ? monthKey(parts.year, parts.month - 1) : '';
}

function dayNumber(value) {
  const text = String(value || '').trim();
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])) / DAY_MS;
  }
  const parts = taipeiDateParts(value);
  return parts ? Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS : null;
}

function oldestVisibleMonth(now, monthCount) {
  const parts = taipeiDateParts(now);
  if (!parts) return ECOMMERCE_LAUNCH_DATE;
  return new Date(Date.UTC(parts.year, parts.month - monthCount, 1)).toISOString().slice(0, 10);
}

export function getProductSalesAnalysisPeriod(
  now = new Date(),
  launchDate = ECOMMERCE_LAUNCH_DATE,
  monthCount = 6,
) {
  const rollingStart = oldestVisibleMonth(now, monthCount);
  const launchDay = dayNumber(launchDate);
  const rollingDay = dayNumber(rollingStart);
  const todayDay = dayNumber(now);
  const startDay = Math.max(launchDay ?? rollingDay, rollingDay);
  return {
    startDate: new Date(startDay * DAY_MS).toISOString().slice(0, 10),
    dayCount: Math.max(1, (todayDay ?? startDay) - startDay + 1),
  };
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

export function buildProductMonthlySales(products, orders, now = new Date(), monthCount = 6, startDate = null) {
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
    if (startDate) {
      const orderDay = dayNumber(order?.date || order?.createdAt || order?.created_at);
      const startDay = dayNumber(startDate);
      if (orderDay == null || (startDay != null && orderDay < startDay)) return;
    }
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

export function buildProductSalesMetrics(
  products,
  orders,
  now = new Date(),
  launchDate = ECOMMERCE_LAUNCH_DATE,
  monthCount = 6,
) {
  const period = getProductSalesAnalysisPeriod(now, launchDate, monthCount);
  const monthlySales = buildProductMonthlySales(products, orders, now, monthCount, period.startDate);
  const monthlyAverage = Object.fromEntries(Object.entries(monthlySales).map(([productId, monthly]) => {
    const total = monthly.reduce((sum, qty) => sum + qty, 0);
    return [productId, (total / period.dayCount) * 30];
  }));
  return { monthlySales, monthlyAverage, period };
}
