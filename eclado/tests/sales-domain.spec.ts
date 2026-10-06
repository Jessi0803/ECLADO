import { expect, test } from '@playwright/test';
import { buildSalesStats, getPopularProducts } from '../src/domain/sales.js';

test('客訂規格銷量不計入熱門商品統計', () => {
  const stats = buildSalesStats([{
    status: 'paid',
    items: [
      { product_id: 1, qty: 20, is_custom_order: true },
      { product_id: 2, qty: 3, is_custom_order: false },
    ],
  }]);

  expect(stats.byId[1]).toBeUndefined();
  expect(stats.byId[2]).toBe(3);
});

test('歷史補登商品不計入熱門商品統計', () => {
  const stats = buildSalesStats([
    { status: 'delivered', orderSource: 'historical_manual', items: [{ product_id: 1, qty: 100 }] },
    { status: 'delivered', orderSource: 'online', items: [{ product_id: 2, qty: 3 }] },
  ]);
  expect(stats.byId[1]).toBeUndefined();
  expect(stats.byId[2]).toBe(3);
});

test('只有客訂規格的商品不會被熱門商品 fallback 補入', () => {
  const products = [
    { id: 1, nameZh: '客訂商品', active: true, variants: [{ active: true, isCustomOrder: true }] },
    { id: 2, nameZh: '一般商品', active: true, variants: [{ active: true, isCustomOrder: false }] },
    {
      id: 3,
      nameZh: '混合規格商品',
      active: true,
      variants: [
        { active: true, isCustomOrder: true },
        { active: true, isCustomOrder: false },
      ],
    },
  ];

  expect(getPopularProducts(products, { byId: {}, byName: {} }, 8).map(product => product.id))
    .toEqual([2, 3]);
});

test('專業資格歷程忽略同日開始又結束的空紀錄', async () => {
  const { normalizeProfessionalSales } = await import('../src/domain/professionalSales.js');
  const sales = normalizeProfessionalSales({
    member_id: 'm1',
    memberships: [
      { id: 'empty', role: 'distributor', started_on: '2026-09-07', ended_on: '2026-09-07' },
      { id: 'real', role: 'distributor', started_on: '2026-09-07', ended_on: '2026-09-16' },
    ],
    quarters: [],
  });
  expect(sales.memberships.map(item => item.id)).toEqual(['real']);
});

test('自然季使用年份與季度顯示並以 quarter_start 產生穩定識別', async () => {
  const { normalizeProfessionalSales, professionalQuarterKey, quarterTitle } = await import('../src/domain/professionalSales.js');
  const sales = normalizeProfessionalSales({
    member_id: 'm1',
    memberships: [{ id: 'membership-1', role: 'instructor', started_on: '2026-09-07', ended_on: null }],
    quarters: [{
      membership_id: 'membership-1',
      quarter_number: 1,
      quarter_start: '2026-07-01',
      calendar_year: 2026,
      calendar_quarter: 3,
      period_start: '2026-09-07',
      period_end_exclusive: '2026-10-01',
      is_current: true,
      is_partial: true,
    }],
  });
  expect(quarterTitle(sales.currentQuarter)).toBe('2026 Q3');
  expect(professionalQuarterKey(sales.currentQuarter)).toBe('membership-1-2026-07-01');
});
