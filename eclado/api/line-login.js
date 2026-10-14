const crypto = require('crypto');
const { resolveSiteUrl } = require('./_supabase-env.js');

const LINE_CHANNEL_ID = '2010106039';
const LINE_STATE_COOKIE = 'eclado_line_oauth_state';
const LINE_STATE_MAX_AGE_SECONDS = 10 * 60;

module.exports = function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method Not Allowed');
  }
  if (String(process.env.LINE_LOGIN_ENABLED || 'true').toLowerCase() !== 'true') {
    return res.status(404).send('Not Found');
  }
  const siteUrl = resolveSiteUrl(req);
  const lineRedirectUri = `${siteUrl}/api/line-callback`;

  const state = crypto.randomBytes(32).toString('base64url');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader(
    'Set-Cookie',
    `${LINE_STATE_COOKIE}=${state}; Path=/api/line-callback; HttpOnly; Secure; SameSite=Lax; Max-Age=${LINE_STATE_MAX_AGE_SECONDS}`,
  );

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: LINE_CHANNEL_ID,
    redirect_uri: lineRedirectUri,
    state,
    scope: 'profile openid email',
    bot_prompt: 'aggressive',
  });
  return res.redirect(`https://access.line.me/oauth2/v2.1/authorize?${params}`);
};

module.exports.LINE_STATE_COOKIE = LINE_STATE_COOKIE;
