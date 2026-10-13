const crypto = require('node:crypto');
const { deliverRewardNotice } = require('./_reward-notification-delivery.js');

function authorized(req, secret) {
  const supplied = String(req.headers?.authorization || '').replace(/^Bearer /, '');
  const a = Buffer.from(supplied), b = Buffer.from(secret || '');
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function rpc(name, args, env, fetchImpl) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('configuration');
  const response = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!response.ok) throw new Error('database_request_failed');
  return response.json();
}
async function dispatchRewards({ env = process.env, fetchImpl = fetch, limit = 5 } = {}) {
  if (env.REWARD_BANK_ENCRYPTION_KEYS || env.REWARD_BANK_ACTIVE_KEY_ID) throw new Error('worker_requires_isolated_secrets');
  const recipients = String(env.REWARD_NOTIFICATION_ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
  const jobs = await rpc('claim_reward_notifications', { p_limit: Math.min(5, Math.max(1, limit)), p_admin_emails: recipients, p_email_from: env.ORDER_EMAIL_FROM || null }, env, fetchImpl);
  const results = [];
  for (const job of jobs) {
    const delivery = await deliverRewardNotice(job, { env, fetchImpl });
    const stored = await rpc('complete_reward_notification', { p_id: job.id, p_token: job.lease_token, p_result: delivery.result, p_provider_id: delivery.providerId || null }, env, fetchImpl);
    results.push({ id: job.id, result: delivery.result, stored });
  }
  return { checked: results.length, accepted: results.filter(r => r.result === 'accepted' && r.stored).length };
}
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.CRON_SECRET) return res.status(503).json({ error: 'Worker is not configured' });
  if (!authorized(req, process.env.CRON_SECRET)) return res.status(401).json({ error: 'Unauthorized' });
  if (process.env.REWARD_BANK_ENCRYPTION_KEYS || process.env.REWARD_BANK_ACTIVE_KEY_ID) return res.status(503).json({ error: 'Worker requires an environment without bank decryption keys' });
  const startedAt = new Date().toISOString();
  try {
    if (req.body?.action === 'reconcile') {
      const key = req.body?.requestKey;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key || '')) return res.status(400).json({ error: 'Run request key required' });
      const result = await rpc('run_reward_reconciliation', { p_request_key: key }, process.env, fetch);
      console.info('[reward worker]', JSON.stringify({ action: 'reconcile', startedAt, finishedAt: new Date().toISOString(), status: result.status, checked: result.checked || 0, findings: result.findings || 0 }));
      return res.status(200).json(result);
    }
    if (req.body?.action !== 'dispatch') return res.status(400).json({ error: 'Invalid action' });
    const result = await dispatchRewards();
    console.info('[reward worker]', JSON.stringify({ action: 'dispatch', startedAt, finishedAt: new Date().toISOString(), status: 'complete', ...result }));
    return res.status(200).json(result);
  } catch {
    // Never log the provider response, recipient, request payload or credentials.
    console.info('[reward worker]', JSON.stringify({ action: req.body?.action === 'reconcile' ? 'reconcile' : 'dispatch', startedAt, finishedAt: new Date().toISOString(), status: 'interrupted' }));
    return res.status(503).json({ error: 'Reward background work did not finish; retry with the same run key' });
  }
};
module.exports._private = { dispatchRewards, authorized };
