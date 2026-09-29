import { supabase } from './supabase.js';

function normalizeShippingGroup(data) {
  if (!data?.id) return null;
  return {
    ...data,
    effectiveTotal: Math.max(0, Number(data.effective_total || 0)),
    originalShippingAmount: Math.max(0, Number(data.original_shipping_amount || 0)),
    validOrderCount: Math.max(0, Number(data.valid_order_count || 0)),
    pendingOrderCount: Math.max(0, Number(data.pending_order_count || 0)),
    freeShipping: data.free_shipping === true,
    shippingRefunded: data.shipping_refunded === true,
  };
}

export async function getMyAppendableShippingGroup() {
  const { data, error } = await supabase.rpc('get_my_appendable_shipping_group');
  if (error) throw error;
  return normalizeShippingGroup(data);
}

