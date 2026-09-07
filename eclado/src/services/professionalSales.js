import { supabase } from './supabase.js';

export async function fetchMyProfessionalSales() {
  return supabase.rpc('get_my_professional_sales');
}

export async function fetchAdminProfessionalSales() {
  return supabase.rpc('get_admin_professional_sales');
}

export async function updateMemberRoleWithMembership(memberId, role, effectiveOn = null) {
  return supabase.rpc('set_member_role_with_membership', {
    p_member_id: memberId,
    p_role: role,
    p_effective_on: effectiveOn,
    p_change_reason: 'admin_member_role_change',
  });
}
