import { supabase } from './supabase.js';

export const fetchStorefrontDisplay = () => supabase.from('storefront_display_settings')
  .select('show_fulfillment').eq('id', true).single();
export const saveStorefrontDisplay = showFulfillment => supabase.rpc('save_storefront_display_settings', {
  p_show_fulfillment: showFulfillment,
});
