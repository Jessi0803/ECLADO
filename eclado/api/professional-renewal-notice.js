const { requireNotificationAuthorization } = require('./_notification-auth.js');
const { buildBrandedEmailHtml } = require('./_email-template.js');

const DEFAULT_SUPABASE_URL = 'https://ilvdvlkdpntwmaijncaz.supabase.co';
const DEFAULT_FROM = 'ECLADO <service@ecladotaiwan.com>';

async function readJson(response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(body?.message || body?.error || text || `HTTP ${response.status}`);
  return body;
}

async function sendLine(userId, text, retryKey) {
  if (!userId) return { sent:false, reason:'會員未綁定 LINE' };
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN) return { sent:false, reason:'LINE_CHANNEL_ACCESS_TOKEN not set' };
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method:'POST', headers:{ Authorization:`Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`, 'Content-Type':'application/json', 'X-Line-Retry-Key':retryKey },
    body:JSON.stringify({ to:userId, messages:[{ type:'text', text }] }),
  });
  return response.ok ? { sent:true } : { sent:false, reason:await response.text() || `LINE HTTP ${response.status}` };
}

async function sendEmail(email, subject, text, idempotencyKey) {
  if (!email) return { sent:false, reason:'會員沒有 Email' };
  if (!process.env.RESEND_API_KEY) return { sent:false, reason:'RESEND_API_KEY not set' };
  const response = await fetch('https://api.resend.com/emails', {
    method:'POST', headers:{ Authorization:`Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type':'application/json', 'Idempotency-Key':idempotencyKey },
    body:JSON.stringify({ from:process.env.ORDER_EMAIL_FROM || DEFAULT_FROM, to:[email], subject, text, html:buildBrandedEmailHtml(text) }),
  });
  const body = await response.json().catch(() => ({}));
  return response.ok ? { sent:true } : { sent:false, reason:body?.message || `Resend HTTP ${response.status}` };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error:'Method not allowed' });
  const authorization = await requireNotificationAuthorization(req);
  if (!authorization.ok) return res.status(authorization.status).json({ error:authorization.error });
  const applicationId = String(req.body?.applicationId || '').trim();
  if (!applicationId) return res.status(400).json({ error:'applicationId required' });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) return res.status(500).json({ error:'SUPABASE_SERVICE_KEY not set' });
  const base = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const headers = { apikey:serviceKey, Authorization:`Bearer ${serviceKey}`, 'Content-Type':'application/json' };
  try {
    const applications = await readJson(await fetch(`${base}/rest/v1/professional_renewal_applications?id=eq.${encodeURIComponent(applicationId)}&select=id,user_id,renewal_year,status,decision_reason&limit=1`, { headers }));
    const application = applications?.[0];
    if (!application) return res.status(404).json({ error:'Application not found' });
    if (!['approved', 'rejected'].includes(application.status)) return res.status(409).json({ error:'Application has not been reviewed' });
    const profiles = await readJson(await fetch(`${base}/rest/v1/profiles?id=eq.${encodeURIComponent(application.user_id)}&select=name,email,line_user_id&limit=1`, { headers }));
    const profile = profiles?.[0] || {};
    const approved = application.status === 'approved';
    const subject = approved ? `ECLADO ${application.renewal_year} 年專業資格續約已核准` : `ECLADO ${application.renewal_year} 年專業資格續約結果`;
    const text = [
      `${profile.name || '您好'}，`, '',
      approved ? `您的 ${application.renewal_year} 年度專業資格續約已核准。` : `您的 ${application.renewal_year} 年度專業資格續約未通過。`,
      application.decision_reason ? `審核說明：${application.decision_reason}` : null,
      '', '如有疑問，請透過 ECLADO 官方 LINE 聯繫客服。', '', 'ECLADO Taiwan',
    ].filter(value => value !== null).join('\n');
    const line = await sendLine(profile.line_user_id, text, application.id);
    const email = line.sent ? null : await sendEmail(profile.email, subject, text, `professional-renewal-${application.id}`);
    const channel = line.sent ? 'line' : email?.sent ? 'email' : null;
    const notificationError = channel ? null : `LINE: ${line.reason}; Email: ${email?.reason}`;
    await readJson(await fetch(`${base}/rest/v1/professional_renewal_applications?id=eq.${encodeURIComponent(application.id)}`, {
      method:'PATCH', headers:{ ...headers, Prefer:'return=representation' },
      body:JSON.stringify(channel ? { result_notification_sent_at:new Date().toISOString(), result_notification_channel:channel, result_notification_error:null } : { result_notification_error:notificationError }),
    }));
    return channel ? res.status(200).json({ ok:true, channel }) : res.status(502).json({ ok:false, error:'LINE 與 Email 通知皆發送失敗', detail:notificationError });
  } catch (error) {
    console.error('[professional-renewal-notice]', error);
    return res.status(500).json({ ok:false, error:error.message || String(error) });
  }
};
