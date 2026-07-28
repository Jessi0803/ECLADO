import { PRODUCTS } from '../data/products.js';
export { PRODUCTS };

export const MEMBER_TIERS = {
  consumer:    { label:'一般會員', badge:'MEMBER', priceLabel:'一般價', multiplier:null },
  pro:         { label:'美容師', badge:'PRO', priceLabel:'專業價', multiplier:1 },
  instructor:  { label:'師資', badge:'師資', priceLabel:'師資價・專業價7折', multiplier:0.7 },
  distributor: { label:'經銷商', badge:'經銷', priceLabel:'經銷價・專業價65折', multiplier:0.65 },
  pending:     { label:'審核中', badge:'審核中', priceLabel:'一般價', multiplier:null },
};

export function getMemberRole(user) {
  return user?.role || (user?.isPro ? 'pro' : 'consumer');
}

export function isProfessionalMember(user) {
  return ['pro', 'instructor', 'distributor'].includes(getMemberRole(user));
}

export function getMemberTier(user) {
  return MEMBER_TIERS[getMemberRole(user)] || MEMBER_TIERS.consumer;
}

export function getMemberPrice(product, user) {
  const tier = getMemberTier(user);
  if (!tier.multiplier) return product.price;
  return Math.round(product.proPrice * tier.multiplier);
}

export function normalizeJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function normalizeProductVariant(variant) {
  return {
    id: variant.id || variant.size || '',
    sku: variant.sku || '',
    size: variant.size || '',
    price: Number(variant.price ?? variant.marketPrice ?? variant.market_price ?? 0),
    proPrice: Number(variant.proPrice ?? variant.pro_price ?? 0),
    stock: variant.stock == null ? null : Number(variant.stock),
    isDefault: !!(variant.isDefault ?? variant.is_default),
    sortOrder: Number(variant.sortOrder ?? variant.sort_order ?? 0),
    active: variant.active !== false,
  };
}

export const PRODUCT_IMAGE_ZOOM_NAMES = new Set([
  '亮白光采霜', '完美潔面卸妝膏', '記憶抗皺眼霜', 'PHA溫和煥膚',
  '急救安瓶-水合複合', '平衡爽膚水', '急救安瓶-積雪草毛孔', '急救安瓶-維他命美白', '亮顏防曬BB霜',
  '乳酸菌亮白面膜', '乳酸菌亮白⾯膜', '保濕補水霜', '精萃凝膠', '氧氣泡泡',
]);

export const PRODUCT_PRIMARY_IMAGE_OVERRIDES = {
  '平衡爽膚水': 1,
};

export const PRODUCT_IMAGE_SCALE_OVERRIDES = {
  '亮白光采霜': 1.24,
  '完美潔面卸妝膏': 1.22,
};

export function normalizeProductImageScale(value) {
  const scale = Number(value);
  return Number.isFinite(scale) && scale > 0 ? scale : null;
}

export function getDefaultProductImageScale(product) {
  return PRODUCT_IMAGE_SCALE_OVERRIDES[product?.nameZh] || (PRODUCT_IMAGE_ZOOM_NAMES.has(product?.nameZh) ? 1.08 : 1);
}

export const PRODUCT_AUTO_IMAGE_TARGETS = { list: 0.78, detail: 0.72 };
export const PRODUCT_IMAGE_BOUNDS_CACHE = new Map();

export function getImageAnalysisSrc(src) {
  const match = String(src || '').match(/drive\.google\.com\/thumbnail\?id=([^&]+)/);
  return match ? 'https://lh3.googleusercontent.com/d/' + match[1] + '=w1000' : src;
}

