import { expect, test } from '@playwright/test';
import { buildMonthlyRevenue, buildProductMonthlySales } from '../src/admin/domain/analytics.js';
import { periodBuckets, presetRange, productRanking, validRange } from '../src/admin/domain/analyticsPeriod.js';

test('歷史補登不計入營業額與訂單數', () => {
  const result = buildMonthlyRevenue([
    { status: 'delivered', orderSource: 'online', date: '2026-09-20', total: 5000, type: 'consumer' },
    { status: 'delivered', orderSource: 'historical_manual', date: '2026-09-20', total: 80000, type: 'pro' },
  ], new Date('2026-09-29T00:00:00+08:00'));

  expect(result.at(-1)).toMatchObject({ revenue: 5000, orders: 1, proRevenue: 0 });
});

test('歷史補登數量不計入商品銷售與補貨分析', () => {
  const result = buildProductMonthlySales(
    [{ id: 1, nameZh: '呼吸安瓶' }],
    [
      { status: 'delivered', orderSource: 'online', date: '2026-09-20', items: [{ product_id: 1, qty: 2 }] },
      { status: 'delivered', orderSource: 'historical_manual', date: '2026-09-20', items: [{ product_id: 1, qty: 100 }] },
    ],
    new Date('2026-09-29T00:00:00+08:00'),
  );

  expect(result[1].at(-1)).toBe(2);
});


test('自訂期間每日與跨月分組補零，商品合併及規格排行正確', () => {
  const data = {
    startDate: '2026-10-30', endDate: '2026-11-02',
    daily: [{ date:'2026-10-31',revenue:100,orders:1,proRevenue:100,byRole:{pro:100} },{ date:'2026-11-01',revenue:200,orders:1,proRevenue:0,byRole:{consumer:200} }],
    productSales: [
      { date:'2026-10-31',productKey:'1',variantKey:'11',name:'安瓶',size:'30ml',quantity:2,gifts:0 },
      { date:'2026-11-01',productKey:'1',variantKey:'12',name:'安瓶',size:'100ml',quantity:3,gifts:0 },
      { date:'2026-11-01',productKey:'2',variantKey:'21',name:'贈品',size:'10ml',quantity:0,gifts:9 },
    ],
  };
  expect(periodBuckets(data,'day').map(row=>row.revenue)).toEqual([0,100,200,0]);
  const months = periodBuckets(data,'month');
  expect(months).toEqual([
    { key:'2026-10',start:'2026-10-30',end:'2026-10-31',revenue:100,orders:1,proRevenue:100,byRole:{pro:100} },
    { key:'2026-11',start:'2026-11-01',end:'2026-11-02',revenue:200,orders:1,proRevenue:0,byRole:{consumer:200} },
  ]);
  expect(productRanking(data).map(row=>row.quantity)).toEqual([5]);
  expect(productRanking(data,'variant').map(row=>row.size)).toEqual(['100ml','30ml']);
  expect(productRanking(data,'variant',months[0]).map(row=>row.quantity)).toEqual([2]);
  expect(productRanking(data,'product',{ start:'2026-10-30',end:'2026-10-30' })).toEqual([]);
});

test('日期驗證與快捷區間以台灣日期跨年及閏月計算', () => {
  expect(validRange('2026-02-30','2026-03-01')).toBe(false);
  expect(validRange('2026-11-01','2026-10-01')).toBe(false);
  expect(validRange('','2026-10-01')).toBe(false);
  expect(presetRange('month',new Date('2026-12-31T16:01:00Z'))).toEqual({ start:'2027-01-01',end:'2027-01-01' });
  expect(presetRange('lastMonth',new Date('2024-03-15T00:00:00Z'))).toEqual({ start:'2024-02-01',end:'2024-02-29' });
});

test('查詢最多一年，含閏年與近半年快捷區間', () => {
  expect(validRange('2026-10-29','2027-10-28')).toBe(true);
  expect(validRange('2026-10-29','2027-10-29')).toBe(false);
  expect(validRange('2023-03-01','2024-02-29')).toBe(true);
  expect(validRange('2023-03-01','2024-03-01')).toBe(false);
  expect(validRange('2024-02-29','2025-02-27')).toBe(true);
  expect(validRange('2024-02-29','2025-02-28')).toBe(false);
  expect(presetRange('6months',new Date('2026-10-29T00:00:00Z'))).toEqual({ start:'2026-05-01',end:'2026-10-29' });
});
