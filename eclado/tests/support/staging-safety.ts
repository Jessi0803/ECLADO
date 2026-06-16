export const PROD_SUPABASE_PROJECT_REF = 'ilvdvlkdpntwmaijncaz';

export function assertStagingSupabaseUrl(url: string) {
  const host = new URL(url).hostname;
  if (host.includes(PROD_SUPABASE_PROJECT_REF)) {
    throw new Error('Refusing to run staging integration against the production Supabase project.');
  }
}
