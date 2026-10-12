import { supabase } from './supabase.js';

const rpc = (name, args = {}) => supabase.rpc(name, args);
export const fetchStudentPricingSettings = () => rpc('get_admin_student_pricing_settings');
export const fetchStudentPricingHistory = () => rpc('get_admin_student_pricing_history');
export const saveStudentPricingSettings = (multipliers, version) => rpc('save_student_pricing_settings', {
  p_multipliers: multipliers, p_expected_version: version,
});
export const fetchInstructorStudentMember = memberId => rpc('get_admin_instructor_student_member', {
  p_member_id: memberId,
});
export const saveInstructorStudentType = (instructorId, type, version) => rpc('set_instructor_student_price_type', {
  p_instructor_id: instructorId, p_student_price_type: type || null, p_expected_version: version,
});
export const saveInstructorStudentBinding = ({ studentId, instructorId, bindingId, action }) => rpc('save_instructor_student_binding', {
  p_student_id: studentId, p_instructor_id: instructorId || null,
  p_expected_binding_id: bindingId || null, p_action: action,
});
// Phase 1B query foundations only; storefront pricing does not consume them yet.
export const fetchMyStudentPricingContext = () => rpc('get_my_student_pricing_context');
export const fetchMyInstructorStudents = () => rpc('get_my_instructor_students');
