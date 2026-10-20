export const INVENTORY_ACTIVE_STATUSES = new Set([
  'paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered',
]);

export function getOrderInventoryState(order) {
  if (order && 'inventoryState' in order) return order.inventoryState;
  if (order?.orderSource === 'historical_manual') return null;
  if (!INVENTORY_ACTIVE_STATUSES.has(order?.status) && !(order?.orderSource==='admin_assisted'&&['unpaid','awaiting_confirm'].includes(order.status))) return null;
  if (!Array.isArray(order.items) || order.items.length === 0) return null;
  if (order.items.some(item => Number(item.inventoryAllocation?.backorderQty) > 0)) return 'backordered';
  if (order.items.every(item => item.inventoryAllocation?.allocatedQty != null)) return 'in_stock';
  return null;
}

