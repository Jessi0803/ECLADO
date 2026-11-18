const crypto = require('node:crypto');
const { resolveSupabaseUrl } = require('./_supabase-env.js');
const { deliverCartReminder } = require('./_cart-reminder-delivery.js');

function authorized(req, secret) {
  const supplied = Buffer.from(String(req.headers?.authorization || '').replace(/^Bearer /, ''));
  const expected = Buffer.from(secret || '');
  return expected.length > 0 && supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
async function dispatchCartReminders({ env = process.env, fetchImpl = fetch, limit = 5 } = {}) {
  const url = env.SUPABASE_URL || resolveSupabaseUrl();
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('configuration');
  async function rpc(name, args) {
    const response = await fetchImpl(`${url}/rest/v1/rpc/${name}`, {
      method:'POST', signal:AbortSignal.timeout(5000),
      headers:{ apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json' }, body:JSON.stringify(args),
    });
    if (!response.ok) throw new Error('database_request_failed');
    return response.json();
  }
  let checked = 0, accepted = 0, skipped = 0;
  const lineAvailable = Boolean(env.LINE_CHANNEL_ACCESS_TOKEN);
  for (let index=0; index<Math.min(5,Math.max(1,Number(limit) || 5)); index++) {
    const claimed = await rpc('claim_cart_reminder', { p_line_available:lineAvailable });
    if (!claimed) break;
    if (claimed.skipped) { skipped++; continue; }
    const job = await rpc('prepare_cart_reminder', {
      p_id:claimed.id, p_token:claimed.lease_token, p_line_available:lineAvailable,
      p_email_from:env.ORDER_EMAIL_FROM || 'ECLADO <service@ecladotaiwan.com>',
    });
    if (!job) { skipped++; continue; }
    const delivery = await deliverCartReminder(job, { env, fetchImpl });
    const stored = await rpc('complete_cart_reminder', {
      p_id:claimed.id, p_token:claimed.lease_token, p_result:delivery.result, p_provider_id:delivery.providerId || null,
    });
    checked++;
    if (stored && delivery.result === 'accepted') accepted++;
  }
  return { checked, accepted, skipped };
}
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control','no-store');
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({ error:'Method not allowed' });
  if (!process.env.CRON_SECRET) return res.status(503).json({ error:'Cart reminder worker is not configured' });
  if (!authorized(req,process.env.CRON_SECRET)) return res.status(401).json({ error:'Unauthorized' });
  try {
    const result = await dispatchCartReminders();
    console.info('[cart reminders]', JSON.stringify({ status:'complete', ...result }));
    return res.status(200).json({ ok:true, ...result });
  } catch {
    // Never log recipient addresses, message bodies, provider responses or keys.
    console.info('[cart reminders]', JSON.stringify({ status:'interrupted' }));
    return res.status(503).json({ error:'Cart reminder work did not finish; the next run will retry safely' });
  }
};
module.exports._private = { authorized, dispatchCartReminders };
