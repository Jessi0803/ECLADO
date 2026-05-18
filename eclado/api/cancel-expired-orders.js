const DEFAULT_SUPABASE_URL = 'https://ilvdvlkdpntwmaijncaz.supabase.co';
const EXPIRE_HOURS = Number(process.env.ORDER_PAYMENT_EXPIRE_HOURS || 24);

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

  const expected = `Bearer ${secret}`;
  if (getAuthHeader(req) === expected) return true;

  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

async function supabaseRequest(path, options = {}) {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_KEY not set');
  }

  const { returnRepresentation, ...fetchOptions } = options;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    ...(fetchOptions.headers || {}),
  };

  if (options.returnRepresentation) {
    headers.Prefer = 'return=representation';
  }

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

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!requireCronAuth(req, res)) return;

  const expireMs = EXPIRE_HOURS * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - expireMs).toISOString();
  const statuses = ['awaiting_confirm', 'unpaid'];

  try {
    const query = [
      `status=in.(${statuses.join(',')})`,
      `created_at=lt.${encodeURIComponent(cutoff)}`,
      'select=id,status,created_at,total,member',
      'order=created_at.asc',
    ].join('&');

    const expiredOrders = await supabaseRequest(`orders?${query}`, {
      method: 'GET',
    });

    if (!expiredOrders.length) {
      return res.status(200).json({
        ok: true,
        cancelled: 0,
        cutoff,
        message: 'No expired unpaid orders',
      });
    }

    const ids = expiredOrders.map(order => order.id);
    const updateQuery = [
      `id=in.(${ids.map(encodeURIComponent).join(',')})`,
      `status=in.(${statuses.join(',')})`,
      `created_at=lt.${encodeURIComponent(cutoff)}`,
    ].join('&');

    const cancelled = await supabaseRequest(`orders?${updateQuery}`, {
      method: 'PATCH',
      returnRepresentation: true,
      body: JSON.stringify({ status: 'cancelled' }),
    });

    return res.status(200).json({
      ok: true,
      cancelled: cancelled.length,
      cutoff,
      orderIds: cancelled.map(order => order.id),
    });
  } catch (error) {
    console.error('[cancel-expired-orders]', error);
    return res.status(500).json({ ok: false, error: error.message || String(error) });
  }
};
