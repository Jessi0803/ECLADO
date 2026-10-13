// The order total is the gross snapshot. Shopping credit is a tender, so the
// amount sent to the bank must be read from the immutable payment snapshot.
export function getOrderPaymentAmounts(order) {
  const total = Number(order?.total);
  const shoppingCreditAmount = Number(order?.shopping_credit_amount ?? 0);
  const paymentAmount = Number(order?.payment_amount ?? (shoppingCreditAmount ? NaN : total));
  if (!Number.isFinite(total) || total <= 0
    || !Number.isFinite(shoppingCreditAmount) || shoppingCreditAmount < 0
    || !Number.isFinite(paymentAmount) || paymentAmount < 1
    || Math.abs(total - shoppingCreditAmount - paymentAmount) > 0.001) {
    throw new Error('訂單付款金額與購物金資料不一致，請勿付款並聯繫客服確認。');
  }
  return { total, shoppingCreditAmount, paymentAmount };
}
