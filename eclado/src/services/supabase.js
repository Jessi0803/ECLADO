import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ilvdvlkdpntwmaijncaz.supabase.co';
const SUPABASE_ANON = 'sb_publishable_BasrQNdstdbX_InrQWmCuw_Jb1Lscnl';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { detectSessionInUrl: true, persistSession: true },
});

window.supabase = supabase;
