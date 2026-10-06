export const RENEWAL_STATUS_LABELS = Object.freeze({
  submitted: '已送出，待年度結算',
  pending_review: '待管理員審核',
  approved: '續約通過',
  rejected: '續約未通過',
});

export const EVIDENCE_STATUS_LABELS = Object.freeze({
  pending: '待審核',
  approved: '可列入計算',
  rejected: '不列入計算',
  void: '已作廢',
});

export function formatRenewalMoney(value) {
  return `NT$ ${Math.round(Number(value) || 0).toLocaleString('zh-TW')}`;
}

export function normalizeRenewalPayload(value) {
  const source = value && typeof value === 'object' ? value : {};
  const assessment = source.current_assessment && typeof source.current_assessment === 'object'
    ? source.current_assessment
    : {};
  return {
    currentYear: Number(source.current_year) || new Date().getFullYear(),
    applicationWindowOpen: source.application_window_open === true,
    assessment: {
      ...assessment,
      quarters: Array.isArray(assessment.quarters) ? assessment.quarters : [],
    },
    currentApplication: source.current_application || null,
    latestApplication: source.latest_application || null,
    evidence: Array.isArray(source.current_evidence) ? source.current_evidence : [],
    notices: Array.isArray(source.recent_notices) ? source.recent_notices : [],
  };
}

export function renewalQualificationText(assessment) {
  if (assessment?.quarterly_route_qualified) return '目前符合 A 條件（各有效季度達標）';
  if (assessment?.annual_route_qualified) return '目前符合 A 條件（年度累計達標且各季非零）';
  if ((Number(assessment?.student_approved_count) || 0) >= 8) return '目前符合 B 條件（8 位學員資料已核准）';
  return '目前為暫估，最終結果由年度結算與管理員審核確認';
}
