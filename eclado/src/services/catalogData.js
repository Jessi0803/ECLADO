import { supabase } from './supabase.js';

export async function fetchProductRows() {
  const productsResult = await supabase
    .from('products')
    .select('*')
    .order('id', { ascending: true });
  const variantsResult = await supabase
    .from('product_variants')
    .select('*')
    .order('sort_order', { ascending: true });

  return {
    data: productsResult.data,
    error: productsResult.error,
    variantRows: variantsResult.data,
    variantError: variantsResult.error,
  };
}
