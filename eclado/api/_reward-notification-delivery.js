const { buildBrandedEmailHtml } = require('./_email-template.js');

const money = value => {
  if (!Number.isSafeInteger(Number(value)) || Number(value) < 0) throw new Error('Invalid notice amount');
  return `NT$ ${Number(value).toLocaleString('zh-TW')}`;
};
function rewardNoticeMessage(payload, audience) {
  if (payload.template_version !== undefined && payload.template_version !== 1) throw new Error('Unsupported notice template version');
  const at = new Date(payload.at);
  if (!Number.isFinite(at.getTime())) throw new Error('Invalid notice date');
  const date = at.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
  const headers = { requested: '提領申請已成立', paid: '提領已匯款', failed: '提領未匯款，返饋金已返還', unknown: '提領匯款結果待查核', correction: '提領紀錄更正說明' };
  const title = headers[payload.event_type];
  if (!title) throw new Error('Unsupported notice event');
  const lines = [audience === 'admin' ? '收到新的師資提領申請。' : title, '', `提領編號：${payload.withdrawal_id}`, `${payload.event_type === 'requested' ? '申請日期' : '通知事件時間'}：${date}`];
  if (audience === 'admin') lines.push(`老師識別：${payload.user_id}`);
  if (payload.event_type === 'requested') lines.push(`申請金額：${money(payload.amount)}`, `手續費：${money(payload.fee)}`, `預計實匯金額：${money(payload.net_amount)}`, `預定匯款日期：${payload.scheduled_date}`, '申請狀態：待匯款');
  if (payload.event_type === 'paid') lines.push(`實際匯款日期：${payload.transfer_date}`, `實際匯款金額：${money(payload.transferred_amount)}`, '提領狀態：已匯款');
  if (payload.event_type === 'failed') lines.push('提領狀態：明確未匯款', `已返還返饋金：${money(payload.returned_amount)}`, '本次未收手續費。請確認並更新收款銀行資料後重新申請。');
  if (payload.event_type === 'unknown') lines.push('匯款結果待查核，尚未確認成功或失敗。返饋金仍保留，請勿重複申請。查帳完成後將另行通知。');
  if (payload.event_type === 'correction') lines.push('管理員已追加更正／說明紀錄，原提領結果與金額未變更。請聯繫客服確認詳細說明；此通知不代表再次匯款或退款。');
  lines.push('', audience === 'admin' ? '請登入管理後台處理：https://ecladotaiwan.com/admin' : 'ECLADO Taiwan');
  return { subject: `ECLADO｜${title}`, text: lines.join('\n') };
}
async function deliverRewardNotice(job, { env = process.env, fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const line = job.channel === 'line';
  const credential = line ? env.LINE_CHANNEL_ACCESS_TOKEN : env.RESEND_API_KEY;
  if (!credential && line) return { result: 'line_unavailable' };
  if (!credential || (!line && !job.from && !env.ORDER_EMAIL_FROM)) return { result: 'configuration' };
  const message = rewardNoticeMessage(job.payload, job.audience);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(line ? 'https://api.line.me/v2/bot/message/push' : 'https://api.resend.com/emails', {
      method: 'POST', signal: controller.signal,
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json',
        [line ? 'X-Line-Retry-Key' : 'Idempotency-Key']: String(job.key) },
      body: JSON.stringify(line ? { to: job.target, messages: [{ type: 'text', text: message.text }] }
        : { from: job.from || env.ORDER_EMAIL_FROM, to: [job.target], ...message, html: buildBrandedEmailHtml(message.text) }),
    });
    const acceptedId = line ? response.headers.get('x-line-accepted-request-id') : null;
    if (response.ok || (line && response.status === 409 && acceptedId)) {
      const body = line ? {} : await response.json().catch(() => ({}));
      const id = acceptedId || (line ? response.headers.get('x-line-request-id') : body.id);
      return { result: 'accepted', providerId: /^[a-zA-Z0-9_-]{1,120}$/.test(id || '') ? id : null };
    }
    // Confirmed user decision: even LINE 5xx falls back immediately. LINE's
    // contract permits already-accepted 5xx, so this may duplicate across channels.
    if (line) return { result: response.status === 409 ? 'ambiguous' : response.status >= 500 ? 'line_server_error' : response.status === 429 ? 'line_rate_limited' : 'line_rejected' };
    if (response.status === 429) return { result: 'transient' };
    if (response.status >= 500 || response.status === 409) return { result: 'ambiguous' };
    return { result: 'permanent' };
  } catch {
    return { result: 'ambiguous' };
  } finally { clearTimeout(timer); }
}
module.exports = { rewardNoticeMessage, deliverRewardNotice };
