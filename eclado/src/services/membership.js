import { getMemberRole } from '../domain/catalog.jsx';
import {
  LOGIN_NOTICE_KEY,
  POST_LOGIN_PAGE_KEY,
  PROFESSIONAL_LOGIN_NOTICE,
} from '../app/authSession.js';
import { supabase } from './supabase.js';
import { normalizeBackofficeAccess } from '../admin/domain/access.js';

export async function getBackofficeAccess() {
  const { data, error } = await supabase.rpc('get_my_backoffice_access');
  if (error) {
    console.error('[backoffice-access]', error);
    return normalizeBackofficeAccess(null);
  }
  return normalizeBackofficeAccess(data);
}

export async function checkBackofficeAccess() {
  const access = await getBackofficeAccess();
  return access.permissions.length > 0;
}

export async function checkAdminAccess() {
  const { data, error } = await supabase.rpc('is_eclado_admin');
  if (error) {
    console.error('[admin-access]', error);
    return false;
  }
  return data === true;
}

export function openAdmin() {
  window.location.href = '/admin';
}

export async function fetchMemberProfile(userId) {
  return supabase
    .from('profiles')
    .select('role, line_user_id, name')
    .eq('id', userId)
    .single();
}

export async function hasProfessionalApplication(userId) {
  const { data } = await supabase
    .from('professional_applications')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

export async function fetchLatestProApplication(userId) {
  if (!userId) return null;
  const { data } = await supabase
    .from('professional_applications')
    .select('status')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function goProfessionalApply(user, setPage) {
  if (!user?.uid) {
    sessionStorage.setItem(POST_LOGIN_PAGE_KEY, 'professional-apply');
    sessionStorage.setItem(LOGIN_NOTICE_KEY, PROFESSIONAL_LOGIN_NOTICE);
    setPage('login');
    return;
  }
  const role = getMemberRole(user);
  if (['pro', 'instructor', 'distributor'].includes(role)) {
    setPage('account');
    return;
  }
  if (role === 'pending') {
    setPage('account');
    return;
  }
  const app = await fetchLatestProApplication(user.uid);
  if (app?.status === 'pending') {
    setPage('account');
    return;
  }
  setPage('professional-apply');
}
