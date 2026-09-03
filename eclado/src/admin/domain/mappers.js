import { SALES_COUNTED_STATUSES } from '../../domain/sales.js';

const INVENTORY_ACTIVE_ORDER_STATUSES = new Set([
  'paid',
  'preparing',
  'ready_for_pickup',
  'picked_up',
  'shipped',
  'delivered',
]);

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : null;
}

function normalizeOrderItemInventory(item, orderStatus, canonicalAllocation) {
  const requestedQty = nonNegativeInteger(item.qty) || 0;
  const persisted = canonicalAllocation || (item.inventory_allocation && typeof item.inventory_allocation === 'object'
    ? item.inventory_allocation
    : {});
  const persistedAllocatedQty = nonNegativeInteger(
    persisted.allocated_qty ?? item.allocated_stock_qty,
  );
  const persistedBackorderQty = nonNegativeInteger(
    persisted.backorder_qty ?? item.backorder_qty,
  );

  if (persistedAllocatedQty != null || persistedBackorderQty != null) {
    const allocatedQty = Math.min(
      requestedQty,
      persistedAllocatedQty ?? Math.max(0, requestedQty - persistedBackorderQty),
    );
    const backorderQty = Math.min(
      requestedQty,
      persistedBackorderQty ?? Math.max(0, requestedQty - allocatedQty),
    );
    return {
      state: persisted.state || (backorderQty > 0 ? 'backordered' : 'allocated'),
      requestedQty,
      allocatedQty,
      backorderQty,
      source: 'allocation',
    };
  }

  const stockAtOrder = nonNegativeInteger(item.stock_at_order);
  if (INVENTORY_ACTIVE_ORDER_STATUSES.has(orderStatus) && stockAtOrder != null) {
    const allocatedQty = Math.min(requestedQty, stockAtOrder);
    const backorderQty = Math.max(0, requestedQty - allocatedQty);
    return {
      state: backorderQty > 0 ? 'backordered' : 'allocated',
      requestedQty,
      allocatedQty,
      backorderQty,
      source: 'order_snapshot',
    };
  }

  return {
    state: 'unallocated',
    requestedQty,
    allocatedQty: null,
    backorderQty: null,
    source: 'none',
  };
}

export function normalizeOrder(row) {
  const allocationByIndex = new Map(
    (Array.isArray(row.inventory_allocations) ? row.inventory_allocations : [])
      .map(allocation => [Number(allocation.item_index), allocation]),
  );
  const items = Array.isArray(row.items)
    ? row.items.map((item, index) => ({
      ...item,
      inventoryAllocation: normalizeOrderItemInventory(
        item,
        row.status,
        allocationByIndex.get(index),
      ),
    }))
    : [];
  const itemSubtotal = items.reduce(
    (sum, item) => sum + (Number(item.price ?? item.unit_price) || 0) * (Number(item.qty) || 0),
    0,
  );
  const orderSubtotal = row.subtotal == null ? itemSubtotal : Number(row.subtotal);
  const snapshotShipping = row.pricing_snapshot?.shipping == null
    ? Number.NaN
    : Number(row.pricing_snapshot.shipping);
  const inferredShipping = Math.max(
    0,
    Number(row.total || 0) - (orderSubtotal - Number(row.discount || 0)),
  );
  return {
    id: row.id,
    member: row.member,
    type: row.type,
    items,
    total: row.total,
    status: row.status,
    date: row.date,
    createdAt: row.created_at || null,
    address: row.address,
    phone: row.phone,
    email: row.email,
    note: row.note,
    transferLast5: row.transfer_last5,
    paymentMethod: row.payment_method || '',
    paymentState: row.payment_state || '',
    paymentAttemptCount: Number(row.payment_attempt_count) || 0,
    paymentAttempts: Array.isArray(row.payment_attempts) ? row.payment_attempts : [],
    paymentUpdatedAt: row.payment_updated_at || null,
    providerStatus: row.provider_status || '',
    providerDescription: row.provider_description || '',
    tracking: row.tracking,
    shippingCarrier: row.shipping_carrier || (row.tracking ? 'sf_express' : ''),
    shippedAt: row.shipped_at || null,
    shipmentNotificationSentAt: row.shipment_notification_sent_at || null,
    shipmentNotificationChannel: row.shipment_notification_channel || '',
    shipmentNotificationError: row.shipment_notification_error || '',
    user_id: row.user_id,
    subtotal: row.subtotal,
    discount: row.discount || 0,
    promotionName: row.promotion_name,
    shipping: Number.isFinite(snapshotShipping) ? snapshotShipping : inferredShipping,
    pricingSnapshot: row.pricing_snapshot || null,
    fulfillmentMethod: row.fulfillment_method || row.pricing_snapshot?.fulfillment_method || 'delivery',
  };
}

