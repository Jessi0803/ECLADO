const crypto = require('crypto');

const LINE_CHANNEL_ID = '2010106039';
const SITE_URL = 'https://ecladotaiwan.com';
const LINE_REDIRECT_URI = `${SITE_URL}/api/line-callback`;
const LINE_STATE_COOKIE = 'eclado_line_oauth_state';
const LINE_STATE_MAX_AGE_SECONDS = 10 * 60;

module.exports = function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method Not Allowed');
  }

  const state = crypto.randomBytes(32).toString('base64url');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader(
    'Set-Cookie',
    `${LINE_STATE_COOKIE}=${state}; Path=/api/line-callback; HttpOnly; Secure; SameSite=Lax; Max-Age=${LINE_STATE_MAX_AGE_SECONDS}`,
  );

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: LINE_CHANNEL_ID,
    redirect_uri: LINE_REDIRECT_URI,
    state,
    scope: 'profile openid email',
    bot_prompt: 'aggressive',
  });
  return res.redirect(`https://access.line.me/oauth2/v2.1/authorize?${params}`);
};

module.exports.LINE_STATE_COOKIE = LINE_STATE_COOKIE;