export function analyzeTransparentImageBounds(src) {
  const analysisSrc = getImageAnalysisSrc(src);
  if (!analysisSrc) return Promise.resolve(null);
  if (PRODUCT_IMAGE_BOUNDS_CACHE.has(analysisSrc)) return PRODUCT_IMAGE_BOUNDS_CACHE.get(analysisSrc);
  const task = new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const naturalWidth = img.naturalWidth || img.width;
        const naturalHeight = img.naturalHeight || img.height;
        if (!naturalWidth || !naturalHeight) return resolve(null);
        const maxScanSize = 360;
        const ratio = Math.min(1, maxScanSize / Math.max(naturalWidth, naturalHeight));
        const width = Math.max(1, Math.round(naturalWidth * ratio));
        const height = Math.max(1, Math.round(naturalHeight * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, width, height);
        const pixels = ctx.getImageData(0, 0, width, height).data;
        let left = width, right = -1, top = height, bottom = -1, transparentPixels = 0;
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const alpha = pixels[(y * width + x) * 4 + 3];
            if (alpha < 12) transparentPixels++;
            if (alpha > 12) {
              if (x < left) left = x;
              if (x > right) right = x;
              if (y < top) top = y;
              if (y > bottom) bottom = y;
            }
          }
        }
        if (right < left || transparentPixels < width * height * 0.02) return resolve(null);
        resolve({
          naturalWidth,
          naturalHeight,
          left: left / ratio,
          top: top / ratio,
          width: (right - left + 1) / ratio,
          height: (bottom - top + 1) / ratio,
        });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = analysisSrc;
  });
  PRODUCT_IMAGE_BOUNDS_CACHE.set(analysisSrc, task);
  return task;
}

export function getProductImage(product, width = 600) {
  const image = getProductImages(product)[0] || '';
  return image.includes('w=600') ? image.replace('w=600', 'w=' + width) : image;
}

export function getProductImages(product) {
  const images = [product?.img, ...normalizeJsonArray(product?.imageUrls)].filter(Boolean);
  const uniqueImages = [...new Set(images)];
  const hasStorageImages = Array.isArray(product?.productImages) && product.productImages.length > 0;
  const primaryIndex = hasStorageImages
    ? undefined
    : PRODUCT_PRIMARY_IMAGE_OVERRIDES[product?.nameZh];
  if (Number.isInteger(primaryIndex) && uniqueImages[primaryIndex]) {
    return [uniqueImages[primaryIndex], ...uniqueImages.filter((_, index) => index !== primaryIndex)];
  }
  return uniqueImages;
}

export function getProductVariants(product) {
  return normalizeJsonArray(product?.variants)
    .map(normalizeProductVariant)
    .filter(variant => variant.size || variant.price || variant.proPrice);
}

export function applyVariantToProduct(product, variant) {
  if (!variant) return product;
  return {
    ...product,
    variantId: variant.id || variant.size || '',
    variantSize: variant.size || '',
    size: variant.size || product.size || '',
    price: variant.price || product.price || 0,
    proPrice: variant.proPrice || product.proPrice || 0,
    stock: variant.stock != null ? variant.stock : product.stock,
  };
}

export function getCartKey(item) {
  return String(item?.cartKey || ((item?.id || '') + ':' + (item?.variantId || item?.variantSize || '')));
}

export function getVariantForCartItem(product, item) {
  const variants = getProductVariants(product);
  return variants.find(variant => (variant.id || variant.size || '') === (item?.variantId || item?.variantSize || '')) || null;
}

export function groupProductVariants(rows) {
  const grouped = (rows || []).reduce((map, row) => {
    if (row.active === false) return map;
    const productId = Number(row.product_id);
    if (!productId) return map;
    const variant = normalizeProductVariant(row);
    if (!map.has(productId)) map.set(productId, []);
    map.get(productId).push(variant);
    return map;
  }, new Map());
  grouped.forEach(variants => variants.sort((left, right) => (
    left.sortOrder - right.sortOrder || String(left.id).localeCompare(String(right.id))
  )));
  return grouped;
}

