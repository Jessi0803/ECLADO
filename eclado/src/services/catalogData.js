import { supabase } from './supabase.js';

export const PRODUCT_IMAGE_BUCKET = 'product-images';

export function withProductImagePublicUrl(row) {
  const { data } = supabase.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .getPublicUrl(row.storage_path);
  return { ...row, url: data.publicUrl };
}

export async function fetchProductRows() {
  const [productsResult, variantsResult, imagesResult] = await Promise.all([
    supabase
      .from('products')
      .select('*')
      .order('id', { ascending: true }),
    supabase
      .from('product_variants')
      .select('*')
      .order('sort_order', { ascending: true }),
    supabase
      .from('product_images')
      .select('*')
      .order('sort_order', { ascending: true }),
  ]);

  return {
    data: productsResult.data,
    error: productsResult.error,
    variantRows: variantsResult.data,
    variantError: variantsResult.error,
    imageRows: imagesResult.error
      ? []
      : (imagesResult.data || []).map(withProductImagePublicUrl),
    imageError: imagesResult.error,
  };
}
