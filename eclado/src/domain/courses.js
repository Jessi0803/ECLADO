const taipeiInput = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const courseTime = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23',
});

export function toTaipeiInput(value) {
  return value ? taipeiInput.format(new Date(value)).replace(' ', 'T') : '';
}

export function formatCourseTime(course) {
  return courseTime.formatRange(new Date(course.starts_at), new Date(course.ends_at));
}

export function formatCourseDuration(course) {
  const minutes = Math.round((Date.parse(course.ends_at) - Date.parse(course.starts_at)) / 60_000);
  if (!Number.isFinite(minutes) || minutes <= 0) return '';

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return ['約', hours && `${hours} 小時`, remainder && `${remainder} 分鐘`].filter(Boolean).join(' ');
}

export function formatCoursePrice(value) {
  return `NT$ ${Number(value).toLocaleString('zh-TW')}`;
}

export const COURSE_PARTICIPANT_LABELS = {
  pro_self: '美容師本人', instructor_self: '師資本人', delegated: '師資代報',
};

export const COURSE_REGISTRATION_LABELS = {
  pending: '待付款', active: '報名成立', cancelled: '已取消', expired: '付款已逾期',
};

export const COURSE_PAYMENT_LABELS = {
  free: '免費報名', pending: '待付款', paid: '已付款', expired: '付款已逾期', failed: '未建立付款單', review: '收款待人工確認',
};


export function isCourseRegistrationOpen(course, now = Date.now()) {
  return Boolean(course && Date.parse(course.starts_at) > now
    && (!course.registration_opens_at || Date.parse(course.registration_opens_at) <= now));
}

export function courseRegistrationNotice(course, now = Date.now()) {
  if (!course?.registration_opens_at || Date.parse(course.registration_opens_at) <= now) return '';
  return `預計於 ${taipeiInput.format(new Date(course.registration_opens_at)).replaceAll('-', '/')} 開放報名（台北時間）`;
}
