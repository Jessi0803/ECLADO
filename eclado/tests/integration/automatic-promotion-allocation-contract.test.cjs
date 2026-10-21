'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { solveAutomaticPromotions: solve } = require('../helpers/automatic-promotion-oracle.cjs');

const unit = (id, productId, price) => ({ id, productId, price });
const fixed = (id, benefitIds, amount, extra = {}) => ({ id, type: 'fixed_discount', qualificationIds: benefitIds, benefitIds, amount, ...extra });
const percent = (id, benefitIds, rate, extra = {}) => ({ id, type: 'percentage_discount', qualificationIds: benefitIds, benefitIds, rate, ...extra });
const bogo = (extra = {}) => ({ id: 'bogo', type: 'buy_x_get_y', buy: 3, get: 1, repeat: true, ...extra });

const cases = [
  {
    name: '不同商品各自適用，折抵合計 300',
    units: [unit('a', 'A', 1000), unit('b', 'B', 1000)],
    activities: [fixed('A', ['A'], 100), fixed('B', ['B'], 200)], discount: 300,
  },
  {
    name: '同一件九折與八折擇優', units: [unit('a', 'A', 1000)],
    activities: [percent('nine', ['A'], '0.9'), percent('eight', ['A'], '0.8')], discount: 200,
    selected: ['eight'],
  },
  {
    name: '不能先搶單一 250 而漏掉兩個 150',
    units: [unit('a', 'A', 1000), unit('b', 'B', 1000)],
    activities: [fixed('all', ['A', 'B'], 250, { minQuantity: 2 }), fixed('A', ['A'], 150), fixed('B', ['B'], 150)], discount: 300,
    selected: ['A', 'B'],
  },
  {
    name: '分配後不可借另一活動商品湊滿額',
    units: [unit('a', 'A', 100), unit('b', 'B', 100)],
    activities: [fixed('threshold', ['A', 'B'], 80, { minAmount: 200 }), fixed('B', ['B'], 90)], discount: 90,
  },
  {
    name: '分配後不可借另一活動商品湊件數',
    units: [unit('a', 'A', 100), unit('b', 'B', 100)],
    activities: [fixed('threshold', ['A', 'B'], 80, { minQuantity: 2 }), fixed('B', ['B'], 90)], discount: 90,
  },
  {
    name: '固定金額跨商品列只折一次', units: [unit('a', 'A', 100), unit('b', 'B', 100)],
    activities: [fixed('all', ['A', 'B'], 30)], discount: 30,
  },
  {
    name: '百分比按活動合計取整：兩件 5 元九折共折 1 元',
    units: [unit('a', 'A', 5), unit('b', 'A', 5)], activities: [percent('all', ['A'], '0.9')], discount: 1,
  },
  {
    name: '百分比最多折抵分配商品本金', units: [unit('a', 'A', 100)],
    activities: [percent('all', ['A'], '0')], discount: 100,
  },
  {
    name: '同規格五件可拆四件買贈與一件八折',
    units: Array.from({ length: 5 }, (_, i) => unit(String(i), 'A', 100)),
    activities: [bogo(), percent('eight', ['A'], '0.8')], discount: 120,
    occupied: { bogo: 4, eight: 1 },
  },
  {
    name: '四件的買入與免費件全占用，不再加八折',
    units: Array.from({ length: 4 }, (_, i) => unit(String(i), 'A', 100)),
    activities: [bogo(), percent('eight', ['A'], '0.8')], discount: 100,
    occupied: { bogo: 4 },
  },
  {
    name: '八件重複贈送最低及第二低價',
    units: [100, 200, 3000, 3000, 3000, 3000, 3000, 3000].map((price, i) => unit(String(i), 'A', price)),
    activities: [bogo()], discount: 300, free: ['0', '1'], occupied: { bogo: 8 },
  },
  {
    name: 'once 八件只贈最低價一件',
    units: [100, 200, 3000, 3000, 3000, 3000, 3000, 3000].map((price, i) => unit(String(i), 'A', price)),
    activities: [bogo({ repeat: false })], discount: 100, occupied: { bogo: 4 },
  },
  {
    name: '買二送二占用四件，免費最低兩件',
    units: [100, 200, 300, 400].map((price, i) => unit(String(i), 'A', price)),
    activities: [bogo({ buy: 2, get: 2 })], discount: 300, free: ['0', '1'],
  },
  {
    name: '不得丟下便宜餘數而贈送較貴商品',
    units: [100, 1000, 1000, 1000, 1000].map((price, i) => unit(String(i), 'A', price)),
    activities: [bogo()], discount: 100, free: ['0'],
  },
  {
    name: '便宜商品真正分配別的活動後，可對剩餘四件買贈',
    units: [unit('0', 'cheap', 100), ...Array.from({ length: 4 }, (_, i) => unit(String(i + 1), 'A', 1000))],
    activities: [bogo(), fixed('cheap', ['cheap'], 10)], discount: 1010,
    occupied: { bogo: 4, cheap: 1 },
  },
  {
    name: '零折抵活動不得占走便宜品墊高買贈',
    units: [unit('0', 'cheap', 100), ...Array.from({ length: 4 }, (_, i) => unit(String(i + 1), 'A', 1000))],
    activities: [bogo(), fixed('cheap', ['cheap'], 0)], discount: 100,
  },
  {
    name: '贈品活動與優惠券活動不納入價格分配', units: [unit('a', 'A', 100)],
    activities: [{ id: 'gift', type: 'amount_gift', amount: 100 }, fixed('coupon', ['A'], 100, { automatic: false })], discount: 0,
  },
  {
    name: '資格範圍與折抵範圍不同時，資格商品也占用',
    units: [unit('a', 'A', 100), unit('b', 'B', 100)],
    activities: [fixed('cross', ['B'], 60, { qualificationIds: ['A'], minQuantity: 1 }), fixed('A', ['A'], 50)], discount: 60,
    occupied: { cross: 2 },
  },
  {
    name: 'legacy 先折金額再乘折數', units: [unit('a', 'A', 1000)],
    activities: [{ id: 'old', type: 'legacy_discount', benefitIds: ['A'], amount: 100, rate: '0.8', order: 'amount_then_rate' }], discount: 280,
  },
  {
    name: 'legacy 先乘折數再折金額', units: [unit('a', 'A', 1000)],
    activities: [{ id: 'old', type: 'legacy_discount', benefitIds: ['A'], amount: 100, rate: '0.8', order: 'rate_then_amount' }], discount: 300,
  },
  {
    name: 'legacy 不套用未上架商品', units: [{ ...unit('a', 'A', 1000), active: false }],
    activities: [{ id: 'old', type: 'legacy_discount', benefitIds: ['A'], amount: 100, rate: '0.8' }], discount: 0,
  },
  {
    name: '零元商品與折抵不超過本金', units: [unit('a', 'A', 0), unit('b', 'B', 10)],
    activities: [fixed('all', ['A', 'B'], 1000)], discount: 10,
  },
];

