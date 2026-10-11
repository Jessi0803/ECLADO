import { expect, test } from '@playwright/test';
import { getProfessionalOrderProgress, hasProfessionalOrderRules, getProfessionalShoppingNotice } from '../src/domain/memberShopping.js';
import { calculateShipping } from '../src/domain/shipping.js';

test('內部人員折扣後須滿5000、固定免運、不使用追加資格', () => {
  const staff = { role:'staff' };
  for (const amount of [0, 4500, 4999]) {
    expect(getProfessionalOrderProgress(amount, staff, { id:'group', effectiveTotal:20000 })?.eligible).toBe(false);
    expect(calculateShipping([{ id:1 }], staff, amount)).toBe(0);
  }
  for (const amount of [5000, 15000]) {
    expect(getProfessionalOrderProgress(amount, staff)?.eligible).toBe(true);
    expect(getProfessionalOrderProgress(amount, staff)?.freeShipping).toBe(true);
  }
  expect(hasProfessionalOrderRules(staff)).toBe(false);
  expect(getProfessionalOrderProgress(4999, staff, { id:'group' })?.additionalOrder).toBeUndefined();
  expect(getProfessionalShoppingNotice(staff)).toMatchObject({minimum:5000,fixedFreeShipping:true});
  expect(getProfessionalOrderProgress(4999, {role:'consumer'})).toBeNull();
  expect(getProfessionalOrderProgress(100, {role:'instructor'}, {id:'group',effectiveTotal:5000})?.eligible).toBe(true);
});