export function groupProductImages(rows) {
  const grouped = (rows || []).reduce((map, row) => {
    if (row.active === false || !row.url) return map;
    const productId = Number(row.product_id);
    if (!productId) return map;
    const image = {
      id: row.id || row.storage_path,
      storagePath: row.storage_path || '',
      url: row.url,
      altText: row.alt_text || '',
      sortOrder: Number(row.sort_order) || 0,
      isPrimary: row.is_primary === true,
    };
    if (!map.has(productId)) map.set(productId, []);
    map.get(productId).push(image);
    return map;
  }, new Map());
  grouped.forEach(images => images.sort((left, right) => (
    Number(right.isPrimary) - Number(left.isPrimary)
    || left.sortOrder - right.sortOrder
    || String(left.id).localeCompare(String(right.id))
  )));
  return grouped;
}

export function getFulfillmentInfo(product) {
  const rawStock = product?.stock;
  if (rawStock === null || rawStock === undefined || rawStock === '') {
    return {
      type: 'loading',
      label: '載入庫存中',
      shortLabel: '載入中',
      shipping: '',
      note: '商品庫存資料載入中。',
    };
  }
  const stock = Number(rawStock);
  if (Number.isNaN(stock)) {
    return {
      type: 'loading',
      label: '載入庫存中',
      shortLabel: '載入中',
      shipping: '',
      note: '商品庫存資料載入中。',
    };
  }
  if (stock <= 0) {
    return {
      type: 'preorder',
      label: '預購商品',
      shortLabel: '預購',
      shipping: '出貨時間為 7-14 個工作天',
      note: '庫存為 0 仍可下單，將依預購排程出貨。',
    };
  }
  return {
    type: 'in_stock',
    label: '現貨商品',
    shortLabel: '現貨',
    shipping: '出貨時間為 5 個工作天內，每週二出貨',
    note: '現貨商品依每週二出貨排程寄出。',
  };
}

export function mergeProductsWithStock(baseProducts, stockRows, variantMap, imageMap = null) {
  const productMap = new Map(baseProducts.map(product => [Number(product.id), product]));
  return (stockRows || []).filter(row => row.active !== false).map(row => {
    const product = productMap.get(Number(row.id)) || {};
    const rowImages = normalizeJsonArray(row.image_urls).filter(Boolean);
    const fallbackImages = normalizeJsonArray(product.imageUrls).filter(Boolean);
    const storageImages = imageMap?.get(Number(row.id)) || [];
    const legacyImageUrls = rowImages.length ? rowImages : fallbackImages;
    const imageUrls = storageImages.length
      ? storageImages.map(image => image.url)
      : legacyImageUrls;
    const primaryStorageImage = storageImages.find(image => image.isPrimary) || storageImages[0];
    const variantSource = variantMap?.get(Number(row.id)) || [];
    const variants = variantSource
      .map(normalizeProductVariant)
      .filter(variant => variant.active && (variant.size || variant.price || variant.proPrice));
    const primaryVariant = variants.find(variant => variant.isDefault) || variants[0] || null;
    return {
      ...product,
      id: Number(row.id),
      name: row.name || product.name || '',
      nameZh: row.name_zh || product.nameZh || '',
      category: row.category || product.category || '',
      size: primaryVariant?.size || row.size || product.size || '',
      stock: primaryVariant?.stock != null ? primaryVariant.stock : Number(row.stock ?? 0),
      isProOnly: row.is_pro_only != null ? !!row.is_pro_only : product.isProOnly,
      price: primaryVariant?.price || (row.price != null ? Number(row.price) : product.price),
      proPrice: primaryVariant?.proPrice || (row.pro_price != null ? Number(row.pro_price) : product.proPrice),
      img: primaryStorageImage?.url || row.image_url || imageUrls[0] || product.img || '',
      imageUrls,
      productImages: storageImages,
      variants,
      desc: row.description || product.desc || '',
      skinType: row.skin_type || product.skinType || '',
      ingredients: row.ingredients || product.ingredients || '',
      features: Array.isArray(row.features) ? row.features : (product.features || []),
      listImageScale: normalizeProductImageScale(row.product_list_image_scale ?? product.listImageScale),
      active: row.active != null ? row.active : product.active,
    };
  });
}
