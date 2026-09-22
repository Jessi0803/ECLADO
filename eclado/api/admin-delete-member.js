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
    const allowed = await readSupabaseJson(`${supabaseUrl}/rest/v1/rpc/has_backoffice_permission`, {
      method: 'POST',
      headers: jsonHeaders({
        apikey: anonKey,
        Authorization: authorization,
      }),
      body: JSON.stringify({ requested_permission: 'members.write' }),
    });
    if (allowed !== true) {
      return { ok: false, status: 403, error: 'Forbidden' };
    }
    const user = await readSupabaseJson(`${supabaseUrl}/auth/v1/user`, {
      headers: jsonHeaders({
        apikey: anonKey,
        Authorization: authorization,
      }),
    });
    return { ok: true, user };
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

function firstRow(value) {
  return Array.isArray(value) ? (value[0] || null) : null;
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
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(memberId)) {
    return res.status(400).json({ ok: false, error: 'memberId 格式不正確。' });
  }

  if (memberId === admin.user?.id) {
    return res.status(403).json({ ok: false, error: '不可刪除目前登入中的管理員帳號。' });
  }

  try {
    const [actorRows, profiles, targetAdminRows] = await Promise.all([
      serviceRequest(
        supabaseUrl,
        serviceKey,
        `/rest/v1/admin_users?user_id=eq.${encodeURIComponent(admin.user?.id || '')}&select=user_id,role,active`,
      ),
      serviceRequest(
        supabaseUrl,
        serviceKey,
        `/rest/v1/profiles?id=eq.${encodeURIComponent(memberId)}&select=id,name,role`,
      ),
      serviceRequest(
        supabaseUrl,
        serviceKey,
        `/rest/v1/admin_users?user_id=eq.${encodeURIComponent(memberId)}&select=user_id,role,active`,
      ),
    ]);

    const actor = firstRow(actorRows);
    const profile = firstRow(profiles);
    const targetAdmin = firstRow(targetAdminRows);

    if (!actor?.active || !['admin', 'super_admin'].includes(actor.role)) {
      return res.status(403).json({ ok: false, error: '管理員權限已失效，請重新登入。' });
    }
    if (!profile) {
      return res.status(404).json({ ok: false, error: '找不到要刪除的會員資料。' });
    }
    if (targetAdmin) {
      return res.status(403).json({ ok: false, error: '後台人員帳號不可由會員刪除流程移除。' });
    }

    const beforeData = profile;

    await serviceRequest(supabaseUrl, serviceKey, `/auth/v1/admin/users/${encodeURIComponent(memberId)}`, {
      method: 'DELETE',
    });

    let auditLogged = true;
    try {
      await serviceRequest(supabaseUrl, serviceKey, '/rest/v1/audit_logs', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          actor_user_id: admin.user?.id || null,
          actor_email: admin.user?.email || null,
          actor_role: actor.role,
          actor_type: 'admin',
          action: 'profiles.delete',
          entity_type: 'profiles',
          entity_id: memberId,
          before_data: beforeData,
          after_data: null,
          metadata: {
            source: 'admin-delete-member-api',
            target_backoffice_role: targetAdmin?.role || null,
          },
        }),
      });
    } catch (auditError) {
      auditLogged = false;
      console.error('[admin-delete-member:audit]', auditError);
    }

    return res.status(200).json({ ok: true, memberId, auditLogged });
  } catch (error) {
    console.error('[admin-delete-member]', error);
    return res.status(500).json({ ok: false, error: error.message || String(error) });
  }
};
