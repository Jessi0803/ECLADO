import { useEffect, useState } from 'react';
import { fetchPromotions } from '../services/promotions.js';
import {
  removeRealtimeChannel,
  subscribeToTables,
} from '../services/realtime.js';

export default function usePromotions() {
  const [promotions, setPromotions] = useState([]);
  const [status, setStatus] = useState('loading');
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    async function loadPromotions() {
      setStatus('loading');
      setErrorText('');
      const { data, error } = await fetchPromotions();
      if (error) {
        console.error('[ECLADO] 無法載入 promotions：', error.message, error);
        setPromotions([]);
        setStatus('error');
        setErrorText(error.message || String(error.code || ''));
        return;
      }
      setPromotions(data || []);
      setStatus('ok');
    }

    loadPromotions();
    let channel = null;
    try {
      channel = subscribeToTables(
        'promotions-realtime',
        ['promotions'],
        loadPromotions,
      );
    } catch (error) {
      console.warn('[ECLADO] Realtime 訂閱失敗（不影響讀取）', error);
    }
    return () => removeRealtimeChannel(channel);
  }, []);

  return { promotions, status, errorText };
}
