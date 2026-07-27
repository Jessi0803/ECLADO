import { supabase } from './supabase.js';

export async function fetchSalesOrders(statuses) {
  const result = await supabase.rpc('get_public_sales_orders');
  if (result.error) return result;
  return {
    ...result,
    data: (result.data || []).filter(order => statuses.has(order.status)),
  };
}
