export const QUARTERLY_SALES_ROLES = new Set(['instructor', 'distributor']);

export const PROFESSIONAL_ROLE_LABELS = {
  instructor: '師資',
  distributor: '經銷商',
};

export function isQuarterlySalesRole(role) {
  return QUARTERLY_SALES_ROLES.has(String(role || ''));
}

export function normalizeProfessionalSales(value) {
  const payload = value && typeof value === 'object' ? value : {};
  const memberships = Array.isArray(payload.memberships) ? payload.memberships : [];
  const quarters = (Array.isArray(payload.quarters) ? payload.quarters : [])
    .map(quarter => ({
      ...quarter,
      quarter_number: Math.max(1, Number(quarter.quarter_number) || 1),
      sales_amount: Math.max(0, Number(quarter.sales_amount) || 0),
      order_count: Math.max(0, Number(quarter.order_count) || 0),
      is_current: quarter.is_current === true,
      is_partial: quarter.is_partial === true,
    }))
    .sort((a, b) => String(b.period_start || '').localeCompare(String(a.period_start || '')));
  return {
    memberId: payload.member_id || '',
    memberships,
    quarters,
    currentQuarter: quarters.find(quarter => quarter.is_current) || null,
    previousQuarter: quarters.find(quarter => !quarter.is_current) || null,
    currentMembership: memberships.find(membership => !membership.ended_on) || null,
  };
}

export function formatMoney(value) {
  return `NT$ ${Math.round(Number(value) || 0).toLocaleString('zh-TW')}`;
}

export function formatTaiwanDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}/${match[2]}/${match[3]}` : '—';
}

export function inclusivePeriodEnd(exclusiveDate) {
  const match = String(exclusiveDate || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function formatQuarterPeriod(quarter) {
  if (!quarter) return '—';
  return `${formatTaiwanDate(quarter.period_start)}－${formatTaiwanDate(inclusivePeriodEnd(quarter.period_end_exclusive))}`;
}

export function quarterTitle(quarter) {
  if (!quarter) return '資格季度';
  return `資格第 ${quarter.quarter_number} 季`;
}
