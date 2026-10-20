import { ORDER_STATUS_LABELS } from './payments.js';

export const REDEMPTION_STATUS_LABELS={reserved:'購物付款處理中',consumed:'已扣用',released:'已釋放',refunded:'已返還',missing:'需查核（缺少保留紀錄）'};
const cell=value=>{
  let text=String(value??'');
  if(/^[\s]*[=+@\-\t\r\n]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
};
const time=value=>value?new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value)):'';
export function rewardRedemptionCsv(rows){
  const header=['訂單編號','建單時間（台北）','師資會員名稱','訂單總額','購物金支付','返饋金支付（訂單快照）','銀行應付','訂單狀態','返饋金使用狀態','實際已扣用返饋金','已返還返饋金','扣用時間（台北）','返還時間（台北）','最近釋放時間（台北）','付款帳務異常'];
  const lines=rows.map(row=>[row.order_id,time(row.created_at),row.instructor_name,row.total,row.shopping_credit_amount,row.reward_credit_amount,row.payment_amount,
    ORDER_STATUS_LABELS[row.order_status]||row.order_status,REDEMPTION_STATUS_LABELS[row.redemption_status]||row.redemption_status,
    row.consumed_amount,row.refunded_amount,time(row.consumed_at),time(row.refunded_at),time(row.released_at),row.payment_exception?'需查核':'無']);
  return '\uFEFF'+[header,...lines].map(line=>line.map(cell).join(',')).join('\r\n')+'\r\n';
}
