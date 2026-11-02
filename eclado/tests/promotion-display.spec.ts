import { expect, test } from '@playwright/test';
import { calculateDiscount, getProductDisplayPromotions, getPromoDisplayPrice } from '../src/domain/promotions.js';
import { activePromotion } from './support/eclado-mocks';

const product = { id: 2, price: 3980, qty: 1 };

for (const invalid of [
  { name: '負折扣率', discount_rate: -1, discount_amount: 0 },
  { name: '超出範圍折扣率', discount_rate: 1.1, discount_amount: 0 },
  { name: '負折抵金額', discount_rate: 1, discount_amount: -100 },
  { name: '非數字折扣率', discount_rate: NaN, discount_amount: 0 },
  { name: '無限折抵金額', discount_rate: 1, discount_amount: Infinity },
  { name: '缺少折扣率', discount_rate: undefined, discount_amount: 0 },
]) {
  test(`${invalid.name}不顯示活動說明且不影響原價`, () => {
    for (const benefit_type of [undefined, 'legacy_discount']) {
      const promotion = { ...activePromotion, ...invalid, benefit_type, storefront_scope_type: 'products', product_ids: [2] };
      expect(getProductDisplayPromotions(product, null, [promotion])).toEqual([]);
      expect(getPromoDisplayPrice(product, null, [promotion])).toBeNull();
      expect(calculateDiscount([product], [promotion], null).discount).toBe(0);
    }
  });
}

test('有效折扣與不使用舊折扣欄位的贈品活動仍可顯示', () => {
  const discount = { ...activePromotion, id: 'valid', product_ids: [2], discount_rate: 1, discount_amount: 500 };
  const gifts = ['quantity_gift', 'amount_gift'].map(benefit_type => ({
    ...activePromotion, id: benefit_type, benefit_type, storefront_scope_type: 'products', product_ids: [2],
    discount_rate: undefined, discount_amount: undefined,
  }));
  expect(getProductDisplayPromotions(product, null, [discount, ...gifts])).toEqual([discount, ...gifts]);
  expect(getPromoDisplayPrice(product, null, [discount])?.price).toBe(3480);
});
