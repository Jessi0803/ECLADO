const DEFAULT_SUPABASE_URL = 'https://ilvdvlkdpntwmaijncaz.supabase.co';
const DEFAULT_SUPABASE_ANON = 'sb_publishable_BasrQNdstdbX_InrQWmCuw_Jb1Lscnl';

function getAuthHeader(req) {
  return req.headers.authorization || req.headers.Authorization || '';
}

function jsonHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function readSupabaseJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body?.message || body?.error_description || body?.error || text || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}

async function requireAdmin(req, supabaseUrl, anonKey) {
  const authorization = getAuthHeader(req);
  if (!authorization.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  try {
    const allowed = await readSupabaseJson(`${supabaseUrl}/rest/v1/rpc/is_eclado_admin`, {
      method: 'POST',
      headers: jsonHeaders({
        apikey: anonKey,
        Authorization: authorization,
      }),
      body: '{}',
    });
    if (allowed !== true) {
      return { ok: false, status: 403, error: 'Forbidden' };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, status: 401, error: error.message || 'Unauthorized' };
  }
}

async function serviceRequest(supabaseUrl, serviceKey, path, options = {}) {
  return readSupabaseJson(`${supabaseUrl}${path}`, {
    ...options,
    headers: jsonHeaders({
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      ...(options.headers || {}),
    }),
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'DELETE' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!serviceKey) {
    return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not set' });
  }

  const admin = await requireAdmin(req, supabaseUrl, anonKey);
  if (!admin.ok) {
    return res.status(admin.status).json({ error: admin.error });
  }

  const memberId = String(req.body?.memberId || '').trim();
  if (!memberId) {
    return res.status(400).json({ error: 'memberId required' });
  }

  try {
    await serviceRequest(supabaseUrl, serviceKey, `/auth/v1/admin/users/${encodeURIComponent(memberId)}`, {
      method: 'DELETE',
    });

    return res.status(200).json({ ok: true, memberId });
  } catch (error) {
    console.error('[admin-delete-member]', error);
    return res.status(500).json({ ok: false, error: error.message || String(error) });
  }
};
