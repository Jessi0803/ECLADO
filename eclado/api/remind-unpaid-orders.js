const DEFAULT_SUPABASE_URL = 'https://ilvdvlkdpntwmaijncaz.supabase.co';
const DEFAULT_REMIND_MINUTES = 180;
const DEFAULT_SECOND_REMIND_MINUTES = 24 * 60;

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

function getSecondReminderDelayMs() {
  const configuredMinutes = process.env.ORDER_PAYMENT_SECOND_REMIND_MINUTES;
  if (configuredMinutes !== undefined) {
    return positiveNumber(configuredMinutes, DEFAULT_SECOND_REMIND_MINUTES) * 60 * 1000;
  }

  const configuredHours = process.env.ORDER_PAYMENT_SECOND_REMIND_HOURS;
  if (configuredHours !== undefined) {
    return positiveNumber(configuredHours, DEFAULT_SECOND_REMIND_MINUTES / 60) * 60 * 60 * 1000;
  }

  return DEFAULT_SECOND_REMIND_MINUTES * 60 * 1000;
}

function getAuthHeader(req) {
  return req.headers.authorization || req.headers.Authorization || '';
}

function requireCronAuth(req, res) {
  const secret = process.env.CRON_SECRET;
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

function formatPaymentDueAt(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function buildReminderMessage(order, stage = 'first') {
  const isSecond = stage === 'second';
  const dueAt = formatPaymentDueAt(order.payment_due_at);
  return [
    isSecond ? '您的訂單仍未完成付款。' : '您的訂單尚未完成付款。',
    '',
    `訂單編號：${order.id}`,
    currency(order.total) ? `訂單金額：${currency(order.total)}` : null,
    dueAt ? `付款期限：${dueAt}` : null,
    '',
    isSecond
      ? '這是付款期限前的最後提醒，請儘速完成付款，逾期訂單將自動取消。'
      : '請於付款期限內完成付款，逾期訂單將自動取消。',
  ].filter(line => line !== null).join('\n');
}

function buildReminderEmail(order, stage = 'first') {
  const isSecond = stage === 'second';
  const dueAt = formatPaymentDueAt(order.payment_due_at);
  return [
    `${order.member || '您好'}，您的訂單${isSecond ? '仍' : ''}尚未完成付款。`,
    '',
    `訂單編號：${order.id}`,
    currency(order.total) ? `訂單金額：${currency(order.total)}` : null,
    dueAt ? `付款期限：${dueAt}` : null,
    '',
    isSecond
      ? '這是付款期限前的最後提醒，請儘速完成付款，逾期訂單將自動取消。'
      : '請於付款期限內完成付款，逾期訂單將自動取消。',
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

async function pushLineReminder(order, lineUserId, stage) {
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
      messages: [{ type: 'text', text: buildReminderMessage(order, stage) }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    return { sent: false, reason: error || `LINE HTTP ${response.status}` };
  }

  return { sent: true };
}

async function sendEmailReminder(order, fallbackEmail = '', stage = 'first') {
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
      subject: `ECLADO ${stage === 'second' ? '最後付款提醒' : '付款提醒'}｜${order.id}`,
      text: buildReminderEmail(order, stage),
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return { sent: false, reason: body?.message || body?.error || `Resend HTTP ${response.status}` };
  }

  return { sent: true };
}

async function markReminded(order, stage, remindedAt) {
  const isSecond = stage === 'second';
  const marker = isSecond ? 'payment_second_reminded_at' : 'payment_reminded_at';
  const update = { [marker]: remindedAt };
  if (isSecond && !order.payment_reminded_at) update.payment_reminded_at = remindedAt;

  await supabaseRequest(`orders?id=eq.${encodeURIComponent(order.id)}&${marker}=is.null`, {
    method: 'PATCH',
    body: JSON.stringify(update),
  });
}

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requireCronAuth(req, res)) return;

  const remindMs = getReminderDelayMs();
  const secondRemindMs = getSecondReminderDelayMs();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const cutoff = new Date(nowMs - remindMs).toISOString();
  const secondCutoff = new Date(nowMs - secondRemindMs).toISOString();
  const statuses = ['awaiting_confirm', 'unpaid'];

  try {
    const query = [
      `status=in.(${statuses.join(',')})`,
      `created_at=lte.${encodeURIComponent(cutoff)}`,
      `payment_due_at=gt.${encodeURIComponent(nowIso)}`,
      `or=(payment_reminded_at.is.null,and(created_at.lte.${encodeURIComponent(secondCutoff)},payment_second_reminded_at.is.null))`,
      'select=id,status,created_at,total,user_id,member,email,payment_reminded_at,payment_second_reminded_at,payment_due_at',
      'order=created_at.asc',
      `limit=${encodeURIComponent(String(getBatchLimit()))}`,
    ].join('&');

    const orders = await supabaseRequest(`orders?${query}`, { method: 'GET' });
    const remindedAt = nowIso;
    const results = [];

    for (const order of orders) {
      const orderCreatedAt = new Date(order.created_at).getTime();
      const secondReminderDue = Number.isFinite(orderCreatedAt)
        && orderCreatedAt <= nowMs - secondRemindMs;
      const stage = secondReminderDue && !order.payment_second_reminded_at ? 'second' : 'first';
      if (stage === 'first' && order.payment_reminded_at) continue;

      const profile = await getProfile(order.user_id);
      const line = await pushLineReminder(order, profile?.line_user_id, stage);
      const email = line.sent ? { sent: false } : await sendEmailReminder(order, profile?.email || '', stage);
      const sent = line.sent || email.sent;

      if (sent) await markReminded(order, stage, remindedAt);

      results.push({
        id: order.id,
        stage,
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
  getSecondReminderDelayMs,
  formatPaymentDueAt,
};
