import { supabase } from './supabase.js';
import { optimizeDocumentImageFile } from '../utils/imageOptimization.js';
import { buildRenewalRosterPreview } from '../domain/professionalRenewals.js';

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
  let optimizedImage;
  try {
    optimizedImage = await optimizeDocumentImageFile(file);
  } catch (optimizationError) {
    return { data: null, error: new Error(`獎狀圖片轉換失敗：${optimizationError.message || '請稍後再試'}`) };
  }
  const storagePath = `${userId}/${evidenceId}/award.webp`;
  const upload = await supabase.storage.from(PROFESSIONAL_RENEWAL_EVIDENCE_BUCKET)
    .upload(storagePath, optimizedImage.file, { contentType: 'image/webp', upsert: false });
  if (upload.error) return upload;

  const saved = await supabase.rpc('save_professional_award_evidence', {
    p_evidence_id: null,
    p_student_name: values.studentName,
    p_completed_on: values.completedOn,
    p_award_number: values.awardNumber,
    p_storage_path: storagePath,
    p_original_name: file.name,
    p_mime_type: 'image/webp',
    p_file_size: optimizedImage.file.size,
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

export async function fetchAdminProfessionalRenewalRoster(renewalYear) {
  const result = await supabase.rpc('get_admin_professional_renewal_roster', { p_renewal_year:renewalYear });
  if (!result.error) return { ...result, data:{ ...result.data, migrationReady:true } };
  if (!['PGRST202','42883'].includes(result.error.code)) return result;
  // Existing RLS-protected reads only. Never silently use the old bulk writer.
  async function readAll(table, columns) {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const batch = await supabase.from(table).select(columns).order('id').range(offset, offset + 999);
      if (batch.error) return batch;
      rows.push(...(batch.data || []));
      if ((batch.data || []).length < 1000) return { data:rows, error:null };
    }
  }
  const [profiles, memberships, applications] = await Promise.all([
    readAll('profiles', 'id,name,email,role'),
    readAll('professional_memberships', 'id,user_id,role,started_on,ended_on'),
    fetchAdminProfessionalRenewals(),
  ]);
  const error = profiles.error || memberships.error || applications.error;
  if (error) return { data:null, error };
  return { data:buildRenewalRosterPreview(profiles.data, memberships.data, applications.data || [], renewalYear), error:null };
}

export async function finalizeProfessionalRenewalApplication(applicationId) {
  return supabase.rpc('finalize_professional_renewal_application', { p_application_id:applicationId });
}

export async function downgradeProfessionalRenewalNonapplicant(memberId, renewalYear, reason) {
  return supabase.rpc('downgrade_professional_renewal_nonapplicant', {
    p_member_id:memberId, p_renewal_year:renewalYear, p_reason:reason,
  });
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
