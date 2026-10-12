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

function verifiedRewardPaymentFailure(payment,providerOrderNo){
  const order=payment?.raw?.orderQuery?.OrderList?.[0];
  if(!order || (order.OrderNo && String(order.OrderNo).trim()!==String(providerOrderNo).trim()))return false;
  return ['F','FAIL','FAILED','ERROR'].includes(String(order.PayStatus||order.PayFlag||'').toUpperCase());
}
module.exports.verifiedRewardPaymentFailure=verifiedRewardPaymentFailure;

function rewardBankAmount(payment,providerOrderNo){
 const raw=payment?.raw;
 for(const result of [raw?.orderQuery?.OrderList?.[0],raw?.payQuery?.TSResultContent]){
  if(result?.OrderNo && String(result.OrderNo).trim()!==String(providerOrderNo).trim())continue;
  for(const key of ['Amount','Amt','Total','PayAmount']){
   if(result?.[key]!=null&&result[key]!==''){const value=Number(String(result[key]).replace(/,/g,''));return Number.isFinite(value)?value:null;}
  }
 }
 return null;
}
module.exports.rewardBankAmount=rewardBankAmount;
