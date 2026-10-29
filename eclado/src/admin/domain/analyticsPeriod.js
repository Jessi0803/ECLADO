const DAY = 86400000;
export function taipeiToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year','month','day'].map(type => parts.find(part => part.type === type).value).join('-');
}
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
}
export function maximumEndDate(start) {
  if (!validDate(start)) return '';
  const date = new Date(`${start}T00:00:00Z`);
  const year = date.getUTCFullYear() + 1;
  const month = date.getUTCMonth();
  // Match PostgreSQL's calendar-year arithmetic, including February 29.
  const day = Math.min(date.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day) - DAY).toISOString().slice(0,10);
}
export function rangeError(start, end) {
  if (!validDate(start) || !validDate(end) || start > end) return '請輸入有效日期，且開始日期不可晚於結束日期。';
  if (end > maximumEndDate(start)) return '查詢期間最多一年，請縮短開始與結束日期的範圍。';
  return '';
}
export function validRange(start, end) {
  return !rangeError(start, end);
}
export function presetRange(preset, now = new Date()) {
  const end = taipeiToday(now);
  const date = new Date(`${end}T00:00:00Z`);
  if (preset === 'lastMonth') return {
    start: new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()-1,1)).toISOString().slice(0,10),
    end: new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),0)).toISOString().slice(0,10),
  };
  const start = preset === '30days' ? new Date(date.getTime()-29*DAY)
    : new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()-(preset === '6months' ? 5 : 0),1));
  return { start: start.toISOString().slice(0,10), end };
}
export function periodBuckets(data, interval) {
  if (!data || !validRange(data.startDate, data.endDate)) return [];
  const buckets = new Map();
  for (let day = Date.parse(`${data.startDate}T00:00:00Z`); day <= Date.parse(`${data.endDate}T00:00:00Z`); day += DAY) {
    const date = new Date(day).toISOString().slice(0,10);
    const key = interval === 'month' ? date.slice(0,7) : date;
    if (!buckets.has(key)) buckets.set(key, { key, start: date, end: date, revenue: 0, orders: 0, proRevenue: 0, byRole: {} });
    buckets.get(key).end = date;
  }
  for (const row of data.daily) {
    const bucket = buckets.get(interval === 'month' ? row.date.slice(0,7) : row.date);
    if (bucket) for (const key of ['revenue','orders','proRevenue']) bucket[key] += Number(row[key]) || 0;
    if (bucket) for (const [role,revenue] of Object.entries(row.byRole || { other: row.revenue })) {
      bucket.byRole[role] = (bucket.byRole[role] || 0) + (Number(revenue) || 0);
    }
  }
  return [...buckets.values()];
}
export function productRanking(data, mode = 'product', bucket = null) {
  const rows = new Map();
  for (const line of data?.productSales || []) {
    if (bucket && (line.date < bucket.start || line.date > bucket.end)) continue;
    const key = JSON.stringify(mode === 'variant' ? [line.productKey,line.variantKey] : [line.productKey]);
    if (!rows.has(key)) rows.set(key, { key, name: line.name, size: mode === 'variant' ? line.size : '全部規格', quantity: 0, gifts: 0 });
    rows.get(key).quantity += Number(line.quantity) || 0;
    rows.get(key).gifts += Number(line.gifts) || 0;
  }
  return [...rows.values()].filter(row => row.quantity > 0).sort((a,b) => b.quantity-a.quantity || a.name.localeCompare(b.name,'zh-Hant') || a.key.localeCompare(b.key));
}
