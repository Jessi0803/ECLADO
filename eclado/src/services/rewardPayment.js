import {supabase} from './supabase.js';
export async function rewardPaymentRequirement(orderId){
  const {data,error}=await supabase.rpc('get_admin_reward_payment_requirement',{p_order_id:orderId});
  if(error){if(error.code==='PGRST202')return {applicable:false};throw error;}
  return data;
}
export async function confirmRewardPayment(orderId){
  const {data,error}=await supabase.rpc('confirm_admin_instructor_reward_payment',{p_order_id:orderId,p_confirmed:true});
  if(error)throw error;
  return data;
}
