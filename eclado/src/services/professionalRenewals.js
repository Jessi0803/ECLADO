import { supabase } from './supabase.js';

export const PROFESSIONAL_RENEWAL_EVIDENCE_BUCKET = 'professional-renewal-evidence';
export const PROFESSIONAL_RENEWAL_MAX_FILE_SIZE = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function validateRenewalEvidenceFile(file) {
  if (!file) return '請選擇獎狀圖片';
  if (!ACCEPTED_TYPES.has(file.type)) return '僅支援 JPG、PNG 或 WebP 圖片';
  if (file.size > PROFESSIONAL_RENEWAL_MAX_FILE_SIZE) return '圖片不可超過 5 MB';
  return '';
}

export async function fetchMyProfessionalRenewal() {
  return supabase.rpc('get_my_professional_renewal');
}

export async function submitProfessionalRenewal() {
  return supabase.rpc('submit_professional_renewal_application');
}

export async function uploadProfessionalAwardEvidence(userId, values, file) {
  const evidenceId = crypto.randomUUID();
  const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const storagePath = `${userId}/${evidenceId}/award.${extension}`;
  const upload = await supabase.storage.from(PROFESSIONAL_RENEWAL_EVIDENCE_BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false });
  if (upload.error) return upload;

  const saved = await supabase.rpc('save_professional_award_evidence', {
    p_evidence_id: evidenceId,
    p_student_name: values.studentName,
    p_completed_on: values.completedOn,
    p_award_number: values.awardNumber,
    p_storage_path: storagePath,
    p_original_name: file.name,
    p_mime_type: file.type,
    p_file_size: file.size,
    p_consent_acknowledged: values.consentAcknowledged,
  });
  if (saved.error) await supabase.storage.from(PROFESSIONAL_RENEWAL_EVIDENCE_BUCKET).remove([storagePath]);
  return saved;
}

export async function deleteProfessionalAwardEvidence(evidence) {
  const result = await supabase.rpc('delete_professional_award_evidence', { p_evidence_id: evidence.id });
  if (!result.error && result.data) {
    await supabase.storage.from(PROFESSIONAL_RENEWAL_EVIDENCE_BUCKET).remove([result.data]);
  }
  return result;
}

export async function createRenewalEvidenceSignedUrl(path, expiresIn = 300) {
  return supabase.storage.from(PROFESSIONAL_RENEWAL_EVIDENCE_BUCKET).createSignedUrl(path, expiresIn);
}

export async function fetchAdminProfessionalRenewals() {
  return supabase.rpc('get_admin_professional_renewals');
}

export async function fetchAdminProfessionalQuarterlyNotices() {
  return supabase.rpc('get_admin_professional_quarterly_notices');
}

export async function finalizeProfessionalRenewalYear(year) {
  return supabase.rpc('finalize_professional_renewal_year', { p_assessment_year: year });
}

export async function reviewProfessionalRenewal(applicationId, decision, reason) {
  return supabase.rpc('review_professional_renewal_application', {
    p_application_id: applicationId,
    p_decision: decision,
    p_reason: reason,
  });
}

export async function reviewProfessionalAwardEvidence(evidenceId, status, reason = '') {
  return supabase.rpc('review_professional_award_evidence', {
    p_evidence_id: evidenceId,
    p_status: status,
    p_reason: reason || null,
  });
}

export async function openProfessionalEvidenceEntryWindow(memberId, year, openedUntil, reason) {
  return supabase.rpc('open_professional_evidence_entry_window', {
    p_member_id: memberId,
    p_assessment_year: year,
    p_opened_until: openedUntil,
    p_reason: reason,
  });
}

export async function createProfessionalQuarterlyNoticeCorrection(memberId, quarterStart, reason) {
  return supabase.rpc('create_professional_quarterly_notice_correction', {
    p_member_id: memberId,
    p_quarter_start: quarterStart,
    p_reason: reason,
  });
}
