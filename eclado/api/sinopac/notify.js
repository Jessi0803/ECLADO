const DEFAULT_SUPABASE_URL = 'https://ilvdvlkdpntwmaijncaz.supabase.co';

const INVENTORY_ACTIVE_STATUSES = new Set(['paid', 'preparing', 'shipped', 'delivered']);

function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  if (typeof body !== 'string') return {};

  try {
    return JSON.parse(body);
  } catch {
    const params = new URLSearchParams(body);
    return Object.fromEntries(params.entries());
  }
}

function pickPayload(raw) {
  const body = parseBody(raw);
  const nested = body.response || body.Response || body.data || body.Data || {};
  return { ...body, ...(typeof nested === 'object' && nested ? nested : {}) };
}

function pickQuery(query) {
  return query && typeof query === 'object' ? query : {};
}

function payloadValue(payload, key) {
  if (!payload || typeof payload !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(payload, key)) return payload[key];

  const wanted = String(key).toLowerCase();
  const actualKey = Object.keys(payload).find(candidate => candidate.toLowerCase() === wanted);
  return actualKey ? payload[actualKey] : undefined;
}

function firstText(payload, keys) {
  for (const key of keys) {
    const value = payloadValue(payload, key);
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

function getOrderId(payload) {
  return firstText(payload, [
    'orderNo', 'OrderNo', 'order_no',
    'orderId', 'OrderId', 'order_id',
    'MerchantOrderNo', 'merchantOrderNo',
    'MasterOrderNo', 'masterOrderNo',
    'MerchantTradeNo', 'merchantTradeNo',
    'Param1', 'param1',
  ]);
}

function getAmount(payload) {
  const raw = firstText(payload, ['amount', 'Amount', 'Amt', 'Total', 'total', 'PayAmount', 'payAmount']);
  if (!raw) return null;
  const amount = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

function getPayToken(payload) {
  return firstText(payload, ['PayToken', 'payToken', 'pay_token']);
}

function amountsMatch(orderTotal, notifiedAmount) {
  if (notifiedAmount === null) return true;
  const total = Number(orderTotal);
  if (!Number.isFinite(total)) return false;
  return total === notifiedAmount || Math.round(total * 100) === notifiedAmount;
}

function isFailedPayment(payload) {
  const status = firstText(payload, ['Status', 'status']).toUpperCase();
  const payStatus = firstText(payload, ['PayStatus', 'payStatus', 'pay_status']).toUpperCase();
  const result = firstText(payload, ['Result', 'result', 'TradeStatus', 'tradeStatus']).toUpperCase();
  const failureValues = new Set(['F', 'FAIL', 'FAILED', 'ERROR', 'CANCEL', 'CANCELLED', 'N', 'NO', '0']);
  return [status, payStatus, result].some(value => failureValues.has(value));
}

async function supabaseRequest(path, options = {}) {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!serviceKey) throw new Error('SUPABASE_SERVICE_KEY not set');

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (options.returnRepresentation) headers.Prefer = 'return=representation';

  const { returnRepresentation, ...fetchOptions } = options;
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

async function findOrderByPayToken(payToken) {
  if (!payToken) return null;
  const query = [
    `note=ilike.${encodeURIComponent(`*pay_token:${payToken}*`)}`,
    'select=id,status,total,user_id,member,email',
    'limit=1',
  ].join('&');
  const orders = await supabaseRequest(`orders?${query}`, { method: 'GET' });
  return orders?.[0] || null;
}

function buildPaymentMessage(order) {
  return [
    '您的訂單已付款完成。',
    '',
    `訂單編號：${order.id}`,
    Number.isFinite(Number(order.total)) ? `付款金額：NT$ ${Number(order.total).toLocaleString('zh-TW')}` : null,
    '',
    '我們會盡快安排備貨與出貨，感謝您的支持。',
  ].filter(line => line !== null).join('\n');
}

function buildPaymentEmail(order) {
  return [
    `${order.member || '您好'}，您的訂單已付款完成。`,
    '',
    `訂單編號：${order.id}`,
    Number.isFinite(Number(order.total)) ? `付款金額：NT$ ${Number(order.total).toLocaleString('zh-TW')}` : null,
    '',
    '我們會盡快安排備貨與出貨，感謝您的支持。',
    '',
    'ECLADO Taiwan',
  ].filter(line => line !== null).join('\n');
}

async function sendPaymentEmailNotice(order, fallbackEmail = '') {
  const email = order?.email || fallbackEmail;
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
      subject: `ECLADO 訂單已付款完成｜${order.id}`,
      text: buildPaymentEmail(order),
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return { sent: false, reason: body?.message || body?.error || `Resend HTTP ${response.status}` };
  }

  return { sent: true };
}

async function pushLinePaymentNotice(order) {
  if (!order?.user_id) return { sent: false, reason: 'order has no user_id', fallbackEmail: '' };

  const profiles = await supabaseRequest(
    `profiles?id=eq.${encodeURIComponent(order.user_id)}&select=line_user_id,email`,
    { method: 'GET' },
  );
  const lineUserId = profiles?.[0]?.line_user_id;
  if (!lineUserId) return { sent: false, reason: 'profile has no line_user_id', fallbackEmail: profiles?.[0]?.email || '' };

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
      messages: [{ type: 'text', text: buildPaymentMessage(order) }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    return { sent: false, reason: error || `LINE HTTP ${response.status}` };
  }

  return { sent: true };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const payload = { ...pickQuery(req.query), ...pickPayload(req.body) };
  let orderId = '';

  try {
    orderId = getOrderId(payload);
    if (!orderId) {
      const payToken = getPayToken(payload);
      const tokenOrder = await findOrderByPayToken(payToken);
      if (tokenOrder) {
        orderId = tokenOrder.id;
        payload.__tokenOrder = tokenOrder;
      } else {
        console.warn('[sinopac notify] missing order id', {
          keys: payload && typeof payload === 'object' ? Object.keys(payload) : [],
          payToken: payToken || undefined,
          payload,
        });
        return res.status(400).json({ ok: false, error: 'orderNo required' });
      }
    }
    if (isFailedPayment(payload)) {
      return res.status(200).json({ ok: true, orderId, ignored: true, reason: 'payment not successful' });
    }

    let order = payload.__tokenOrder;
    if (!order) {
      const orders = await supabaseRequest(
        `orders?id=eq.${encodeURIComponent(orderId)}&select=id,status,total,user_id,member,email`,
        { method: 'GET' },
      );
      order = orders?.[0];
    }
    if (!order) return res.status(404).json({ ok: false, error: 'order not found', orderId });

    const notifiedAmount = getAmount(payload);
    if (!amountsMatch(order.total, notifiedAmount)) {
      console.warn('[sinopac notify] amount mismatch', {
        orderId,
        orderTotal: order.total,
        notifiedAmount,
        payload,
      });
      return res.status(400).json({ ok: false, error: 'amount mismatch', orderId });
    }

    if (INVENTORY_ACTIVE_STATUSES.has(order.status)) {
      return res.status(200).json({ ok: true, orderId, status: order.status, alreadyPaid: true, lineSent: false });
    }

    const updated = await supabaseRequest(`orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      returnRepresentation: true,
      body: JSON.stringify({ status: 'paid' }),
    });
    const paidOrder = updated?.[0] || { ...order, status: 'paid' };
    const line = await pushLinePaymentNotice(paidOrder);
    const email = line.sent ? { sent: false } : await sendPaymentEmailNotice(paidOrder, line.fallbackEmail);

    return res.status(200).json({
      ok: true,
      orderId,
      status: 'paid',
      lineSent: line.sent,
      lineReason: line.sent ? undefined : line.reason,
      emailSent: email.sent,
      emailReason: email.sent || line.sent ? undefined : email.reason,
    });
  } catch (error) {
    console.error('[sinopac notify]', error);
    return res.status(500).json({ ok: false, error: error.message || String(error), orderId });
  }
};
