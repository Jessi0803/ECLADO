import { supabase } from './supabase.js';

export async function fetchAccountOrders(userId) {
  return supabase
    .from('orders')
    .select('id, member, items, total, subtotal, discount, status, date, address, tracking, promotion_name, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
}
