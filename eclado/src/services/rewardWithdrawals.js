import {supabase} from './supabase.js';
async function rpc(name,args={}){const {data,error}=await supabase.rpc(name,args);if(error)throw error;return data;}
export const getMyWithdrawals=(offset=0)=>rpc('get_my_reward_withdrawals',{p_offset:offset});
export const quoteMyWithdrawal=()=>rpc('quote_my_reward_withdrawal');
export const requestMyWithdrawal=(key,quote)=>rpc('request_my_reward_withdrawal',{p_request_key:key,p_expected_quote:quote});
export const getAdminWithdrawals=(offset=0)=>rpc('get_admin_reward_withdrawals',{p_offset:offset});
export const manageWithdrawal=(id,key,action,version,details={})=>rpc('manage_reward_withdrawal',{p_id:id,p_event_key:key,p_action:action,p_expected_version:version,p_details:details});
export const publishBankCalendar=(year,holidays,source)=>rpc('publish_reward_bank_calendar',{p_year:year,p_holidays:holidays,p_source_url:source});
export async function bankRequest(action,args={}){
 const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token)throw new Error('請重新登入');
 const response=await fetch('/api/reward-bank',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({action,...args}),cache:'no-store'});
 const data=await response.json();if(!response.ok)throw new Error(data.error||'銀行資料服務無法使用');return data;
}
