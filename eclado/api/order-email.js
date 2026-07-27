const DEFAULT_FROM = 'ECLADO <service@ecladotaiwan.com>';
const { requireNotificationAuthorization } = require('./_notification-auth.js');

function currency(value) {
  return Number.isFinite(Number(value)) ? `NT$ ${Number(value).toLocaleString('zh-TW')}` : '';
}

function textForOrderPlaced({ orderId, total, memberName }) {
  return [
    `${memberName || '您好'}，您的訂單已建立。`,
    '',
    `訂單編號：${orderId}`,
    currency(total) ? `訂單金額：${currency(total)}` : null,
    '',
    '我們已收到您的訂單，請依頁面付款資訊完成付款。付款完成後將安排後續處理。',
    '',
    'ECLADO Taiwan',
  ].filter(line => line !== null).join('\n');
}

function textForPaymentPaid({ orderId, total, memberName }) {
  return [
    `${memberName || '您好'}，您的訂單已付款完成。`,
    '',
    `訂單編號：${orderId}`,
    currency(total) ? `付款金額：${currency(total)}` : null,
    '',
    '我們會盡快安排備貨與出貨，感謝您的支持。',
    '',
    'ECLADO Taiwan',
  ].filter(line => line !== null).join('\n');
}

function textForShipment({ orderId, tracking, memberName }) {
  const trackingUrl = tracking
    ? `https://htm.sf-express.com/sc/waybill.html?waybillno=${tracking}`
    : '';

  return [
    `${memberName || '您好'}，您的訂單已出貨。`,
    '',
    `訂單編號：${orderId}`,
    tracking ? `托運單號：${tracking}` : null,
    trackingUrl ? `查詢物流：${trackingUrl}` : null,
    '',
    '如有問題請透過官方帳號聯繫客服，感謝您的支持。',
    '',
    'ECLADO Taiwan',
  ].filter(line => line !== null).join('\n');
}

function buildEmail({ type = 'order_placed', orderId, total, tracking, memberName }) {
  if (type === 'shipment') {
    return {
      subject: `ECLADO 訂單已出貨｜${orderId}`,
      text: textForShipment({ orderId, tracking, memberName }),
    };
  }
  if (type === 'payment_paid') {
    return {
      subject: `ECLADO 訂單已付款完成｜${orderId}`,
      text: textForPaymentPaid({ orderId, total, memberName }),
    };
  }
  return {
    subject: `ECLADO 訂單已建立｜${orderId}`,
    text: textForOrderPlaced({ orderId, total, memberName }),
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authorization = await requireNotificationAuthorization(req);
  if (!authorization.ok) {
    return res.status(authorization.status).json({ error: authorization.error });
  }

  const { email, orderId, type, total, tracking, memberName } = req.body || {};
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ORDER_EMAIL_FROM || DEFAULT_FROM;

  if (!apiKey) return res.status(500).json({ error: 'RESEND_API_KEY not set' });
  if (!email) return res.status(400).json({ error: 'email required' });
  if (!orderId) return res.status(400).json({ error: 'orderId required' });

  const message = buildEmail({ type, orderId, total, tracking, memberName });
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
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return res.status(500).json({ error: body?.message || body?.error || `Resend HTTP ${response.status}` });
  }

  return res.status(200).json({ status: 'sent', id: body?.id || null });
};
