import { supabase } from './supabase.js';

export async function getMyShoppingCredit() {
  const { data, error } = await supabase.rpc('get_my_shopping_credit');
  return { data, error };
}

export async function getMemberShoppingCredit(memberId) {
  const { data, error } = await supabase.rpc('get_member_shopping_credit', {
    p_user_id: memberId,
  });
  return { data, error };
}

export async function adjustMemberShoppingCredit({
  memberId,
  direction,
  amount,
  reasonCode,
  internalNote,
  requestId,
}) {
  const { data, error } = await supabase.rpc('adjust_member_shopping_credit', {
    p_user_id: memberId,
    p_direction: direction,
    p_amount: amount,
    p_reason_code: reasonCode,
    p_internal_note: internalNote || null,
    p_request_id: requestId,
  });
  return { data, error };
}
