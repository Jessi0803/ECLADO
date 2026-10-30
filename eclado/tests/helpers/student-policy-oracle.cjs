// Small, independent unit-enumeration oracle. Never used in runtime pricing.
function solveStudentPolicy(units, activities) {
  const owner = Array(units.length).fill(-1);
  let best;
  const compare = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
  function evaluate() {
    let saving = 0, excludedReward = 0, any = 0;
    const vector = [];
    for (let j = 0; j < activities.length; j++) {
      const a = activities[j];
      const indices = units.map((_, i) => i).filter(i => owner[i] === j);
      if (!indices.length) { vector.push(0); continue; }
      const qualifies = i => !a.qualificationIds || a.qualificationIds.includes(units[i].productId);
      const benefits = i => !a.benefitIds || a.benefitIds.includes(units[i].productId);
      const price = i => a.stack ? units[i].student : units[i].base;
      const qualified = indices.filter(qualifies);
      const basis = indices.filter(benefits).reduce((n, i) => n + price(i), 0);
      if ((a.quantity ? qualified.length : qualified.reduce((n, i) => n + price(i), 0)) < (a.threshold || 0)) return;
      let gross;
      if (a.type === 'buy_x_get_y') {
        const pool = units.map((_, i) => i).filter(i => qualifies(i) && benefits(i) && (owner[i] < 0 || owner[i] === j));
        const groups = a.repeat ? Math.floor(pool.length / (a.buy + a.get)) : 1;
        if (indices.length !== groups * (a.buy + a.get)) return;
        const free = pool.sort((i, k) => price(i) - price(k) || units[i].productId - units[k].productId || units[i].id - units[k].id).slice(0, groups * a.get);
        if (free.some(i => owner[i] !== j)) return;
        gross = free.reduce((n, i) => n + price(i), 0);
      } else if (a.type === 'fixed_discount') gross = Math.min(basis, a.amount);
      else if (a.type === 'legacy_discount') gross = Math.min(basis, Math.round(basis - Math.max(0, a.order === 'amount_then_rate' ? (basis - a.amount) * a.rate : basis * a.rate - a.amount)));
      else gross = Math.round(basis * (1 - a.rate));
      if (!(gross > 0)) return;
      const lost = a.stack ? 0 : indices.reduce((n, i) => n + units[i].base - units[i].student, 0);
      saving += gross - lost; vector.push(gross - lost); any = 1;
      if (!a.reward) excludedReward += indices.reduce((n, i) => n + units[i].reward, 0);
    }
    const counts = units.flatMap((_, i) => activities.map((_, j) => Number(owner[i] === j)));
    const score = [saving, any, excludedReward, ...vector, ...counts];
    if (!best || compare(score, best.score) > 0) best = { saving, excludedReward, score, owner: [...owner] };
  }
  function visit(i) {
    if (i === units.length) return evaluate();
    owner[i] = -1; visit(i + 1);
    for (let j = 0; j < activities.length; j++) {
      const a = activities[j], q = !a.qualificationIds || a.qualificationIds.includes(units[i].productId), b = !a.benefitIds || a.benefitIds.includes(units[i].productId);
      if (a.type === 'buy_x_get_y' ? q && b : q || b) { owner[i] = j; visit(i + 1); }
    }
    owner[i] = -1;
  }
  visit(0); return best;
}
module.exports = { solveStudentPolicy };
