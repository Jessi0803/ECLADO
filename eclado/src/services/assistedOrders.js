import { supabase } from './supabase.js';
import { SINOPAC_PAYMENT_API, PAYMENT_REQUEST_TIMEOUT_MS } from '../domain/payments.js';

async function rpc(name,args) {
  const {data,error}=await supabase.rpc(name,args);
  if (error) throw error;
  return data;
}
export const createAssistedOrder=(requestKey,payload)=>rpc('create_assisted_order',{p_request_key:requestKey,p_payload:payload});
export const getAssistedRequest=requestKey=>rpc('get_admin_assisted_request',{p_request_key:requestKey});
export const getAssistedLink=orderId=>rpc('get_admin_assisted_link',{p_order_id:orderId});
export function assistedLink(result) {
  // Fragment avoids leaking the bearer credential into access logs/referrers.
  return `${window.location.origin}/order-payment#order=${encodeURIComponent(result.order_id)}&token=${encodeURIComponent(result.link_token)}`;
}
export async function assistedApi(action,{orderNo,linkToken}) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),PAYMENT_REQUEST_TIMEOUT_MS);
  try {
    const response=await fetch(`${SINOPAC_PAYMENT_API}/api/orders/assisted-${action}`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderNo,linkToken}),signal:controller.signal,
    });
    const result=await response.json().catch(()=>({}));
    if (!response.ok || result.ok!==true) throw new Error(result.error || '付款資訊暫時無法讀取，原訂單已保留。');
    return result;
  } finally { clearTimeout(timeout); }
}
