import { supabase } from './supabase.js';
import { normalizeMember, normalizeOrder } from '../admin/domain/mappers.js';

export const ADMIN_ORDER_PAGE_SIZE = 50;

export async function fetchAdminOrdersPage({ page, status, inventory, search }, signal) {
  let request = supabase.rpc('get_admin_orders_page', {
    p_page: page, p_page_size: ADMIN_ORDER_PAGE_SIZE,
    p_status: status, p_inventory: inventory, p_search: search,
  });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  if (!data || !Array.isArray(data.orders) || data.orders.length > ADMIN_ORDER_PAGE_SIZE
    || !Number.isInteger(data.page) || data.page < 1 || !Number.isFinite(data.total)
    || !data.statusCounts || !data.inventoryCounts) throw new Error('Invalid orders page response');
  return {
    ...data,
    orders: data.orders.map(row => ({
      ...normalizeOrder(row), memberNote: row.member_note || '', inventoryState: row.inventory_state ?? null,
    })),
  };
}

export async function fetchAdminOrderDetail(orderId, signal) {
  let request = supabase.rpc('get_admin_order_detail', { p_order_id: orderId });
  if (signal) request = request.abortSignal(signal);
  const { data, error } = await request;
  if (error) throw error;
  if (!data?.order || data.order.id !== orderId || !Array.isArray(data.order.items)
    || !Array.isArray(data.order.payment_attempts)) throw new Error('Invalid order detail response');
  return {
    ...normalizeOrder(data.order), memberNote: data.memberNote || '', linkedMemberExists: data.linkedMemberExists === true,
  };
}

// Used only when opening the guest assignment dialog, never for the list startup.
export async function fetchOrderAssignmentMembers() {
  const { data, error } = await supabase.from('profiles').select('id,name,email,phone,role,created_at');
  if (error) throw error;
  return (data || []).map(row => normalizeMember(row, []));
}
