import { supabase } from './supabase.js';

export async function fetchSidebarFavorites(userId) {
  return supabase
    .from('admin_preferences')
    .select('sidebar_favorites')
    .eq('user_id', userId)
    .maybeSingle();
}

export async function saveSidebarFavorites(userId, favorites) {
  return supabase
    .from('admin_preferences')
    .upsert({ user_id: userId, sidebar_favorites: favorites }, { onConflict: 'user_id' });
}
