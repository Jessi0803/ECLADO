import {supabase} from './supabase.js';
async function query(name,args){
  const {data,error}=await supabase.rpc(name,args);
  if(error)throw error;
  return data;
}
export const getMyInstructorRewards=(offset=0,ledgerOffset=0)=>query('get_my_instructor_reward_report',{
  p_offset:offset,p_limit:20,p_ledger_offset:ledgerOffset,
});
export const getAdminInstructorRewards=(id,offset=0,ledgerOffset=0)=>query('get_admin_instructor_reward_report',{
  p_instructor_id:id,p_offset:offset,p_limit:20,p_ledger_offset:ledgerOffset,
});
export const getAdminRewardAccounts=(offset=0)=>query('get_admin_instructor_reward_accounts',{p_offset:offset,p_limit:20});

export const getMyRewardCredit=()=>query('get_my_reward_credit',{});
