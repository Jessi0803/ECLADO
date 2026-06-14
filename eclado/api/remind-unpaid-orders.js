const DEFAULT_SUPABASE_URL = 'https://ilvdvlkdpntwmaijncaz.supabase.co';
const DEFAULT_REMIND_MINUTES = 5;

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function getReminderDelayMs() {
  const configuredMinutes = process.env.ORDER_PAYMENT_REMIND_MINUTES;
  if (configuredMinutes !== undefined) {
    return positiveNumber(configuredMinutes, DEFAULT_REMIND_MINUTES) * 60 * 1000;
  }

  const configuredHours = process.env.ORDER_PAYMENT_REMIND_HOURS;
  if (configuredHours !== undefined) {
    return positiveNumber(configuredHours, DEFAULT_REMIND_MINUTES / 60) * 60 * 60 * 1000;
  }

  return DEFAULT_REMIND_MINUTES * 60 * 1000;
}

function getBatchLimit() {
  return Math.floor(positiveNumber(process.env.ORDER_PAYMENT_REMIND_BATCH_LIMIT || 50, 50));
}

function getAuthHeader(req) {
  return req.headers.authorization || req.headers.Authorization || '';
}

function requireCronAuth(req, res) {
  const secret = process.env.CRON_SECRET;
  const vercelCron = req.headers['x-vercel-cron'];
  if (vercelCron === '1' || vercelCron === 1 || vercelCron === true) return true;

  if (!secret) {
    res.status(500).json({ error: 'CRON_SECRET not set' });
    return false;
  }

  if (getAuthHeader(req) === `Bearer ${secret}`) return true;

  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

async function supabaseRequest(path, options = {}) {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!serviceKey) throw new Error('SUPABASE_SERVICE_KEY not set');

  const { returnRepresentation, ...fetchOptions } = options;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    ...(fetchOptions.headers || {}),
  };

  if (returnRepresentation) headers.Prefer = 'return=representation';

  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...fetchOptions,
    headers,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = body?.message || body?.error || text || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return body;
}

function currency(value) {
  return Number.isFinite(Number(value)) ? `NT$ ${Number(value).toLocaleString('zh-TW')}` : '';
}

function buildReminderMessage(order) {
  return [
    '您的訂單尚未完成付款。',
    '',
    `訂單編號：${order.id}`,
    currency(order.total) ? `訂單金額：${currency(order.total)}` : null,
    '',
    '請於付款期限內完成付款，逾期訂單將自動取消。',
  ].filter(line => line !== null).join('\n');
}

function buildReminderEmail(order) {
  return [
    `${order.member || '您好'}，您的訂單尚未完成付款。`,
    '',
    `訂單編號：${order.id}`,
    currency(order.total) ? `訂單金額：${currency(order.total)}` : null,
    '',
    '請於付款期限內完成付款，逾期訂單將自動取消。',
    '',
    'ECLADO Taiwan',
  ].filter(line => line !== null).join('\n');
}

async function getProfile(userId) {
  if (!userId) return null;
  const profiles = await supabaseRequest(
    `profiles?id=eq.${encodeURIComponent(userId)}&select=line_user_id,email`,
    { method: 'GET' },
  );
  return profiles?.[0] || null;
}

async function pushLineReminder(order, lineUserId) {
  if (!lineUserId) return { sent: false, reason: 'profile has no line_user_id' };

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { sent: false, reason: 'LINE_CHANNEL_ACCESS_TOKEN not set' };

  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [{ type: 'text', text: buildReminderMessage(order) }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    return { sent: false, reason: error || `LINE HTTP ${response.status}` };
  }

  return { sent: true };
}

async function sendEmailReminder(order, fallbackEmail = '') {
  const email = order.email || fallbackEmail;
  if (!email) return { sent: false, reason: 'order has no email' };

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: 'RESEND_API_KEY not set' };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.ORDER_EMAIL_FROM || 'ECLADO <service@ecladotaiwan.com>',
      to: [email],
      subject: `ECLADO 付款提醒｜${order.id}`,
      text: buildReminderEmail(order),
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return { sent: false, reason: body?.message || body?.error || `Resend HTTP ${response.status}` };
  }

  return { sent: true };
}

async function markReminded(orderId, remindedAt) {
  await supabaseRequest(`orders?id=eq.${encodeURIComponent(orderId)}&payment_reminded_at=is.null`, {
    method: 'PATCH',
    body: JSON.stringify({ payment_reminded_at: remindedAt }),
  });
}

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requireCronAuth(req, res)) return;

  const remindMs = getReminderDelayMs();
  const cutoff = new Date(Date.now() - remindMs).toISOString();
  const statuses = ['awaiting_confirm', 'unpaid'];

  try {
    const query = [
      `status=in.(${statuses.join(',')})`,
      `created_at=lte.${encodeURIComponent(cutoff)}`,
      'payment_reminded_at=is.null',
      'select=id,status,created_at,total,user_id,member,email,payment_reminded_at',
      'order=created_at.asc',
      `limit=${encodeURIComponent(String(getBatchLimit()))}`,
    ].join('&');

    const orders = await supabaseRequest(`orders?${query}`, { method: 'GET' });
    const remindedAt = new Date().toISOString();
    const results = [];

    for (const order of orders) {
      const profile = await getProfile(order.user_id);
      const line = await pushLineReminder(order, profile?.line_user_id);
      const email = line.sent ? { sent: false } : await sendEmailReminder(order, profile?.email || '');
      const sent = line.sent || email.sent;

      if (sent) await markReminded(order.id, remindedAt);

      results.push({
        id: order.id,
        lineSent: line.sent,
        lineReason: line.sent ? undefined : line.reason,
        emailSent: email.sent,
        emailReason: email.sent || line.sent ? undefined : email.reason,
        marked: sent,
      });
    }

    return res.status(200).json({
      ok: true,
      cutoff,
      checked: orders.length,
      reminded: results.filter(result => result.marked).length,
      results,
    });
  } catch (error) {
    console.error('[remind-unpaid-orders]', error);
    return res.status(500).json({ ok: false, error: error.message || String(error) });
  }
};

module.exports.__test = {
  buildReminderMessage,
  buildReminderEmail,
  getReminderDelayMs,
};
