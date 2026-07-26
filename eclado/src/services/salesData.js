import { supabase } from './supabase.js';

export async function fetchSalesOrders(statuses) {
  return supabase
    .from('orders')
    .select('status, items')
    .in('status', Array.from(statuses))
    .limit(1000);
}
