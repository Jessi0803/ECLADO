import { supabase } from './supabase.js';

export async function createProfessionalApplication(application) {
  return supabase.from('professional_applications').insert(application);
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
