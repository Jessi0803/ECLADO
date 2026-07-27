export function normalizeOrder(row) {
  return {
    id: row.id,
    member: row.member,
    type: row.type,
    items: row.items || [],
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
  };
}

export function normalizeProductImageScale(value) {
  const scale = Number(value);
  return Number.isFinite(scale) && scale > 0 ? scale : null;
}

export function normalizeProduct(row) {
  return {
    id: row.id,
    name: row.name || '',
    nameZh: row.name_zh || '',
    category: row.category || '',
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
    variants: Array.isArray(row.variants) ? row.variants : [],
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
