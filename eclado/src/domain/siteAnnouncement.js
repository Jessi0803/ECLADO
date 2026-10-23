export function getAnnouncementState(announcement, now = Date.now()) {
  if (announcement?.enabled !== true || !announcement.content?.trim()) return 'disabled';
  const start = announcement.start_at ? Date.parse(announcement.start_at) : null;
  const end = announcement.end_at ? Date.parse(announcement.end_at) : null;
  if ((start !== null && !Number.isFinite(start)) || (end !== null && !Number.isFinite(end))
    || (start !== null && end !== null && end <= start)) return 'invalid';
  if (end !== null && now >= end) return 'ended';
  if (start !== null && now < start) return 'scheduled';
  return 'visible';
}

export const isAnnouncementVisible = (announcement, now = Date.now()) => getAnnouncementState(announcement, now) === 'visible';

// datetime-local is interpreted explicitly in Taipei, regardless of the admin device timezone.
export function announcementTimeToInput(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23',
  }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function announcementInputToTime(value) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('請填寫有效的公告時間');
  const date = new Date(`${value}:00+08:00`);
  if (!Number.isFinite(date.getTime()) || announcementTimeToInput(date.toISOString()) !== value) throw new Error('請填寫有效的公告時間');
  return date.toISOString();
}

export function formatAnnouncementTime(value) {
  return value ? announcementTimeToInput(value).replace('T', ' ') : '';
}
