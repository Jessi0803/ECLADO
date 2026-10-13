import { supabase } from './supabase.js';
async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}
export const getRewardNotifications = offset => rpc('get_admin_reward_notifications', { p_offset: offset });
export const getRewardReconciliation = offset => rpc('get_admin_reward_reconciliation', { p_offset: offset });
export async function runRewardReconciliation(key) {
  const result = await rpc('run_reward_reconciliation', { p_request_key: key });
  if (result.status === 'failed') throw Object.assign(new Error('對帳未完成；異常解除狀態未更新。'), { code: result.error_code || '54000' });
  return result;
}
export const retryRewardNotification = (id, key, newVersion, reason) => rpc('retry_reward_notification', { p_id: id, p_key: key, p_new_version: newVersion, p_reason: reason });
export const sendRewardCorrection = (eventId, key) => rpc('queue_reward_correction_notice', { p_event_id: eventId, p_key: key });
