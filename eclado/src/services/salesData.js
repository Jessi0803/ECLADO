import { supabase } from './supabase.js';

export async function fetchSalesStats() {
  return supabase.rpc('get_public_sales_stats');
}
