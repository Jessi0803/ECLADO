const { buildBrandedEmailHtml } = require('./_email-template.js');

const DEFAULT_SUPABASE_URL = 'https://ilvdvlkdpntwmaijncaz.supabase.co';
const DEFAULT_SUPABASE_ANON = 'sb_publishable_BasrQNdstdbX_InrQWmCuw_Jb1Lscnl';
const DEFAULT_FROM = 'ECLADO <service@ecladotaiwan.com>';
const DEFAULT_ADMIN_EMAIL = 'ecladotaiwan@gmail.com';
const ADMIN_URL = 'https://ecladotaiwan.com/admin';

async function readJson(response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body?.message || body?.error_description || body?.error || text || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}

function bearerToken(req) {
  const authorization = String(req.headers?.authorization || '');
  return authorization.startsWith('Bearer ') ? authorization : '';
}

function formatSubmittedAt(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function emailMessage(createdAt) {
  const submittedAt = formatSubmittedAt(createdAt);
  return {
    subject: 'ECLADO 後台｜有新的美容師申請待審核',
    text: [
      '目前有一筆新的美容師專業會員申請等待審核。',
      submittedAt ? `申請時間：${submittedAt}` : null,
      '',
      '請登入 ECLADO 管理後台查看並進行審核。',
      '為保護會員個人資料，詳細申請內容不會顯示於此通知信中。',
      '',
      `管理後台：${ADMIN_URL}`,
    ].filter(line => line !== null).join('\n'),
  };
}

async function callServiceRpc(supabaseUrl, serviceKey, name, payload) {
  return readJson(await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  }));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authorization = bearerToken(req);
  if (!authorization) return res.status(401).json({ error: 'Unauthorized' });

  const applicationId = String(req.body?.applicationId || '').trim();
  if (!applicationId) return res.status(400).json({ error: 'applicationId required' });

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const recipient = process.env.PROFESSIONAL_APPLICATION_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL;
  const from = process.env.ORDER_EMAIL_FROM || DEFAULT_FROM;
  if (!serviceKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not set' });
  if (!resendKey) return res.status(500).json({ error: 'RESEND_API_KEY not set' });

  try {
    const user = await readJson(await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: authorization },
    }));
    if (!user?.id) return res.status(401).json({ error: 'Unauthorized' });

    const claim = await callServiceRpc(
      supabaseUrl,
      serviceKey,
      'claim_professional_application_admin_notification',
      { p_application_id: applicationId, p_user_id: user.id },
    );
    if (!claim?.id) {
      return res.status(200).json({ ok: true, sent: false, alreadyHandled: true });
    }

    const message = emailMessage(claim.created_at);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `professional-application-admin-${applicationId}`,
      },
      body: JSON.stringify({
        from,
        to: [recipient],
        subject: message.subject,
        text: message.text,
        html: buildBrandedEmailHtml(message.text, {
          ctaLabel: '前往管理後台',
          ctaUrl: ADMIN_URL,
        }),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = body?.message || body?.error || `Resend HTTP ${response.status}`;
      await callServiceRpc(supabaseUrl, serviceKey, 'complete_professional_application_admin_notification', {
        p_application_id: applicationId,
        p_sent: false,
        p_error: reason,
      });
      return res.status(502).json({ ok: false, error: '管理員通知信寄送失敗' });
    }

    await callServiceRpc(supabaseUrl, serviceKey, 'complete_professional_application_admin_notification', {
      p_application_id: applicationId,
      p_sent: true,
      p_error: null,
    });
    return res.status(200).json({ ok: true, sent: true });
  } catch (error) {
    console.error('[professional application admin notice]', error.message || String(error));
    return res.status(500).json({ ok: false, error: '管理員通知處理失敗' });
  }
};

module.exports.emailMessage = emailMessage;
