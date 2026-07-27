export function normalizeOrder(row) {
  const items = Array.isArray(row.items) ? row.items : [];
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
    address: row.address,
    phone: row.phone,
    email: row.email,
    note: row.note,
    transferLast5: row.transfer_last5,
    tracking: row.tracking,
    user_id: row.user_id,
    subtotal: row.subtotal,
    discount: row.discount || 0,
    promotionName: row.promotion_name,
    shipping: Number.isFinite(snapshotShipping) ? snapshotShipping : inferredShipping,
    pricingSnapshot: row.pricing_snapshot || null,
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
  };
}

export function normalizeProduct(row, variantRows = null) {
  const variants = Array.isArray(variantRows)
    ? variantRows.map(normalizeProductVariant)
    : (Array.isArray(row.variants) ? row.variants.map(normalizeProductVariant) : []);
  return {
    id: row.id,
    name: row.name || '',
    nameZh: row.name_zh || '',
    category: normalizeProductCategory(row.category, !!row.is_pro_only),
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
    sourceFolderName: row.source_folder_name || '',
    importedFromDrive: !!row.imported_from_drive,
    listImageScale: normalizeProductImageScale(row.product_list_image_scale),
    active: row.active !== false,
  };
}

export function productToRow(product) {
  return {
    name: product.name || '',
    name_zh: product.nameZh || '',
    category: product.category || '',
    size: product.size || '',
    price: Number(product.price) || 0,
    pro_price: Number(product.proPrice) || 0,
    stock: Number(product.stock) || 0,
    min_stock: product.minStock === '' || product.minStock == null ? 3 : Math.max(0, Number(product.minStock) || 0),
    is_pro_only: !!product.isProOnly,
    image_url: product.img || null,
    image_urls: Array.isArray(product.imageUrls) ? product.imageUrls : [],
    description: product.desc || '',
    skin_type: product.skinType || '',
    ingredients: product.ingredients || '',
    features: Array.isArray(product.features) ? product.features : [],
    variants: Array.isArray(product.variants) ? product.variants : [],
    source_folder_name: product.sourceFolderName || null,
    imported_from_drive: !!product.importedFromDrive,
    product_list_image_scale: normalizeProductImageScale(product.listImageScale),
    active: product.active !== false,
  };
}

export function normalizeMember(row, allOrders) {
  const memberOrders = allOrders.filter(order => order.user_id === row.id || order.email === row.email);
  return {
    id: row.id,
    name: row.name || (row.email ? row.email.split('@')[0] : '未命名'),
    email: row.email || '',
    phone: row.phone || '',
    type: row.role || 'consumer',
    cert: row.cert || '',
    joined: row.created_at ? row.created_at.slice(0, 10) : '',
    orders: memberOrders.length,
    total: memberOrders.reduce((sum, order) => sum + (order.total || 0), 0),
  };
}
