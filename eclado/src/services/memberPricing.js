import { supabase } from './supabase.js';

export function fetchMemberPricingSettings() {
  return supabase.rpc('get_admin_member_pricing');
}

export function saveMemberPricingSettings(multipliers, expectedMultipliers) {
  return supabase.rpc('save_member_pricing', {
    p_multipliers: multipliers,
    p_expected_multipliers: expectedMultipliers,
  });
}
