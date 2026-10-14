const DEFAULT_SUPABASE_URL = 'https://ilvdvlkdpntwmaijncaz.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_BasrQNdstdbX_InrQWmCuw_Jb1Lscnl';
const PRODUCTION_SUPABASE_PROJECT_REF = 'ilvdvlkdpntwmaijncaz';
const DEFAULT_PAYMENT_API_URL = 'https://pay.ecladotaiwan.com';
const DEFAULT_PAYMENT_NOTIFY_URL = 'https://ecladotaiwan.com/api/sinopac/notify';

const environment = String(import.meta.env.VITE_ECLADO_ENV || 'production').trim().toLowerCase();
const isProduction = environment === 'production';
const configuredSupabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
const configuredSupabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
const paymentMode = String(import.meta.env.VITE_PAYMENT_MODE || (isProduction ? 'live' : '')).trim().toLowerCase();

if (!isProduction && (!configuredSupabaseUrl || !configuredSupabaseAnonKey)) {
  throw new Error('非正式環境必須明確設定 VITE_SUPABASE_URL 與 VITE_SUPABASE_ANON_KEY。');
}

if (!isProduction && configuredSupabaseUrl.includes(PRODUCTION_SUPABASE_PROJECT_REF)) {
  throw new Error('非正式環境不得連線正式 Supabase project。');
}

if (!isProduction && !['disabled', 'mock'].includes(paymentMode)) {
  throw new Error('非正式環境的 VITE_PAYMENT_MODE 必須明確設為 disabled 或 mock。');
}

export const ECLADO_ENVIRONMENT = environment;
export const IS_NON_PRODUCTION = !isProduction;
export const ENVIRONMENT_LABEL = String(import.meta.env.VITE_ENVIRONMENT_LABEL || 'TEST').trim();
export const SUPABASE_URL = configuredSupabaseUrl || DEFAULT_SUPABASE_URL;
export const SUPABASE_ANON_KEY = configuredSupabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY;
export const PAYMENT_MODE = paymentMode;
export const PAYMENT_ENABLED = paymentMode !== 'disabled';
export const PAYMENT_API_URL = String(import.meta.env.VITE_PAYMENT_API_URL || DEFAULT_PAYMENT_API_URL).trim().replace(/\/$/, '');
export const PAYMENT_NOTIFY_URL = String(import.meta.env.VITE_PAYMENT_NOTIFY_URL || DEFAULT_PAYMENT_NOTIFY_URL).trim();
export const LINE_LOGIN_ENABLED = String(import.meta.env.VITE_LINE_LOGIN_ENABLED ?? (isProduction ? 'true' : 'false')).trim().toLowerCase() === 'true';

export function assertPaymentEnabled() {
  if (!PAYMENT_ENABLED) {
    throw new Error('測試環境尚未啟用隔離付款服務，不會建立付款單或連線正式金流。');
  }
}
