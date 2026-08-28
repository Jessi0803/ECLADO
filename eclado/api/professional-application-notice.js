const { requireNotificationAuthorization } = require('./_notification-auth.js');
const { buildBrandedEmailHtml } = require('./_email-template.js');

const DEFAULT_SUPABASE_URL = 'https://ilvdvlkdpntwmaijncaz.supabase.co';
const DEFAULT_FROM = 'ECLADO <service@ecladotaiwan.com>';

async function readJson(response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body?.message || body?.error_description || body?.error || text || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}

function reviewMessage(status, memberName) {
  const greeting = `${memberName || '您好'}，`;
  if (status === 'approved') {
    return {
      subject: 'ECLADO 美容師專業會員申請已核准',
      text: [
        `${greeting}您的美容師專業會員申請已核准。`,
        '',
        '專業會員功能、院線商品購買資格與專業價已開通，重新整理頁面或重新登入後即可使用。',
        '',
        '感謝您加入 ECLADO Taiwan。',
      ].join('\n'),
    };
  }
  return {
    subject: 'ECLADO 美容師專業會員申請結果通知',
    text: [
      `${greeting}您的美容師專業會員申請目前未通過審核。`,
      '',
      '如需了解原因或補充申請資料，請透過 ECLADO 官方 LINE 聯繫客服。',
      '',
      'ECLADO Taiwan',
    ].join('\n'),
  };
}

async function sendLine(lineUserId, text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!lineUserId) return { sent: false, reason: '會員未綁定 LINE' };
  if (!token) return { sent: false, reason: 'LINE_CHANNEL_ACCESS_TOKEN not set' };

  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [{ type: 'text', text }],
    }),
  });
  if (!response.ok) {
    const error = await response.text();
    return { sent: false, reason: error || `LINE HTTP ${response.status}` };
  }
  return { sent: true };
}

async function sendEmail(email, message) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ORDER_EMAIL_FROM || DEFAULT_FROM;
  if (!email) return { sent: false, reason: '申請資料與會員資料皆無 Email' };
  if (!apiKey) return { sent: false, reason: 'RESEND_API_KEY not set' };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: message.subject,
      text: message.text,
      html: buildBrandedEmailHtml(message.text),
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { sent: false, reason: body?.message || body?.error || `Resend HTTP ${response.status}` };
  }
  return { sent: true, id: body?.id || null };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authorization = await requireNotificationAuthorization(req);
  if (!authorization.ok) {
    return res.status(authorization.status).json({ error: authorization.error });
  }

  const applicationId = String(req.body?.applicationId || '').trim();
  if (!applicationId) return res.status(400).json({ error: 'applicationId required' });

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not set' });

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };

  try {
    const applications = await readJson(await fetch(
      `${supabaseUrl}/rest/v1/professional_applications?id=eq.${encodeURIComponent(applicationId)}&select=id,user_id,user_email,contact_name,status&limit=1`,
      { headers },
    ));
    const application = applications?.[0];
    if (!application) return res.status(404).json({ error: 'Application not found' });
    if (!['approved', 'rejected'].includes(application.status)) {
      return res.status(409).json({ error: 'Application has not been reviewed' });
    }

    let profile = null;
    if (application.user_id) {
      const profiles = await readJson(await fetch(
        `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(application.user_id)}&select=email,name,line_user_id&limit=1`,
        { headers },
      ));
      profile = profiles?.[0] || null;
    }

    const message = reviewMessage(application.status, application.contact_name || profile?.name);
    const line = await sendLine(profile?.line_user_id, message.text);
    if (line.sent) {
      return res.status(200).json({ ok: true, channel: 'line', status: application.status });
    }

    const email = await sendEmail(application.user_email || profile?.email, message);
    if (email.sent) {
      return res.status(200).json({
        ok: true,
        channel: 'email',
        status: application.status,
        fallbackReason: line.reason,
      });
    }

    console.error('[professional application notice] all channels failed', {
      applicationId,
      line: line.reason,
      email: email.reason,
    });
    return res.status(502).json({
      ok: false,
      error: 'LINE 與 Email 通知皆發送失敗',
      lineError: line.reason,
      emailError: email.reason,
    });
  } catch (error) {
    console.error('[professional application notice]', error);
    return res.status(500).json({ ok: false, error: error.message || String(error) });
  }
};

