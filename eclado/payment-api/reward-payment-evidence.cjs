// Only decrypted/verified bank query responses qualify. Request/body flags and
// status inferred from the local order are deliberately not evidence.
function verifiedRewardPaymentEvidence(payment, providerOrderNo, isPaidLike) {
  const raw=payment?.raw;
  const order=raw?.orderQuery?.OrderList?.[0];
  const result=raw?.payQuery?.TSResultContent;
  const matches=value=>!value || String(value).trim()===String(providerOrderNo).trim();
  if(order && matches(order.OrderNo) && (isPaidLike(order.PayStatus)||isPaidLike(order.PayFlag))) return 'order_query';
  if(result && result.OrderNo && matches(result.OrderNo) && String(result.Status||'').toUpperCase()==='S'
    && ['PayOut','CaptureOut'].includes(result.APType)) return 'pay_query';
  return null;
}
module.exports={verifiedRewardPaymentEvidence};
