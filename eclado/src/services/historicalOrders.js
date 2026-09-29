import { supabase } from './supabase.js';

export async function createHistoricalOrder({ memberId, transactionDate, items, note }) {
  const { data, error } = await supabase.rpc('create_historical_order', {
    p_member_id: memberId,
    p_transaction_date: transactionDate,
    p_items: items.map(item => ({
      variant_id: Number(item.variantId),
      qty: Number(item.quantity),
      unit_price: Number(item.unitPrice),
    })),
    p_admin_note: note || null,
  });
  return { data, error };
}
