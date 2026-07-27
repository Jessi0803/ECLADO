import { supabase } from './supabase.js';

export async function createProfessionalApplication(application) {
  return supabase.rpc('submit_professional_application', {
    p_studio_name: application.studio_name,
    p_contact_name: application.contact_name,
    p_phone: application.phone,
    p_address: application.address,
    p_social_media: application.social_media,
    p_certificate: application.certificate,
  });
}

export async function fetchProfessionalApplicationStatus(userId) {
  return supabase
    .from('professional_applications')
    .select('status')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
}
