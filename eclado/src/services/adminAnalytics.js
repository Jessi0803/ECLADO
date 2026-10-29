import { supabase } from './supabase.js';

export async function fetchAdminAnalytics(startDate, endDate) {
  const { data, error } = await supabase.rpc('get_admin_analytics', {
    p_start_date: startDate, p_end_date: endDate,
  });
  if (error) throw error;
  if (data?.startDate !== startDate || data?.endDate !== endDate
    || !Array.isArray(data.daily) || !Array.isArray(data.productSales) || !Array.isArray(data.memberRevenue)) {
    throw new Error('營業分析資料格式不正確');
  }
  return data;
}
