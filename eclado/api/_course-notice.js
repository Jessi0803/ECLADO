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

function coursePaymentReminderMessage(payload, origin = 'https://ecladotaiwan.com') {
  const at = value => new Date(value).toLocaleString('zh-TW', { timeZone:'Asia/Taipei', hour12:false });
  const subject = `ECLADO｜${payload.final ? '課程最後付款提醒' : '課程付款提醒'}｜${payload.name}`;
  const url = new URL(`/courses/${payload.course_id}/register`, origin).href;
  const text = [subject, '您的課程報名已受理，目前尚未完成付款，請於開課前完成付款。',
    `課程：${payload.name}`, `上課時間：${at(payload.starts_at)}（台北時間）`,
    `參加者：${payload.participants.join('、')}`, `應付金額：NT$ ${Number(payload.total_twd).toLocaleString('zh-TW')}`,
    `付款截止：${at(payload.payment_due_at)}（台北時間）`,
    payload.final && '這是開課前的最後付款提醒。逾期未付款仍保留報名，管理員將聯繫確認；如需取消，請聯繫客服。',
    `繼續付款：${url}`, '如已完成付款，請先查詢付款狀態；若仍有疑問，歡迎聯繫客服。'].filter(Boolean).join('\n\n');
  return { subject, text };
}
module.exports.coursePaymentReminderMessage = coursePaymentReminderMessage;
