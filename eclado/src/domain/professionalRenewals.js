export const RENEWAL_STATUS_LABELS = Object.freeze({
  submitted: '已送出，待年度結算',
  pending_review: '待管理員審核',
  approved: '續約通過',
  rejected: '續約未通過',
  not_applied: '尚未提交申請',
  overdue: '逾期未提交，待處理',
  not_applied_downgraded: '未申請，已降回美容師',
  qualification_changed: '資格已另行變更',
});

export function getTaipeiYear(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en', { timeZone:'Asia/Taipei', year:'numeric' }).format(now));
}

// Read-only local preview while the manual-processing migration is not deployed.
export function buildRenewalRosterPreview(profiles, memberships, applications, renewalYear, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit' }).format(now);
  const boundary = `${renewalYear}-01-01`;
  const cohort = new Map();
  for (const membership of memberships) {
    if (!['instructor','distributor'].includes(membership.role) || membership.started_on >= boundary || membership.started_on > today
      || (membership.ended_on && membership.ended_on < boundary)) continue;
    if (!cohort.has(membership.user_id) || cohort.get(membership.user_id).started_on < membership.started_on) cohort.set(membership.user_id, membership);
  }
  const selectedApplications = applications.filter(row => row.renewal_year === renewalYear);
  for (const application of selectedApplications) if (!cohort.has(application.user_id)) cohort.set(application.user_id, { role:application.role });
  const rows = Array.from(cohort, ([userId, membership]) => {
    const application = selectedApplications.find(row => row.user_id === userId);
    const profile = profiles.find(row => row.id === userId) || {};
    const active = memberships.some(row => row.user_id === userId && row.role === profile.role
      && ['instructor','distributor'].includes(row.role) && row.started_on < boundary && !row.ended_on);
    return application ? { ...application, application_id:application.id, can_finalize:false, can_downgrade:false } : {
      id:`${renewalYear}:${userId}`, application_id:null, user_id:userId, member_name:profile.name,
      member_email:profile.email, member_role:profile.role, role:membership.role,
      renewal_year:renewalYear, assessment_year:renewalYear - 1,
      status:!active ? 'qualification_changed' : today >= boundary ? 'overdue' : 'not_applied',
      assessment:null, evidence:[], recent_notices:[], can_finalize:false, can_downgrade:false,
    };
  });
  return {
    rows, migrationReady:false,
    current_instructors:profiles.filter(row => row.role === 'instructor').length,
    current_distributors:profiles.filter(row => row.role === 'distributor').length,
    eligible_count:rows.length, submitted_count:selectedApplications.length,
    not_submitted_count:rows.length - selectedApplications.length,
    unprocessed_count:rows.filter(row => ['submitted','pending_review','not_applied','overdue'].includes(row.status)).length,
  };
}

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
