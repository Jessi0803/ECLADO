import { useEffect, useRef, useState } from 'react';
import {
  applyVariantToProduct,
  getCartKey,
  getProductVariants,
  getVariantForCartItem,
  groupProductImages,
  groupProductVariants,
  canAccessProfessionalCatalog,
  mergeProductsWithStock,
} from '../domain/catalog.jsx';
import { supabase } from '../services/supabase.js';
import { fetchProductRows } from '../services/catalogData.js';
import {
  removeRealtimeChannel,
  subscribeToTables,
} from '../services/realtime.js';

export default function useProducts(user, setCart, authReady = true, includeEventCatalog = false) {
  const [products, setProducts] = useState([]);
  const [eventProducts, setEventProducts] = useState([]);
  const [status, setStatus] = useState('loading');
  const [eventStatus, setEventStatus] = useState('loading');
  const [errorText, setErrorText] = useState('');
  const hasLoadedProducts = useRef(false);

  useEffect(() => {
    let alive = true;
    let loadSequence = 0;

    async function loadProducts() {
      const sequence = ++loadSequence;
      const {
        data,
        error,
        variantRows,
        variantError,
        imageRows,
        imageError,
        eventData,
        eventError,
        eventVariantRows,
        eventImageRows,
      } = await fetchProductRows({ includeEventCatalog });
      if (!alive || sequence !== loadSequence) return;
      let studentPrices = null;
      if (authReady && user?.uid && user?.role === 'pro') {
        const result = await supabase.rpc('get_my_student_product_prices');
        if (!alive || sequence !== loadSequence) return;
        // Older DB without 1C means OFF; network/authorization failures are not OFF.
        if (result.error && !['PGRST202', '42883'].includes(result.error.code)) {
          setErrorText('會員價格暫時無法確認，請重新整理後再結帳。');
          setStatus('error');
          return;
        }
        if (result.data?.enabled === true) studentPrices = result.data.prices;
      }
      const withStudentPrices = list => list.map(product => {
        if (!studentPrices) return product;
        const rows = studentPrices.filter(row => Number(row.product_id) === Number(product.id));
        return { ...product, studentPriceUserId:user.uid,
          studentDefaultVariantId:product.variants?.find(v => v.isDefault)?.id || product.variants?.[0]?.id,
          studentUnitPrices:Object.fromEntries(rows.map(row => [String(row.variant_id), Number(row.unit_price)])) };
      });
      const eventVariantMap = groupProductVariants(eventVariantRows);
      const eventImageMap = eventError ? null : groupProductImages(eventImageRows);
      const loadedEventProducts = eventError
        ? []
        : withStudentPrices(mergeProductsWithStock(eventData || [], eventVariantMap, eventImageMap, { includeInactive: true }));
      setEventProducts(loadedEventProducts);
      setEventStatus(eventError ? 'error' : 'ready');
      if (error) {
        console.error('[ECLADO] 無法載入 products：', error.message, error);
        if (!hasLoadedProducts.current) {
          setProducts([]);
          setStatus('error');
          setErrorText('商品資料暫時無法載入，請稍後重新整理。');
        }
        return;
      }
      if (variantError) {
        console.error('[ECLADO] 無法載入 product_variants：', variantError.message || variantError);
        if (!hasLoadedProducts.current) {
          setProducts([]);
          setStatus('error');
          setErrorText('商品規格暫時無法載入，請稍後重新整理。');
        }
        return;
      }
      const variantMap = groupProductVariants(variantRows);
      if (imageError) {
        console.warn(
          '[ECLADO] 無法載入 product_images（暫用 products 圖片欄位）：',
          imageError.message || imageError,
        );
      }
      const imageMap = imageError ? null : groupProductImages(imageRows);
      const loadedProducts = withStudentPrices(mergeProductsWithStock(data || [], variantMap, imageMap));
      hasLoadedProducts.current = true;
      setProducts(loadedProducts);
      setStatus('ready');
      setErrorText('');
      if (!authReady) return;
      setCart(previous => previous.map(item => {
        const product = [...loadedProducts, ...loadedEventProducts].find(current => (
          Number(current.id) === Number(item.id)
        ));
        if (!product && eventError && item.publicationStatus === 'event_only') return item;
        if (!product || (product.isProOnly && !canAccessProfessionalCatalog(user))) {
          return null;
        }
        const variants = getProductVariants(product);
        const variant = getVariantForCartItem(product, item);
        if ((item.variantId || item.variantSize) && variants.length > 0 && !variant) {
          return null;
        }
        const nextProduct = applyVariantToProduct(product, variant);
        const qty = Math.min(Math.max(Math.floor(Number(item.qty) || 0), 1), 99);
        return { ...nextProduct, cartKey: getCartKey(nextProduct), qty };
      }).filter(Boolean));
    }

    loadProducts();
    let channel = null;
    try {
      channel = subscribeToTables(
        'products-realtime',
        ['products', 'product_variants', 'product_images', 'membership_tiers'],
        loadProducts,
      );
    } catch (error) {
      console.warn('[ECLADO] products Realtime 訂閱失敗（不影響讀取）', error);
    }

    // Refresh prices after returning to the tab, even if Realtime is unavailable.
    const refreshOnFocus = () => loadProducts();
    window.addEventListener('focus', refreshOnFocus);
    const refreshOnVisible = () => { if (document.visibilityState === 'visible') loadProducts(); };
    document.addEventListener('visibilitychange', refreshOnVisible);

    return () => {
      alive = false;
      window.removeEventListener('focus', refreshOnFocus);
      document.removeEventListener('visibilitychange', refreshOnVisible);
      removeRealtimeChannel(channel);
    };
  }, [authReady, includeEventCatalog, user?.uid, user?.role, setCart]);

  return {
    products,
    eventProducts,
    status,
    eventStatus,
    errorText,
    eventErrorText: eventStatus === 'error' ? '活動商品資料暫時無法載入，請稍後重新整理。' : '',
  };
}
