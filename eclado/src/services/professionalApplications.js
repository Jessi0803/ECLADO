import { supabase } from './supabase.js';

export async function createProfessionalApplication(application) {
  const result = await supabase.rpc('submit_professional_application', {
    p_studio_name: application.studio_name,
    p_contact_name: application.contact_name,
    p_phone: application.phone,
    p_address: application.address,
    p_social_media: application.social_media,
    p_certificate: application.certificate,
  });
  if (result.error || !result.data) return result;

  try {
    const { data } = await supabase.auth.getSession();
    const accessToken = data?.session?.access_token;
    if (!accessToken) throw new Error('Authenticated session unavailable');
    const response = await fetch('/api/professional-application-admin-notice', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ applicationId:result.data }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.error || `HTTP ${response.status}`);
    }
  } catch (error) {
    // The application is authoritative and must remain successful even if the
    // administrator email provider is temporarily unavailable.
    console.error('[professional application admin notice]', error.message || String(error));
  }

  return result;
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
