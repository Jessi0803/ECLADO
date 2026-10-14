const DEFAULT_SUPABASE_URL = 'https://ilvdvlkdpntwmaijncaz.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_BasrQNdstdbX_InrQWmCuw_Jb1Lscnl';
const PRODUCTION_SUPABASE_PROJECT_REF = 'ilvdvlkdpntwmaijncaz';

function isPreview() {
  return String(process.env.VERCEL_ENV || '').trim().toLowerCase() === 'preview';
}

function resolveSupabaseUrl({ allowVite = false } = {}) {
  const configured = String(
    process.env.SUPABASE_URL || (allowVite ? process.env.VITE_SUPABASE_URL : '') || '',
  ).trim().replace(/\/$/, '');

  if (isPreview() && (!configured || configured.includes(PRODUCTION_SUPABASE_PROJECT_REF))) {
    throw new Error('Preview Supabase isolation is not configured');
  }
  return configured || DEFAULT_SUPABASE_URL;
}

function resolveSupabaseAnonKey({ allowVite = false } = {}) {
  const configured = String(
    process.env.SUPABASE_ANON_KEY || (allowVite ? process.env.VITE_SUPABASE_ANON_KEY : '') || '',
  ).trim();
  if (isPreview() && !configured) {
    throw new Error('Preview Supabase anon key is not configured');
  }
  return configured || DEFAULT_SUPABASE_ANON_KEY;
}

function resolveSiteUrl(req) {
  const configured = String(process.env.PUBLIC_SITE_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const branchUrl = String(process.env.VERCEL_BRANCH_URL || '').trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (isPreview() && branchUrl) return `https://${branchUrl}`;
  if (isPreview()) throw new Error('Preview public site URL is not configured');
  return 'https://ecladotaiwan.com';
}

module.exports = {
  resolveSiteUrl,
  resolveSupabaseAnonKey,
  resolveSupabaseUrl,
};
