import { supabase } from './supabase.js';

export async function fetchPromotions() {
  let result = await supabase
    .from('promotions')
    .select('*')
    .order('created_at', { ascending: false });

  if (result.error) {
    result = await supabase.from('promotions').select('*');
  }

  return result;
}
