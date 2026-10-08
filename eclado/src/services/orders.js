import { supabase } from './supabase.js';

function toPricingItems(items) {
  return items.map(item => ({
    product_id: item.id,
    variant_id: item.variantId || item.variant_id || item.variantSize || null,
    qty: item.qty,
    ...(item.expectedUnitPrice == null ? {} : { expected_unit_price:Number(item.expectedUnitPrice) }),
  }));
}

function normalizeQuote(data) {
  if (!data || !Number.isFinite(Number(data.total))) {
    throw new Error('後端訂單報價格式不完整');
  }
  const shippingGroup = data.shipping_group?.id ? {
    ...data.shipping_group,
    effectiveTotal: Math.max(0, Number(data.shipping_group.effective_total || 0)),
    originalShippingAmount: Math.max(0, Number(data.shipping_group.original_shipping_amount || 0)),
    pendingOrderCount: Math.max(0, Number(data.shipping_group.pending_order_count || 0)),
    shippingRefunded: data.shipping_group.shipping_refunded === true,
  } : null;
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
    shippingGroup,
    isAdditionalOrder: data.is_additional_order === true,
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
  invoiceType = 'personal',
  invoiceCompanyName = '',
  invoiceTaxId = '',
  shoppingCreditAmount = 0,
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
    p_invoice_type: invoiceType,
    p_invoice_company_name: invoiceType === 'company' ? invoiceCompanyName : null,
    p_invoice_tax_id: invoiceType === 'company' ? invoiceTaxId : null,
    p_shopping_credit_amount: shoppingCreditAmount,
  });
  if (error) throw error;
  if (!data?.order_id) {
    throw new Error('後端訂單報價格式不完整');
  }
  return {
    ...normalizeQuote(data),
    shopping_credit_amount: Number(data.shopping_credit_amount) || 0,
    payment_amount: Number(data.payment_amount ?? data.total) || 0,
    paymentToken: data.payment_token || '',
  };
}
