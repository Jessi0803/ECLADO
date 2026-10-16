import { supabase } from './supabase.js';

export async function fetchAccountOrders(userId) {
  return supabase
    .from('orders')
    .select('id, member, items, total, subtotal, discount, shopping_credit_amount, reward_credit_amount, payment_amount, status, fulfillment_method, order_source, transaction_date, date, address, tracking, shipping_carrier, shipped_at, promotion_name, payment_due_at, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
}