export function normalizeProductImageScale(value) {
  const scale = Number(value);
  return Number.isFinite(scale) && scale > 0 ? scale : null;
}

export function normalizeProductCategory(value, isProOnly = false) {
  const category = String(value || '').trim();
  if (isProOnly || /院線|課程|儀器|試用包/.test(category)) return '院線課程儀器（含試用包）';
  if (/清潔|卸妝/.test(category)) return '清潔卸妝';
  if (/化妝水/.test(category)) return '化妝水';
  if (/安瓶|精華/.test(category)) return '安瓶精華';
  if (/乳霜|面霜|眼霜/.test(category)) return '乳霜';
  if (/面膜/.test(category)) return '面膜';
  if (/防曬|底妝/.test(category)) return '防曬底妝';
  if (category === '其他') return '其他';
  return category;
}

export function normalizeProductVariant(row, index = 0) {
  return {
    id: row.id == null ? `new-${index}` : String(row.id),
    sku: row.sku || '',
    size: row.size || '',
    price: Number(row.price) || 0,
    proPrice: Number(row.pro_price ?? row.proPrice) || 0,
    stock: Math.max(0, Number(row.stock) || 0),
    isDefault: !!(row.is_default ?? row.isDefault),
    sortOrder: Math.max(0, Number(row.sort_order ?? row.sortOrder) || index),
    active: row.active !== false,
    isCustomOrder: !!(row.is_custom_order ?? row.isCustomOrder),
    procurementUnitCostUsd: row.procurement_unit_cost_usd == null
      ? ''
      : Number(row.procurement_unit_cost_usd),
  };
}

export function normalizeProductImage(row, index = 0) {
  return {
    id: row.id == null ? `new-image-${index}` : String(row.id),
    storagePath: row.storage_path || '',
    url: row.url || '',
    originalName: row.original_name || '',
    altText: row.alt_text || '',
    sortOrder: Math.max(0, Number(row.sort_order) || index),
    isPrimary: !!row.is_primary,
    active: row.active !== false,
    mimeType: row.mime_type || '',
    fileSize: row.file_size == null ? null : Number(row.file_size),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
  };
}

export function normalizeProduct(row, variantRows = null, imageRows = []) {
  const variants = Array.isArray(variantRows)
    ? variantRows.map(normalizeProductVariant)
    : (Array.isArray(row.variants) ? row.variants.map(normalizeProductVariant) : []);
  return {
    id: row.id,
    slug: row.slug || '',
    assetKey: row.asset_key || '',
    name: row.name || '',
    nameZh: row.name_zh || '',
    subtitle: row.subtitle || '',
    category: normalizeProductCategory(row.category, !!row.is_pro_only),
    series: row.series || '',
    size: row.size || '',
    price: Number(row.price) || 0,
    proPrice: Number(row.pro_price) || 0,
    stock: Number(row.stock) || 0,
    minStock: Number(row.min_stock) || 3,
    isProOnly: !!row.is_pro_only,
    img: row.image_url || '',
    imageUrls: Array.isArray(row.image_urls) ? row.image_urls : [],
    desc: row.description || '',
    skinType: row.skin_type || '',
    ingredients: row.ingredients || '',
    features: Array.isArray(row.features) ? row.features : [],
    variants,
    productImages: imageRows.filter(image => image.active !== false).map(normalizeProductImage),
    sourceFolderName: row.source_folder_name || '',
    importedFromDrive: !!row.imported_from_drive,
    listImageScale: normalizeProductImageScale(row.product_list_image_scale),
    publicationStatus: row.publication_status
      || (row.active === false ? 'archived' : 'active'),
    active: row.publication_status
      ? row.publication_status === 'active'
      : row.active !== false,
  };
}

export function orderBelongsToMember(order, memberId) {
  return Boolean(memberId) && order?.user_id === memberId;
}

export function normalizeMember(row, allOrders) {
  const memberOrders = allOrders.filter(order => orderBelongsToMember(order, row.id));
  const completedSales = memberOrders.filter(order => SALES_COUNTED_STATUSES.has(order.status));
  return {
    id: row.id,
    name: row.name || (row.email ? row.email.split('@')[0] : '未命名'),
    email: row.email || '',
    phone: row.phone || '',
    type: row.role || 'consumer',
    cert: row.cert || '',
    joined: row.created_at ? row.created_at.slice(0, 10) : '',
    orders: memberOrders.length,
    total: completedSales.reduce((sum, order) => sum + (Number(order.total) || 0), 0),
  };
}
