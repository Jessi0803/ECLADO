export const GUEST_ORDER_SESSION_KEY = 'eclado_guest_order_session';

function sanitizeResult(result = {}) {
  const sourceOrder = result.order && typeof result.order === 'object' ? result.order : null;
  const order = sourceOrder ? {
    id: sourceOrder.id,
    status: sourceOrder.status,
    total: sourceOrder.total,
    subtotal: sourceOrder.subtotal,
    discount: sourceOrder.discount,
    shipping: sourceOrder.shipping,
    promotion_name: sourceOrder.promotion_name,
    items: Array.isArray(sourceOrder.items) ? sourceOrder.items : [],
    payment_due_at: sourceOrder.payment_due_at,
    date: sourceOrder.date,
    created_at: sourceOrder.created_at,
    updated_at: sourceOrder.updated_at,
    tracking: sourceOrder.tracking,
    shipping_carrier: sourceOrder.shipping_carrier,
    shipped_at: sourceOrder.shipped_at,
  } : null;
  return {
    orderNo: String(order?.id || ''),
    lookupCode: String(result.lookupCode || ''),
    guestAccessToken: String(result.guestAccessToken || ''),
    order,
    instruction: result.instruction && typeof result.instruction === 'object'
      ? { ...result.instruction }
      : null,
    paymentState: String(result.paymentState || ''),
    savedAt: new Date().toISOString(),
  };
}

export function saveGuestOrderSession(result) {
  try {
    const record = sanitizeResult(result);
    if (!record.orderNo || !record.guestAccessToken) return false;
    sessionStorage.setItem(GUEST_ORDER_SESSION_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function getGuestOrderSession() {
  try {
    const record = JSON.parse(sessionStorage.getItem(GUEST_ORDER_SESSION_KEY) || 'null');
    if (!record?.orderNo || !record?.guestAccessToken) return null;
    return record;
  } catch {
    return null;
  }
}

export function clearGuestOrderSession() {
  sessionStorage.removeItem(GUEST_ORDER_SESSION_KEY);
}
