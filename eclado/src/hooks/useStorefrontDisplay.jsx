import React, { createContext, useContext, useEffect, useState } from 'react';
import { fetchStorefrontDisplay } from '../services/storefrontDisplay.js';
import { subscribeToTables, removeRealtimeChannel } from '../services/realtime.js';

const FulfillmentDisplayContext = createContext(true);
export const useFulfillmentDisplay = () => useContext(FulfillmentDisplayContext);

export function StorefrontDisplayProvider({ children }) {
  // Hide presentation while loading to avoid flashing labels when disabled.
  const [showFulfillment, setShowFulfillment] = useState(false);
  useEffect(() => {
    let disposed = false;
    let request = 0;
    async function load() {
      const current = ++request;
      try {
        const { data, error } = await fetchStorefrontDisplay();
        // Preserve existing behavior if the migration has not been installed.
        if (!disposed && current === request) setShowFulfillment(error ? true : data?.show_fulfillment !== false);
      } catch {
        if (!disposed && current === request) setShowFulfillment(true);
      }
    }
    load();
    let channel;
    try { channel = subscribeToTables('storefront-display', ['storefront_display_settings'], load); } catch { /* Focus refresh remains available. */ }
    const refreshVisible = () => { if (!document.hidden) load(); };
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      disposed = true;
      removeRealtimeChannel(channel);
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, []);
  return <FulfillmentDisplayContext.Provider value={showFulfillment}>{children}</FulfillmentDisplayContext.Provider>;
}
