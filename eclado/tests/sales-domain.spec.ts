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
