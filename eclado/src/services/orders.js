import { supabase } from './supabase.js';

function toPricingItems(items) {
  return items.map(item => ({
    product_id: item.id,
    variant_id: item.variantId || item.variant_id || item.variantSize || null,
    qty: item.qty,
  }));
}

function normalizeQuote(data) {
  if (!data || !Number.isFinite(Number(data.total))) {
    throw new Error('後端訂單報價格式不完整');
  }
  return {
    ...data,
    subtotal: Number(data.subtotal) || 0,
    discount: Number(data.discount) || 0,
    shipping: Number(data.shipping) || 0,
    total: Number(data.total) || 0,
    items: Array.isArray(data.items) ? data.items : [],
    promotion: data.promotion_id ? {
      id: data.promotion_id,
      name: data.promotion_name || '活動優惠',
    } : null,
    coupon: data.coupon_campaign_id ? {
      id: data.coupon_campaign_id,
      name: data.coupon_name || '優惠券',
      codeMask: data.coupon_code_mask || '',
    } : null,
    adjustments: Array.isArray(data.adjustments) ? data.adjustments : [],
  };
}

export async function quoteAuthoritativeOrder({
  items,
  fulfillmentMethod = 'delivery',
  couponCode = '',
  email = '',
}) {
  const { data, error } = await supabase.rpc('quote_order_pricing', {
    p_items: toPricingItems(items),
    p_fulfillment_method: fulfillmentMethod,
    p_coupon_code: couponCode,
    p_guest_email: email,
  });
  if (error) throw error;
  return normalizeQuote(data);
}

export async function createAuthoritativeOrder({
  items,
  member,
  address,
  phone,
  email,
  note,
  paymentMethod,
  fulfillmentMethod = 'delivery',
  couponCode = '',
}) {
  const { data, error } = await supabase.rpc('create_order_with_pricing', {
    p_items: toPricingItems(items),
    p_member: member,
    p_address: address,
    p_phone: phone,
    p_email: email,
    p_note: note,
    p_payment_method: paymentMethod,
    p_fulfillment_method: fulfillmentMethod,
    p_coupon_code: couponCode || null,
  });
  if (error) throw error;
  if (!data?.order_id) {
    throw new Error('後端訂單報價格式不完整');
  }
  return { ...normalizeQuote(data), paymentToken: data.payment_token || '' };
}
