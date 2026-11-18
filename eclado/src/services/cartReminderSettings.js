import { supabase } from './supabase.js';
import config from '../config/cartReminder.json';

export { config as cartReminderConfig };
export const previewCartReminder = content => String(content).replaceAll(config.placeholder, config.cartUrl);
export const fetchCartReminderSettings = () => supabase.rpc('get_cart_reminder_settings');
export const saveCartReminderSettings = (enabled, content, version) => supabase.rpc('save_cart_reminder_settings', {
  p_enabled: enabled, p_content: content, p_expected_version: version,
});
