import { expect, test } from '@playwright/test';
import { getOrderPriceAdjustments } from '../src/domain/orderDiscounts.js';

for (const metadata of [
  { coupon_name: '新客複合券', coupon_code_mask: 'WEL****' },
  { couponName: '新客複合券', couponCodeMask: 'WEL****' },
]) {
  test(`舊訂單優惠券備援保留名稱及遮罩且不改金額 ${Object.keys(metadata)[0]}`, () => {
    expect(getOrderPriceAdjustments({ discount: 500, ...metadata })).toEqual([
      { name: '優惠券折抵（新客複合券 · WEL****）', amount: 500 },
    ]);
  });
}

test('有明細快照時保留原明細，無券資料時保留活動及總額備援', () => {
  const adjustments = [{ name: '原始優惠明細', adjustment_type: 'fixed_discount', amount: 500 }];
  expect(getOrderPriceAdjustments({ discount: 500, couponName: '優惠券', adjustments })).toEqual([{ name: '原始優惠明細', amount: 500 }]);
  expect(getOrderPriceAdjustments({ discount: 500, promotion_name: '舊活動' })).toEqual([{ name: '舊活動', amount: 500 }]);
  expect(getOrderPriceAdjustments({ discount: 500 })).toEqual([{ name: '活動／優惠券折抵', amount: 500 }]);
  expect(getOrderPriceAdjustments({ discount: 0, couponName: '優惠券' })).toEqual([]);
});
