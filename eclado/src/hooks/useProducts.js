import { useEffect, useState } from 'react';
import {
  PRODUCTS,
  applyVariantToProduct,
  getCartKey,
  getVariantForCartItem,
  groupProductVariants,
  isProfessionalMember,
  mergeProductsWithStock,
} from '../domain/catalog.jsx';
import { fetchProductRows } from '../services/catalogData.js';
import {
  removeRealtimeChannel,
  subscribeToTables,
} from '../services/realtime.js';

export default function useProducts(user, setCart) {
  const [products, setProducts] = useState(() => (
    PRODUCTS.map(product => ({ ...product, stock: null }))
  ));

  useEffect(() => {
    let alive = true;

    async function loadProducts() {
      const { data, error, variantRows, variantError } = await fetchProductRows();
      if (!alive) return;
      if (error) {
        console.error('[ECLADO] 無法載入 products：', error.message, error);
        setProducts(PRODUCTS.map(product => ({ ...product, stock: null })));
        return;
      }
      if (variantError) {
        console.error('[ECLADO] 無法載入 product_variants：', variantError.message || variantError);
        setProducts([]);
        setCart([]);
        return;
      }
      const variantMap = groupProductVariants(variantRows);
      const loadedProducts = mergeProductsWithStock(PRODUCTS, data || [], variantMap);
      setProducts(loadedProducts);
      setCart(previous => previous.map(item => {
        const product = loadedProducts.find(current => (
          Number(current.id) === Number(item.id)
        ));
        if (!product || (product.isProOnly && !isProfessionalMember(user))) {
          return null;
        }
        const variant = getVariantForCartItem(product, item);
        const nextProduct = applyVariantToProduct(product, variant);
        return { ...nextProduct, cartKey: getCartKey(item), qty: item.qty };
      }).filter(Boolean));
    }

    loadProducts();
    let channel = null;
    try {
      channel = subscribeToTables(
        'products-realtime',
        ['products', 'product_variants'],
        loadProducts,
      );
    } catch (error) {
      console.warn('[ECLADO] products Realtime 訂閱失敗（不影響讀取）', error);
    }

    return () => {
      alive = false;
      removeRealtimeChannel(channel);
    };
  }, [user?.role, setCart]);

  return products;
}
