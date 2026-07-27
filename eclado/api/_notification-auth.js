const crypto = require('node:crypto');

const DEFAULT_SUPABASE_URL = 'https://ilvdvlkdpntwmaijncaz.supabase.co';
const DEFAULT_SUPABASE_ANON = 'sb_publishable_BasrQNdstdbX_InrQWmCuw_Jb1Lscnl';

function getHeader(req, name) {
  const headers = req?.headers || {};
  return headers[name.toLowerCase()] || headers[name] || '';
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

async function readJson(response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body?.message || body?.error_description || body?.error || text || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}

async function requireNotificationAuthorization(req) {
  const internalKey = process.env.INTERNAL_API_KEY || '';
  const suppliedInternalKey = getHeader(req, 'x-internal-api-key');
  if (internalKey && suppliedInternalKey && safeEqual(suppliedInternalKey, internalKey)) {
    return { ok: true, kind: 'internal' };
  }

  const authorization = getHeader(req, 'authorization');
  if (!String(authorization).startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON;

  try {
    const authHeaders = {
      apikey: anonKey,
      Authorization: authorization,
    };
    const user = await readJson(await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: authHeaders,
    }));
    const isAdmin = await readJson(await fetch(`${supabaseUrl}/rest/v1/rpc/is_eclado_admin`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
      },
      body: '{}',
    }));
    if (isAdmin !== true) {
      return { ok: false, status: 403, error: 'Forbidden' };
    }
    return { ok: true, kind: 'admin', user };
  } catch {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
}

module.exports = {
  requireNotificationAuthorization,
};
