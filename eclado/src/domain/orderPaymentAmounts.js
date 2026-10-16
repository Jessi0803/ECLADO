// The order total is the gross snapshot. Both wallet credits are tenders, so the
// amount sent to the bank must be read from the immutable payment snapshot.
export function getOrderPaymentAmounts(order) {
  const total = Number(order?.total);
  const shoppingCreditAmount = Number(order?.shopping_credit_amount ?? 0);
  const rewardCreditAmount = Number(order?.reward_credit_amount ?? 0);
  const paymentAmount = Number(order?.payment_amount ?? (shoppingCreditAmount || rewardCreditAmount ? NaN : total));
  if (!Number.isFinite(total) || total <= 0
    || !Number.isFinite(shoppingCreditAmount) || shoppingCreditAmount < 0
    || !Number.isFinite(rewardCreditAmount) || rewardCreditAmount < 0
    || !Number.isFinite(paymentAmount) || paymentAmount < 1
    || Math.abs(total - shoppingCreditAmount - rewardCreditAmount - paymentAmount) > 0.001) {
    throw new Error('訂單付款金額與購物金資料不一致，請勿付款並聯繫客服確認。');
  }
  return { total, shoppingCreditAmount, rewardCreditAmount, paymentAmount };
}
