import { supabase } from './supabase.js';

export const EMPTY_ANNOUNCEMENT = { content:'', enabled:false, start_at:null, end_at:null };
export const fetchSiteAnnouncement = () => supabase.from('site_announcement').select('content,enabled,start_at,end_at').eq('id', true).maybeSingle();
export const saveSiteAnnouncement = (content, enabled, startAt, endAt) => supabase.rpc('save_site_announcement_schedule', {
  p_content:content.trim(), p_enabled:enabled, p_start_at:startAt ?? null, p_end_at:endAt ?? null,
});
export { isAnnouncementVisible } from '../domain/siteAnnouncement.js';
