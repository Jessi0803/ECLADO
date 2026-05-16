const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).send('OK');
  }
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  // Verify LINE signature
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (secret) {
    const signature = req.headers['x-line-signature'];
    const body = JSON.stringify(req.body);
    const hash = crypto.createHmac('SHA256', secret).update(body).digest('base64');
    if (hash !== signature) {
      return res.status(403).send('Invalid signature');
    }
  }

  const events = req.body?.events || [];

  for (const event of events) {
    if (event.type === 'follow' && event.source?.userId) {
      // lineUserId captured here; will be linked to profile once LINE Login is implemented
      console.log('[LINE] new follower:', event.source.userId);
    }
  }

  res.status(200).json({ status: 'ok' });
};
