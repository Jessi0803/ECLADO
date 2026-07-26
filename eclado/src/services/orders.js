import { supabase } from './supabase.js';

export async function saveOrder(order) {
  const { error } = await supabase.from('orders').insert(order);
  return error;
}