for (const fixture of cases) {
  test(fixture.name, () => {
    const result = solve(fixture);
    assert.equal(result.discount, fixture.discount);
    if (fixture.selected) assert.deepEqual(result.allocations.map((a) => a.activityId), fixture.selected);
    if (fixture.free) assert.deepEqual(result.allocations.flatMap((a) => a.freeUnitIds), fixture.free);
    if (fixture.occupied) assert.deepEqual(Object.fromEntries(result.allocations.map((a) => [a.activityId, a.unitIds.length])), fixture.occupied);
    const allocated = result.allocations.flatMap((a) => a.unitIds);
    assert.equal(new Set(allocated).size, allocated.length, 'No unit can be allocated twice');
    for (const allocation of result.allocations) {
      assert.ok(allocation.discount > 0);
      assert.ok(allocation.discount <= fixture.units.filter((u) => allocation.unitIds.includes(u.id)).reduce((n, u) => n + u.price, 0));
      assert.ok(allocation.freeUnitIds.every((id) => allocation.unitIds.includes(id)));
    }
    assert.deepEqual(solve({ ...fixture, units: [...fixture.units].reverse(), activities: [...fixture.activities].reverse() }), result, 'Input order cannot change allocation');
  });
}

for (const stacking of ['coupon_only', 'allow_auto_gifts']) {
  test(`${stacking} 不執行自動價格分配（非優惠券引擎整合測試）`, () => {
    assert.deepEqual(solve({ ...cases[0], stacking }), { discount: 0, allocations: [], assignmentCount: 1 });
  });
}
test('同額依 priority、建立時間、ID 穩定判定', () => {
  const units = [unit('a', 'A', 100)];
  const tied = [fixed('z', ['A'], 10, { priority: 0, createdAt: '2020' }), fixed('b', ['A'], 10, { priority: 1, createdAt: '2010' }), fixed('a', ['A'], 10, { priority: 0, createdAt: '2020' })];
  assert.equal(solve({ units, activities: tied }).allocations[0].activityId, 'a');
  assert.equal(solve({ units, activities: tied.slice(0, 2) }).allocations[0].activityId, 'z');
  assert.equal(solve({ units, activities: tied.map((a) => ({ ...a, priority: 0 })) }).allocations[0].activityId, 'b');
});
test('超出參考搜尋預算明確拒絕，不偷偷改貪婪結果', () => {
  assert.throws(() => solve({ ...cases[0], maxAssignments: 1 }), /budget exceeded/);
});
test('單件任意兩活動的最佳折抵符合直接可列舉答案', () => {
  for (let price = 0; price <= 12; price++) {
    for (let amount = 0; amount <= 12; amount++) {
      const result = solve({ units: [unit('a', 'A', price)], activities: [fixed('fixed', ['A'], amount), percent('half', ['A'], '0.5')] });
      assert.equal(result.discount, Math.max(Math.min(price, amount), Math.floor(price / 2 + 0.5)));
    }
  }
});
