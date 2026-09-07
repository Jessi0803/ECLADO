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

export async function fetchProductRows({ includeEventCatalog = false } = {}) {
  const [result, eventResult] = await Promise.all([
    supabase.rpc('get_storefront_catalog'),
    includeEventCatalog
      ? supabase.rpc('get_event_catalog')
      : Promise.resolve({ data: { products: [], variants: [], images: [] }, error: null }),
  ]);
  const payload = result.data || {};
  const eventPayload = eventResult.data || {};

  return {
    data: payload.products || [],
    error: result.error,
    variantRows: payload.variants || [],
    variantError: result.error,
    imageRows: result.error
      ? []
      : (payload.images || []).map(withProductImagePublicUrl),
    imageError: result.error,
    eventData: eventPayload.products || [],
    eventError: eventResult.error,
    eventVariantRows: eventPayload.variants || [],
    eventImageRows: eventResult.error
      ? []
      : (eventPayload.images || []).map(withProductImagePublicUrl),
  };
}
