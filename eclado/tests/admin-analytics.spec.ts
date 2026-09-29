import { expect, test } from '@playwright/test';
import { buildMonthlyRevenue, buildProductMonthlySales } from '../src/admin/domain/analytics.js';

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
