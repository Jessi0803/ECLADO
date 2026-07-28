const SUPABASE_URL = 'https://ilvdvlkdpntwmaijncaz.supabase.co';
const LINE_CHANNEL_ID = '2010106039';
const SITE_URL = 'https://ecladotaiwan.com';
const LINE_REDIRECT_URI = `${SITE_URL}/api/line-callback`;
const LINE_AUTH_REDIRECT_URI = `${SITE_URL}/line-callback`;

module.exports = async function handler(req, res) {
  const { code, error: lineError } = req.query;

  if (lineError || !code) {
    return res.redirect(`${SITE_URL}/login?error=line_denied`);
  }

  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  const loginSecret = process.env.LINE_LOGIN_CHANNEL_SECRET;

  if (!serviceKey || !loginSecret) {
    console.error('[LINE callback] missing env vars');
    return res.redirect(`${SITE_URL}/login?error=config`);
  }

  const sb = (path, opts = {}) =>
    fetch(`${SUPABASE_URL}${path}`, {
      ...opts,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });

  async function readJson(response) {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (err) {
      return { raw: text };
    }
  }

  async function expectOk(response, step) {
    const data = await readJson(response);
    if (!response.ok) {
      console.error(`[LINE callback] ${step} failed`, response.status, data);
      throw new Error(step);
    }
    return data;
  }

  async function getLineEmail(idToken) {
    if (!idToken) return '';
    try {
      const verifyRes = await fetch('https://api.line.me/oauth2/v2.1/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          id_token: idToken,
          client_id: LINE_CHANNEL_ID,
        }),
      });
      const data = await readJson(verifyRes);
      if (!verifyRes.ok) {
        console.warn('[LINE callback] id_token verify failed', verifyRes.status, data);
        return '';
      }
      return (data?.email || '').trim().toLowerCase();
    } catch (err) {
      console.warn('[LINE callback] id_token verify error', err);
      return '';
    }
  }

  try {
    // 1. Exchange code → LINE access token
    const tokenRes = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: LINE_REDIRECT_URI,
        client_id: LINE_CHANNEL_ID,
        client_secret: loginSecret,
      }),
    });
    const tokenData = await expectOk(tokenRes, 'line_token');
    const { access_token, id_token } = tokenData || {};
    if (!access_token) return res.redirect(`${SITE_URL}/login?error=token_failed`);

    // 2. Get LINE profile (userId + displayName)
    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const lineProfile = await expectOk(profileRes, 'line_profile');

    const { userId: lineUserId, displayName } = lineProfile;
    if (!lineUserId) return res.redirect(`${SITE_URL}/login?error=profile_failed`);
    const lineEmail = await getLineEmail(id_token);

    // 3. Find existing profile by line_user_id
    const existing = await expectOk(await sb(
      `/rest/v1/profiles?line_user_id=eq.${lineUserId}&select=id,email`
    ), 'profiles_lookup');

    let email, userId;

    if (existing.length > 0) {
      ({ id: userId, email } = existing[0]);
      // Keep displayName up to date
      await expectOk(await sb(`/rest/v1/profiles?id=eq.${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: displayName }),
      }), 'profiles_update');
    } else {
      const existingByEmail = lineEmail ? await expectOk(await sb(
        `/rest/v1/profiles?email=eq.${encodeURIComponent(lineEmail)}&select=id,email,line_user_id`
      ), 'profiles_email_lookup') : [];

      if (existingByEmail.length > 0) {
        ({ id: userId, email } = existingByEmail[0]);
        email = email || lineEmail;
        await expectOk(await sb(`/rest/v1/profiles?id=eq.${userId}`, {
          method: 'PATCH',
          body: JSON.stringify({ name: displayName, line_user_id: lineUserId }),
        }), 'profiles_link_line');
      } else {
        // 4. New user — create Supabase auth user
        email = lineEmail || `line.${lineUserId}@ecladotaiwan.com`;
        const created = await expectOk(await sb('/auth/v1/admin/users', {
          method: 'POST',
          body: JSON.stringify({ email, email_confirm: true, user_metadata: { full_name: displayName } }),
        }), 'auth_create_user');

        userId = created.id;
        if (!userId) return res.redirect(`${SITE_URL}/login?error=create_failed`);

        // 5. Create profile row
        await expectOk(await sb('/rest/v1/profiles', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({ id: userId, email, name: displayName, line_user_id: lineUserId, role: 'consumer' }),
        }), 'profiles_insert');
      }
    }

    // 6. Generate magic link → auto-login
    const linkData = await expectOk(await sb('/auth/v1/admin/generate_link', {
      method: 'POST',
      body: JSON.stringify({
        type: 'magiclink',
        email,
        options: { redirectTo: LINE_AUTH_REDIRECT_URI },
      }),
    }), 'auth_generate_link');

    const actionLink = linkData.action_link || linkData.properties?.action_link;
    if (!actionLink) return res.redirect(`${SITE_URL}/login?error=link_failed`);

    return res.redirect(actionLink);
  } catch (err) {
    console.error('[LINE callback error]', err);
    return res.redirect(`${SITE_URL}/login?error=server_error`);
  }
};
