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


export async function shipShippingGroup(groupId, tracking) {
  const { data, error } = await supabase.rpc('ship_shipping_group', {
    p_group_id: groupId,
    p_tracking: tracking,
  });
  if (error) throw error;
  return {
    groupId: data?.group_id || groupId,
    tracking: data?.tracking || tracking,
    shippedOrderIds: Array.isArray(data?.shipped_order_ids) ? data.shipped_order_ids : [],
    skippedOrderIds: Array.isArray(data?.skipped_order_ids) ? data.skipped_order_ids : [],
  };
}
