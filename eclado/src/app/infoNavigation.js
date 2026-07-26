const INFO_SECTION_STORAGE_KEY = 'eclado_info_section';
export function getPendingInfoSection() {
  try { return sessionStorage.getItem(INFO_SECTION_STORAGE_KEY) || ''; } catch { return ''; }
}
export function clearPendingInfoSection() {
  try { sessionStorage.removeItem(INFO_SECTION_STORAGE_KEY); } catch {}
}
export function goInfoSection(section, setPage) {
  try { sessionStorage.setItem(INFO_SECTION_STORAGE_KEY, section); } catch {}
  setPage('info');
  setTimeout(() => window.dispatchEvent(new CustomEvent('eclado-info-section', { detail: { section } })), 0);
}
