import { supabase } from './supabase.js';

export const PROFESSIONAL_CERTIFICATE_BUCKET = 'professional-certificates';
export const PROFESSIONAL_CERTIFICATE_MAX_FILES = 3;
export const PROFESSIONAL_CERTIFICATE_MAX_SIZE = 5 * 1024 * 1024;
export const PROFESSIONAL_CERTIFICATE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const extensionByType = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function validateProfessionalCertificateFiles(files = []) {
  if (files.length > PROFESSIONAL_CERTIFICATE_MAX_FILES) {
    return `證照圖片最多 ${PROFESSIONAL_CERTIFICATE_MAX_FILES} 張。`;
  }
  for (const file of files) {
    if (!PROFESSIONAL_CERTIFICATE_TYPES.includes(file.type)) {
      return `「${file.name}」格式不支援，請使用 JPG、PNG 或 WebP。`;
    }
    if (!file.size || file.size > PROFESSIONAL_CERTIFICATE_MAX_SIZE) {
      return `「${file.name}」檔案需小於 5 MB。`;
    }
  }
  return '';
}

async function notifyProfessionalApplication(applicationId) {
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
      body: JSON.stringify({ applicationId }),
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
}

export async function createProfessionalApplication(application, certificateFiles = []) {
  const validationError = validateProfessionalCertificateFiles(certificateFiles);
  if (validationError) return { data: null, error: new Error(validationError) };

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const userId = authData?.user?.id;
  if (authError || !userId) {
    return { data: null, error: authError || new Error('登入狀態已失效，請重新登入。') };
  }

  const applicationId = crypto.randomUUID();
  const uploadedPaths = [];
  const certificateMetadata = [];

  for (const file of certificateFiles) {
    const extension = extensionByType[file.type];
    const storagePath = `${userId}/${applicationId}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from(PROFESSIONAL_CERTIFICATE_BUCKET)
      .upload(storagePath, file, {
        cacheControl: '3600',
        contentType: file.type,
        upsert: false,
      });
    if (uploadError) {
      if (uploadedPaths.length) {
        await supabase.storage.from(PROFESSIONAL_CERTIFICATE_BUCKET).remove(uploadedPaths);
      }
      return { data: null, error: new Error(`證照圖片上傳失敗：${uploadError.message || '請稍後再試'}`) };
    }
    uploadedPaths.push(storagePath);
    certificateMetadata.push({
      storage_path: storagePath,
      original_name: file.name,
      mime_type: file.type,
      file_size: file.size,
    });
  }

  const result = await supabase.rpc('submit_professional_application_with_certificates', {
    p_studio_name: application.studio_name,
    p_contact_name: application.contact_name,
    p_phone: application.phone,
    p_address: application.address,
    p_social_media: application.social_media,
    p_certificate: application.certificate,
    p_application_id: applicationId,
    p_certificates: certificateMetadata,
  });
  if (result.error || !result.data) {
    if (uploadedPaths.length) {
      await supabase.storage.from(PROFESSIONAL_CERTIFICATE_BUCKET).remove(uploadedPaths);
    }
    return result;
  }

  await notifyProfessionalApplication(result.data);
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
