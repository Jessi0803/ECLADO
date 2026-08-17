export const PENDING_PAYMENT_KEY = 'eclado_pending_payment';

function sanitizeResponse(response = {}) {
  return {
    Status: String(response.Status || ''),
    Description: String(response.Description || ''),
    TSNo: String(response.TSNo || ''),
    ATMParam: response.ATMParam?.AtmPayNo
      ? { AtmPayNo: String(response.ATMParam.AtmPayNo) }
      : undefined,
  };
}

function sanitizeSummary(summary) {
  if (!summary || typeof summary !== 'object') return null;
  return {
    subtotal: Number(summary.subtotal) || 0,
    discount: Number(summary.discount) || 0,
    finalSubtotal: Number(summary.finalSubtotal) || 0,
    shipping: Number(summary.shipping) || 0,
    total: Number(summary.total) || 0,
    promotion: summary.promotion?.id
      ? { id: summary.promotion.id, name: String(summary.promotion.name || '') }
      : null,
    items: Array.isArray(summary.items)
      ? summary.items.map(item => ({ ...item }))
      : [],
  };
}

export function savePendingPayment(payment) {
  try {
    const record = {
      version: 2,
      orderNo: String(payment.orderNo || ''),
      paymentToken: String(payment.paymentToken || ''),
      accessType: String(payment.accessType || (payment.paymentToken ? 'token' : '')),
      guestAccessToken: String(payment.guestAccessToken || ''),
      lookupCode: String(payment.lookupCode || ''),
      orderEmailSent: typeof payment.orderEmailSent === 'boolean' ? payment.orderEmailSent : null,
      amount: Number(payment.amount) || 0,
      method: String(payment.method || ''),
      methodLabel: String(payment.methodLabel || ''),
      paymentLink: String(payment.paymentLink || ''),
      paymentDeadline: payment.paymentDeadline || null,
      paymentDueAt: String(payment.paymentDueAt || ''),
      response: sanitizeResponse(payment.response),
      summary: sanitizeSummary(payment.summary),
      createdAt: payment.createdAt || new Date().toISOString(),
    };
    const hasAccess = record.paymentToken
      || record.accessType === 'member'
      || (record.accessType === 'guest' && record.guestAccessToken);
    if (!record.orderNo || !hasAccess) return false;
    sessionStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

export function getPendingPayment(orderNo = '') {
  try {
    const payment = JSON.parse(sessionStorage.getItem(PENDING_PAYMENT_KEY) || 'null');
    const hasAccess = payment?.paymentToken
      || payment?.accessType === 'member'
      || (payment?.accessType === 'guest' && payment?.guestAccessToken);
    if (!payment?.orderNo || !hasAccess) return null;
    if (orderNo && payment.orderNo !== orderNo) return null;
    return payment;
  } catch {
    return null;
  }
}

export function clearPendingPayment() {
  sessionStorage.removeItem(PENDING_PAYMENT_KEY);
}
