const crypto = require('node:crypto');
const { resolveSupabaseUrl } = require('./_supabase-env.js');
const { validateBrowserBatch } = require('../payment-api/checkout-events.cjs');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false });
  }
  if (!String(req.headers?.['content-type'] || '').startsWith('application/json')) return res.status(415).json({ ok: false });
  let events;
  try { events = validateBrowserBatch(typeof req.body === 'string' ? JSON.parse(req.body) : req.body); }
  catch { return res.status(400).json({ ok: false }); }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!key) return res.status(503).json({ ok: false });
  // Vercel overwrites x-vercel-forwarded-for. Never accept a client-provided
  // x-forwarded-for as the rate identity when running outside that platform.
  const ip = process.env.VERCEL === '1' ? String(req.headers?.['x-vercel-forwarded-for'] || 'unknown').split(',')[0].trim()
    : req.socket?.remoteAddress || 'unknown';
  const hash = crypto.createHmac('sha256', key).update(`checkout-events:${ip}`).digest('hex');
  try {
    const response = await fetch(`${resolveSupabaseUrl()}/rest/v1/rpc/ingest_checkout_browser_events`, {
      method: 'POST', signal: AbortSignal.timeout(3000),
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key_hash: hash, p_events: events }),
    });
    if (!response.ok) return res.status(503).json({ ok: false });
    if (await response.json() !== true) {
      res.setHeader('Retry-After', '900');
      return res.status(429).json({ ok: false });
    }
    return res.status(200).json({ ok: true });
  } catch { return res.status(503).json({ ok: false }); }
};
