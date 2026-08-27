import { supabase } from './supabase.js';

export const PRODUCT_IMAGE_BUCKET = 'product-images';

export function getProductImagePublicUrl(storagePath) {
  if (!storagePath) return '';
  const { data } = supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .getPublicUrl(storagePath);
  return data.publicUrl;
}

export function withProductImagePublicUrl(row) {
  return { ...row, url: getProductImagePublicUrl(row.storage_path) };
}

export async function fetchProductRows() {
  const result = await supabase.rpc('get_storefront_catalog');
  const payload = result.data || {};

  return {
    data: payload.products || [],
    error: result.error,
    variantRows: payload.variants || [],
    variantError: result.error,
    imageRows: result.error
      ? []
      : (payload.images || []).map(withProductImagePublicUrl),
    imageError: result.error,
  };
}
