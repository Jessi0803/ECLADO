import { supabase } from './supabase.js';

export async function fetchAdminDashboard() {
  const { data, error } = await supabase.rpc('get_admin_dashboard');
  if (error) throw error;
  if (!data || !Array.isArray(data.monthlyRevenue) || data.monthlyRevenue.length !== 6
    || !Array.isArray(data.recentOrders) || data.recentOrders.length > 5
    || !Array.isArray(data.lowStock)
    || !Number.isFinite(data.paidOrderCount) || !Number.isFinite(data.pendingApplicationCount)) {
    throw new Error('Invalid dashboard response');
  }
  return data;
}
