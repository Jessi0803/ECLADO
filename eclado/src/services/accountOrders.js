import { supabase } from './supabase.js';

export async function fetchAccountOrders(userId) {
  return supabase
    .from('orders')
    .select('id, member, items, total, subtotal, discount, status, date, address, tracking, shipping_carrier, shipped_at, promotion_name, payment_due_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
}
