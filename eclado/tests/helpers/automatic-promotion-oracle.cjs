'use strict';

// Test-only exhaustive specification. Never import from application/SQL runtime.
// Input is trusted, prefiltered eligibility and authoritative whole-NTD unit prices.
const PRICE_TYPES = new Set(['percentage_discount', 'fixed_discount', 'buy_x_get_y', 'legacy_discount']);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sum = (items) => items.reduce((n, unit) => n + unit.price, 0);
function decimal(value) {
  const text = String(value);
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('Expected nonnegative decimal');
  const [whole, fraction = ''] = text.split('.');
  return [BigInt(whole + fraction), 10n ** BigInt(fraction.length)];
}
function roundFraction(n, d) { return Number((2n * n + d) / (2n * d)); }
function qualifies(activity, unit) {
  return !activity.qualificationIds || activity.qualificationIds.includes(unit.productId);
}
function benefits(activity, unit) {
  return !activity.benefitIds || activity.benefitIds.includes(unit.productId);
}
function eligible(activity, unit) {
  if (activity.type === 'legacy_discount') return benefits(activity, unit) && unit.active !== false;
  if (activity.type === 'buy_x_get_y') return qualifies(activity, unit) && benefits(activity, unit);
  return qualifies(activity, unit) || benefits(activity, unit);
}
function evaluate(activity, owned, unassigned) {
  if (!owned.length) return null;
  const qualification = owned.filter((unit) => qualifies(activity, unit));
  const quantityThreshold = activity.type === 'buy_x_get_y' || activity.thresholdType === 'quantity' || activity.minQuantity > 0;
  if (activity.type !== 'legacy_discount' &&
      ((quantityThreshold ? qualification.length : sum(qualification)) <= 0 || qualification.length < (activity.minQuantity || 0) || sum(qualification) < (activity.minAmount || 0))) return null;
  const benefited = owned.filter((unit) => benefits(activity, unit));
  const base = sum(benefited);
  let discount = 0;
  let freeUnitIds = [];
  if (activity.type === 'buy_x_get_y') {
    const groupSize = activity.buy + activity.get;
    if (owned.length % groupSize !== 0) return null;
    const groups = owned.length / groupSize;
    const pool = [...owned, ...unassigned.filter((unit) => eligible(activity, unit))]
      .sort((a, b) => compare(a.price, b.price) || compare(a.id, b.id));
    if (activity.repeat ? groups !== Math.floor(pool.length / groupSize) : groups !== 1) return null;
    const free = pool.slice(0, groups * activity.get);
    const ownedIds = new Set(owned.map((unit) => unit.id));
    if (free.some((unit) => !ownedIds.has(unit.id))) return null;
    discount = sum(free);
    freeUnitIds = free.map((unit) => unit.id);
  } else if (activity.type === 'fixed_discount') {
    discount = Math.min(base, activity.amount);
  } else {
    const [rate, denominator] = decimal(activity.rate);
    if (rate > denominator) throw new Error('Rate must be between zero and one');
    const reduction = activity.type === 'legacy_discount' ? BigInt(activity.amount || 0) : 0n;
    const finalNumerator = activity.order === 'amount_then_rate'
      ? (BigInt(base) - reduction) * rate
      : BigInt(base) * rate - reduction * denominator;
    discount = roundFraction(BigInt(base) * denominator - (finalNumerator > 0n ? finalNumerator : 0n), denominator);
  }
  discount = Math.min(base, discount);
  // A zero-benefit activity cannot park cheap units to inflate another activity.
  return discount > 0 ? { activityId: activity.id, discount, unitIds: owned.map((unit) => unit.id), freeUnitIds } : null;
}

function solveAutomaticPromotions({ units, activities, stacking = 'allow_all', maxAssignments = 250000 }) {
  if (!['allow_all', 'coupon_only', 'allow_auto_gifts'].includes(stacking)) throw new Error('Unknown stacking mode');
  const orderedUnits = [...units].sort((a, b) => compare(a.id, b.id));
  if (new Set(units.map((unit) => unit.id)).size !== units.length) throw new Error('Unit IDs must be unique');
  for (const unit of units) {
    if (!Number.isSafeInteger(unit.price) || unit.price < 0) throw new Error('Oracle requires whole-NTD prices');
  }
  if (!Number.isSafeInteger(sum(units))) throw new Error('Unsafe subtotal');
  if (stacking !== 'allow_all') return { discount: 0, allocations: [], assignmentCount: 1 };
  const candidates = activities.filter((activity) => PRICE_TYPES.has(activity.type) && activity.automatic !== false)
    .sort((a, b) => compare(a.priority || 0, b.priority || 0) || compare(a.createdAt || '', b.createdAt || '') || compare(a.id, b.id));
  if (new Set(candidates.map((activity) => activity.id)).size !== candidates.length) throw new Error('Activity IDs must be unique');
  for (const activity of candidates) {
    if (activity.type === 'buy_x_get_y' &&
        (![activity.buy, activity.get].every((n) => Number.isSafeInteger(n) && n > 0))) throw new Error('Invalid buy/get quantity');
    for (const key of ['amount', 'minAmount', 'minQuantity']) {
      if (activity[key] != null && (!Number.isSafeInteger(activity[key]) || activity[key] < 0)) throw new Error('Oracle requires nonnegative whole amounts/quantities');
    }
  }
  const choices = orderedUnits.map((unit) => [-1, ...candidates.flatMap((activity, index) => eligible(activity, unit) ? [index] : [])]);
  let assignmentCount = 1;
  for (const options of choices) {
    assignmentCount *= options.length;
    if (assignmentCount > maxAssignments) throw new Error('Reference search budget exceeded; no approximate result');
  }
  const assignment = [];
  let best = null;
  function visit(position) {
    if (position < orderedUnits.length) {
      for (const choice of choices[position]) { assignment[position] = choice; visit(position + 1); }
      return;
    }
    const unassigned = orderedUnits.filter((_, index) => assignment[index] === -1);
    const allocations = [];
    const discounts = [];
    for (let index = 0; index < candidates.length; index++) {
      const owned = orderedUnits.filter((_, unitIndex) => assignment[unitIndex] === index);
      const result = evaluate(candidates[index], owned, unassigned);
      if (owned.length && !result) return;
      discounts.push(result?.discount || 0);
      if (result) allocations.push(result);
    }
    const discount = allocations.reduce((n, result) => n + result.discount, 0);
    // Tie: maximize discounts in activity priority/date/ID order, then use the
    // lexicographically smallest owner sequence (unassigned sorts last).
    const owners = assignment.map((index) => index === -1 ? candidates.length : index);
    const score = [discount, ...discounts, ...owners.map((index) => -index)];
    const difference = best ? score.findIndex((value, index) => value !== best.score[index]) : -1;
    if (!best || (difference !== -1 && score[difference] > best.score[difference])) best = { discount, allocations, score };
  }
  visit(0);
  return { discount: best.discount, allocations: best.allocations, assignmentCount };
}

module.exports = { solveAutomaticPromotions };
