import { supabase } from './supabase.js';

export function getSession() {
  return supabase.auth.getSession();
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}

export function signInWithPassword(credentials) {
  return supabase.auth.signInWithPassword(credentials);
}

export function signUp(credentials) {
  return supabase.auth.signUp(credentials);
}

export function requestPasswordReset(email, redirectTo) {
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });
}

export function updatePassword(password) {
  return supabase.auth.updateUser({ password });
}

export function signOut() {
  return supabase.auth.signOut();
}

export function sbError(msg) {
  if (!msg) return '發生錯誤，請再試一次';
  if (msg.includes('Invalid login credentials')) return 'Email 或密碼錯誤';
  if (msg.includes('Email not confirmed')) return '請先驗證您的電子郵件，再登入';
  if (msg.includes('User already registered')) return '此 Email 已被註冊';
  if (msg.includes('Password should be at least')) return '密碼至少需要 6 個字元';
  if (msg.includes('Unable to validate email')) return 'Email 格式不正確';
  if (msg.includes('For security purposes')) return '請稍後再試';
  if (msg.includes('rate limit')) return '寄信次數過多，請稍後再試';
  return msg;
}

export const ECLADO_SITE_ORIGIN = 'https://ecladotaiwan.com';

export function getSiteOrigin() {
  const { hostname, origin } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.vercel.app')) {
    return origin;
  }
  return ECLADO_SITE_ORIGIN;
}

export function getAuthRedirectUrl() {
  return `${getSiteOrigin()}/login`;
}

export function getPasswordResetRedirectUrl() {
  return `${getSiteOrigin()}/reset-password`;
}

export function getUrlAuthParams() {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
  const merged = new URLSearchParams();
  search.forEach((v, k) => merged.set(k, v));
  hash.forEach((v, k) => { if (!merged.has(k)) merged.set(k, v); });
  return merged;
}

export function hasAuthCallbackInUrl() {
  const p = getUrlAuthParams();
  return p.has('code') || p.has('access_token')
    || (p.has('error') && (p.has('error_description') || p.has('error_code')));
}

export function isPasswordRecoveryUrl() {
  const p = getUrlAuthParams();
  const path = (window.location.pathname || '/').replace(/\/$/, '') || '/';
  return path === '/reset-password' || p.get('type') === 'recovery';
}

export function isEmailVerificationCallback() {
  const t = getUrlAuthParams().get('type');
  return t === 'signup' || t === 'email' || t === 'invite';
}

export function getAuthCallbackErrorMessage() {
  const err = getUrlAuthParams().get('error_description') || getUrlAuthParams().get('error');
  if (!err) return '';
  try { return decodeURIComponent(String(err).replace(/\+/g, ' ')); }
  catch { return String(err); }
}

export function cleanAuthCallbackFromUrl(path) {
  const pageKey = path === '/reset-password' ? 'reset-password' : path === '/login' ? 'login' : 'home';
  window.history.replaceState({ page: pageKey }, '', path);
}

export const LINE_LOGIN_ERROR_MESSAGES = {
  line_denied: 'LINE 登入已取消，請重新操作。',
  config: 'LINE 登入設定尚未完成，請聯繫客服。',
  token_failed: 'LINE 授權驗證失敗，請重新登入。',
  profile_failed: '無法取得 LINE 會員資料，請重新登入。',
  create_failed: '無法建立 LINE 會員，請稍後再試。',
  link_failed: 'LINE 會員登入連結建立失敗，請稍後再試。',
  server_error: 'LINE 登入服務暫時無法使用，請稍後再試。',
};

export function getLineLoginErrorMessage() {
  const errorCode = new URLSearchParams(window.location.search).get('error');
  if (!errorCode) return '';
  return LINE_LOGIN_ERROR_MESSAGES[errorCode] || `LINE 登入失敗：${errorCode}`;
}
