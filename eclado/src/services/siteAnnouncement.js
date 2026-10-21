import { supabase } from './supabase.js';

export const EMPTY_ANNOUNCEMENT = { content:'', enabled:false };
export const fetchSiteAnnouncement = () => supabase.from('site_announcement').select('content,enabled').eq('id', true).maybeSingle();
export const saveSiteAnnouncement = (content, enabled) => supabase.rpc('save_site_announcement', { p_content:content.trim(), p_enabled:enabled });
export const isAnnouncementVisible = announcement => announcement?.enabled === true && Boolean(announcement.content?.trim());
