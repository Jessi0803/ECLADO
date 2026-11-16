import { supabase } from './supabase.js';
import { getProductImagePublicUrl } from './catalogData.js';

export async function fetchStorefrontPromotionGifts() {
  const { data, error } = await supabase.rpc('get_storefront_promotion_gifts');
  if (error) return {};

  const giftsByPromotion = Object.create(null);
  for (const gift of data ?? []) {
    (giftsByPromotion[gift.promotion_id] ??= []).push({
      ...gift,
      imageUrl: getProductImagePublicUrl(gift.image_path) || gift.image_url,
    });
  }
  return giftsByPromotion;
}

export async function fetchPromotions() {
  let result = await supabase
    .from('promotions')
    .select('*')
    .order('created_at', { ascending: false });

  if (result.error) {
    result = await supabase.from('promotions').select('*');
  }

  return result;
}
