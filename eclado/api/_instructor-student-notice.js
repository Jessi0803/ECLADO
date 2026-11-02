// Shared by LINE and Email. Read only recipient-specific fields from the outbox.
function instructorStudentNoticeMessage(payload, audience) {
  if (payload.kind !== 'instructor_student' || payload.template_version !== 1
    || !['bind', 'rebind', 'unbind'].includes(payload.event_type)) throw new Error('Unsupported binding notice');
  const name = (value, fallback) => String(value || fallback).replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120) || fallback;
  const student = name(payload.student_name, '學生會員');
  const teacher = name(payload.instructor_name, '您的師資');
  const previous = name(payload.previous_instructor_name, '原師資');
  let title, lines;
  if (audience === 'teacher' && ['bind', 'rebind'].includes(payload.event_type)) {
    title = '新增學生綁定';
    lines = [`學生「${student}」已綁定至您的名下。`, '後續符合返饋條件的學生訂單，將依規則計算返饋金。'];
  } else if (audience === 'student') {
    if (payload.event_type === 'bind') {
      title = '師生綁定完成';
      lines = [`您已綁定師資「${teacher}」。`, '後續購物時，系統將依您的資格與商品活動，確認適用價格。'];
    } else if (payload.event_type === 'rebind') {
      title = '綁定師資已變更';
      lines = [`您的綁定師資已由「${previous}」更換為「${teacher}」。`, '後續購物將依新的綁定關係確認適用價格，既有訂單不受影響。'];
    } else {
      title = '師生綁定已解除';
      lines = [`您與師資「${previous}」的綁定已解除。`, '後續購物不再適用此綁定提供的學生價格，既有訂單不受影響。'];
    }
  } else if (audience === 'former_teacher' && ['rebind', 'unbind'].includes(payload.event_type)) {
    title = payload.event_type === 'rebind' ? '學生綁定已變更' : '學生綁定已解除';
    lines = [payload.event_type === 'rebind' ? `學生「${student}」已不再綁定於您的名下。` : `學生「${student}」與您的綁定已解除。`,
      '既有訂單的返饋仍依原訂單紀錄處理。'];
  } else throw new Error('Unsupported binding audience');
  return { subject: `ECLADO｜${title}`, text: [`【${title}】`, ...lines, '', '如對本次異動有疑問，請聯繫客服。'].join('\n') };
}
module.exports = { instructorStudentNoticeMessage };
