import { useEffect, useRef, useState } from 'react';
import {
  PRODUCTS,
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

export default function useProducts(user, setCart, authReady = true) {
  const [products, setProducts] = useState([]);
  const [status, setStatus] = useState('loading');
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
      } = await fetchProductRows();
      if (!alive) return;
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
      const loadedProducts = mergeProductsWithStock(PRODUCTS, data || [], variantMap, imageMap);
      hasLoadedProducts.current = true;
      setProducts(loadedProducts);
      setStatus('ready');
      setErrorText('');
      if (!authReady) return;
      setCart(previous => previous.map(item => {
        const product = loadedProducts.find(current => (
          Number(current.id) === Number(item.id)
        ));
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
  }, [authReady, user?.role, setCart]);

  return { products, status, errorText };
}
