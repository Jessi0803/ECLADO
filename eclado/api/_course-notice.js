function courseNoticeMessage(payload) {
  const time = new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23',
  }).formatRange(new Date(payload.starts_at), new Date(payload.ends_at));
  const subject = `ECLADO｜${payload.automatic ? '課前提醒' : '課程通知'}｜${payload.name}`;
  const text = [
    subject,
    `上課時間：${time}（台北時間）`,
    payload.zoom_url && `Zoom 會議：${payload.zoom_url}`,
    payload.message,
    payload.delegated && '請自行將上課資訊及 Zoom 連結轉知您代報名的參加者。',
  ].filter(Boolean).join('\n\n');
  return { subject, text };
}

module.exports = { courseNoticeMessage };
