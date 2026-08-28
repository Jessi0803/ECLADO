import { supabase } from './supabase.js';

export async function createAuthoritativeOrder({
  items,
  member,
  address,
  phone,
  email,
  note,
  paymentMethod,
  fulfillmentMethod = 'delivery',
}) {
  const { data, error } = await supabase.rpc('create_order_with_pricing', {
    p_items: items.map(item => ({
      product_id: item.id,
      variant_id: item.variantId || item.variantSize || null,
      qty: item.qty,
    })),
    p_member: member,
    p_address: address,
    p_phone: phone,
    p_email: email,
    p_note: note,
    p_payment_method: paymentMethod,
    p_fulfillment_method: fulfillmentMethod,
  });
  if (error) throw error;
  if (!data?.order_id || !Number.isFinite(Number(data.total))) {
    throw new Error('後端訂單報價格式不完整');
  }
  return {
    ...data,
    subtotal: Number(data.subtotal) || 0,
    discount: Number(data.discount) || 0,
    shipping: Number(data.shipping) || 0,
    total: Number(data.total) || 0,
    items: Array.isArray(data.items) ? data.items : [],
    paymentToken: data.payment_token || '',
    promotion: data.promotion_id ? {
      id: data.promotion_id,
      name: data.promotion_name || '活動優惠',
    } : null,
  };
}
