import { useEffect, useState } from 'react';
import {
  buildSalesStats,
  emptySalesStats,
} from '../domain/sales.js';
import {
  removeRealtimeChannel,
  subscribeToTables,
} from '../services/realtime.js';
import { fetchSalesStats } from '../services/salesData.js';

export default function useSalesStats() {
  const [salesStats, setSalesStats] = useState(emptySalesStats);

  useEffect(() => {
    let alive = true;

    async function loadSalesStats() {
      const { data, error } = await fetchSalesStats();
      if (!alive) return;
      if (error) {
        console.warn(
          '[ECLADO] 無法載入熱門商品銷售統計（改用商品清單 fallback）：',
          error.message || error,
        );
        setSalesStats(emptySalesStats());
        return;
      }
      setSalesStats(buildSalesStats(data || []));
    }

    loadSalesStats();
    let channel = null;
    try {
      channel = subscribeToTables(
        'popular-products-realtime',
        ['orders'],
        loadSalesStats,
      );
    } catch (error) {
      console.warn('[ECLADO] popular products Realtime 訂閱失敗（不影響讀取）', error);
    }

    return () => {
      alive = false;
      removeRealtimeChannel(channel);
    };
  }, []);

  return salesStats;
}
