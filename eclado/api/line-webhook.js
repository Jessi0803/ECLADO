const crypto = require('crypto');

async function readRawBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    chunks.push(buffer);
  }

  return Buffer.concat(chunks, total);
}

function hasValidSignature(rawBody, suppliedSignature, secret) {
  if (typeof suppliedSignature !== 'string' || !suppliedSignature.trim()) return false;

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const supplied = Buffer.from(suppliedSignature, 'base64');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).send('OK');
  }
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const secret = String(process.env.LINE_CHANNEL_SECRET || '').trim();
  if (!secret) {
    console.error('[LINE webhook] verification secret is not configured');
    return res.status(503).send('Webhook verification unavailable');
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch {
    return res.status(400).send('Invalid request body');
  }

  if (!hasValidSignature(rawBody, req.headers?.['x-line-signature'], secret)) {
    return res.status(403).send('Invalid signature');
  }

  let body;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).send('Invalid JSON');
  }

  const events = Array.isArray(body?.events) ? body.events : [];

  for (const event of events) {
    if (event.type === 'follow' && event.source?.userId) {
      // lineUserId captured here; will be linked to profile once LINE Login is implemented
      console.log('[LINE] new follower:', event.source.userId);
    }
  }

  res.status(200).json({ status: 'ok' });
};
