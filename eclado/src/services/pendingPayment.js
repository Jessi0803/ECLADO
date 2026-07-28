export const PENDING_PAYMENT_KEY = 'eclado_pending_payment';

export function savePendingPayment(payment) {
  sessionStorage.setItem(PENDING_PAYMENT_KEY, JSON.stringify({
    orderNo: String(payment.orderNo || ''),
    paymentToken: String(payment.paymentToken || ''),
    amount: Number(payment.amount) || 0,
    method: String(payment.method || ''),
    createdAt: new Date().toISOString(),
  }));
}

export function getPendingPayment(orderNo = '') {
  try {
    const payment = JSON.parse(sessionStorage.getItem(PENDING_PAYMENT_KEY) || 'null');
    if (!payment?.orderNo || !payment?.paymentToken) return null;
    if (orderNo && payment.orderNo !== orderNo) return null;
    return payment;
  } catch {
    return null;
  }
}

export function clearPendingPayment() {
  sessionStorage.removeItem(PENDING_PAYMENT_KEY);
}
