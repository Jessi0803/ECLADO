import { useEffect, useRef, useState } from 'react';
import {
  applyVariantToProduct,
  getCartKey,
  getProductVariants,
  getVariantForCartItem,
  groupProductImages,
  groupProductVariants,
  isProfessionalMember,
  mergeProductsWithStock,
} from '../domain/catalog.jsx';
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

    async function loadProducts() {
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
      if (!alive) return;
      const eventVariantMap = groupProductVariants(eventVariantRows);
      const eventImageMap = eventError ? null : groupProductImages(eventImageRows);
      const loadedEventProducts = eventError
        ? []
        : mergeProductsWithStock(eventData || [], eventVariantMap, eventImageMap, { includeInactive: true });
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
      const loadedProducts = mergeProductsWithStock(data || [], variantMap, imageMap);
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
        if (!product || (product.isProOnly && !isProfessionalMember(user))) {
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
        ['products', 'product_variants', 'product_images'],
        loadProducts,
      );
    } catch (error) {
      console.warn('[ECLADO] products Realtime 訂閱失敗（不影響讀取）', error);
    }

    return () => {
      alive = false;
      removeRealtimeChannel(channel);
    };
  }, [authReady, includeEventCatalog, user?.role, setCart]);

  return {
    products,
    eventProducts,
    status,
    eventStatus,
    errorText,
    eventErrorText: eventStatus === 'error' ? '活動商品資料暫時無法載入，請稍後重新整理。' : '',
  };
}
