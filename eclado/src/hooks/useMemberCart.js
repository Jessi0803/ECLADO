import { useCallback, useEffect, useRef, useState } from 'react';
import { CART_STORAGE_KEY, cartItems, loadStoredCart, saveStoredCart, removePurchasedItems } from '../services/cartStorage.js';
import { MemberCartSync } from '../services/memberCart.js';
import { supabase } from '../services/supabase.js';

export default function useMemberCart(user, authReady) {
  const uid = user?.uid || null;
  const identity = useRef({ uid, authReady });
  identity.current = { uid, authReady };
  const controller = useRef(null);
  const guest = useRef(loadStoredCart());
  const [state, setState] = useState({ uid: undefined, items: guest.current, error: '' });

  useEffect(() => {
    if (!authReady) return;
    if (!uid) {
      guest.current = loadStoredCart();
      setState({ uid: null, items: guest.current, error: '' });
      return;
    }
    const sync = new MemberCartSync({ uid, storage: localStorage,
      rpc: (name, params) => supabase.rpc(name, params),
      onChange: (items, error) => setState({ uid, items, error, loaded: sync.loaded }) });
    controller.current = sync;
    setState({ uid, items: sync.items, error: '' });
    try {
      // Transfer ownership before clearing guest data; retries use the saved ID.
      sync.enqueue(cartItems(loadStoredCart()), 'merge');
      saveStoredCart([]);
      guest.current = [];
    } catch {
      setState({ uid, items: sync.items, error: '瀏覽器無法儲存購物車，請開啟網站儲存空間後重試。' });
    }
    void sync.refresh();
    const refresh = () => { void sync.refresh(); };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    const storage = event => { if (event.key?.startsWith(sync.prefix)) refresh(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', visible);
    const timer = setInterval(refresh, 30000);
    return () => {
      sync.stop();
      controller.current = null;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [uid, authReady]);

  useEffect(() => {
    const storage = event => {
      if (event.key === CART_STORAGE_KEY && !uid && authReady) {
        guest.current = loadStoredCart();
        setState({ uid: null, items: guest.current, error: '' });
      }
    };
    window.addEventListener('storage', storage);
    return () => window.removeEventListener('storage', storage);
  }, [uid, authReady]);

  const setCart = useCallback(updater => {
    if (!authReady || !identity.current.authReady || identity.current.uid !== uid) return;
    if (uid) {
      if (controller.current?.uid !== uid) return;
      try { controller.current.update(updater); }
      catch { setState(previous => ({ ...previous, error: '瀏覽器無法儲存購物車，請開啟網站儲存空間後重試。' })); }
    } else {
      const next = typeof updater === 'function' ? updater(guest.current) : updater;
      guest.current = next;
      saveStoredCart(next);
      setState({ uid: null, items: next, error: '' });
    }
  }, [uid, authReady]);

  const consumeCart = useCallback(purchased => {
    if (!authReady || !identity.current.authReady || identity.current.uid !== uid) return;
    if (!uid) { setCart(previous => removePurchasedItems(previous, purchased)); return; }
    if (controller.current?.uid !== uid) return;
    try { controller.current.enqueue(cartItems(purchased), 'consume'); }
    catch { setState(previous => ({ ...previous, error: '瀏覽器無法儲存購物車，請開啟網站儲存空間後重試。' })); }
  }, [uid, authReady, setCart]);

  return { cart: state.uid === uid ? state.items : [], setCart, consumeCart,
    cartReady: authReady && state.uid === uid && (!uid || state.loaded === true),
    cartSyncError: state.uid === uid ? state.error : '' };
}
