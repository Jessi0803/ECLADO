const config = require('../src/config/cartReminder.json');
const { buildBrandedEmailHtml } = require('./_email-template.js');

function cartReminderMessage(payload) {
  if (payload?.kind !== 'cart_reminder' || payload.template_version !== 1
    || typeof payload.content !== 'string' || !payload.content.trim()
    || [...payload.content].length > config.maxLength || !payload.content.includes(config.placeholder)) {
    throw new Error('Invalid cart reminder template');
  }
  const text = payload.content.replaceAll(config.placeholder, config.cartUrl);
  if ([...text].length > config.maxExpandedLength) throw new Error('Invalid cart reminder template');
  return { subject: config.subject, text };
}
async function deliverCartReminder(job, { env = process.env, fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const line = job.channel === 'line';
  if (!['line','email'].includes(job.channel)) throw new Error('Invalid reminder channel');
  const credential = line ? env.LINE_CHANNEL_ACCESS_TOKEN : env.RESEND_API_KEY;
  if (!credential || (!line && !job.from)) return { result: 'configuration' };
  const message = cartReminderMessage(job.payload);
  try {
    const response = await fetchImpl(line ? 'https://api.line.me/v2/bot/message/push' : 'https://api.resend.com/emails', {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json',
        [line ? 'X-Line-Retry-Key' : 'Idempotency-Key']: String(job.key) },
      body: JSON.stringify(line ? { to: job.target, messages: [{ type:'text', text:message.text }] }
        : { from:job.from, to:[job.target], ...message,
          html:buildBrandedEmailHtml(message.text, { ctaUrl:config.cartUrl, ctaLabel:'返回購物車' }) }),
    });
    const acceptedId = line ? response.headers.get('x-line-accepted-request-id') : null;
    if (response.ok || (line && response.status === 409 && acceptedId)) {
      const body = line ? {} : await response.json().catch(() => ({}));
      const id = acceptedId || (line ? response.headers.get('x-line-request-id') : body.id);
      return { result:'accepted', providerId:/^[a-zA-Z0-9_-]{1,120}$/.test(id || '') ? id : null };
    }
    if (response.status === 429) return { result:'transient' };
    // Timeouts/5xx may already be accepted: retry the same channel and key.
    // Only definite LINE rejection may move this notice to Email.
    if (response.status >= 500 || response.status === 409) return { result:'ambiguous' };
    return { result:line ? 'line_rejected' : 'permanent' };
  } catch { return { result:'ambiguous' }; }
}
module.exports = { cartReminderMessage, deliverCartReminder };
