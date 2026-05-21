function buildMessage({ type = 'shipment', orderId, tracking, total }) {
  if (type === 'payment_paid') {
    return [
      '您的訂單已付款完成。',
      '',
      `訂單編號：${orderId}`,
      Number.isFinite(Number(total)) ? `付款金額：NT$ ${Number(total).toLocaleString('zh-TW')}` : null,
      '',
      '我們會盡快安排備貨與出貨，感謝您的支持。',
    ].filter(l => l !== null).join('\n');
  }

  const trackingUrl = tracking
    ? `https://htm.sf-express.com/sc/waybill.html?waybillno=${tracking}`
    : null;

  return [
    '您的訂單已出貨。',
    '',
    `訂單編號：${orderId}`,
    tracking ? `托運單號：${tracking}` : null,
    trackingUrl ? `\n查詢物流：${trackingUrl}` : null,
    '',
    '如有問題請透過官方帳號聯繫客服，感謝您的支持。',
  ].filter(l => l !== null).join('\n');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { lineUserId, orderId, tracking, type, total } = req.body || {};
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!token) return res.status(500).json({ error: 'LINE_CHANNEL_ACCESS_TOKEN not set' });
  if (!lineUserId) return res.status(400).json({ error: 'lineUserId required' });
  if (!orderId) return res.status(400).json({ error: 'orderId required' });

  const text = buildMessage({ type, orderId, tracking, total });

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
    const err = await response.text();
    console.error('[LINE push error]', err);
    return res.status(500).json({ error: err });
  }

  res.status(200).json({ status: 'sent' });
};
