import { useCallback, useEffect, useRef } from 'react';

const PANEL_STATE_KEY = '__ecladoAdminPanel';

export default function usePanelHistory(isOpen, onClose, options = {}) {
  const markerRef = useRef(crypto.randomUUID());
  const activeRef = useRef(false);
  const bypassConfirmRef = useRef(false);
  const isOpenRef = useRef(isOpen);
  const onCloseRef = useRef(onClose);
  const shouldConfirmRef = useRef(!!options.shouldConfirm);
  const confirmMessageRef = useRef(options.confirmMessage || '尚有未儲存的變更，確定離開嗎？');

  isOpenRef.current = isOpen;
  onCloseRef.current = onClose;
  shouldConfirmRef.current = !!options.shouldConfirm;
  confirmMessageRef.current = options.confirmMessage || '尚有未儲存的變更，確定離開嗎？';

  const pushPanelEntry = useCallback(() => {
    window.history.pushState({
      ...(window.history.state || {}),
      [PANEL_STATE_KEY]: markerRef.current,
    }, '', window.location.href);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      if (!activeRef.current || !isOpenRef.current) return;
      if (!bypassConfirmRef.current && shouldConfirmRef.current
        && !window.confirm(confirmMessageRef.current)) {
        pushPanelEntry();
        return;
      }
      bypassConfirmRef.current = false;
      activeRef.current = false;
      onCloseRef.current();
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [pushPanelEntry]);

  useEffect(() => {
    if (isOpen && !activeRef.current) {
      pushPanelEntry();
      activeRef.current = true;
      return;
    }
    if (!isOpen && activeRef.current) {
      const ownsCurrentEntry = window.history.state?.[PANEL_STATE_KEY] === markerRef.current;
      activeRef.current = false;
      bypassConfirmRef.current = false;
      if (ownsCurrentEntry) window.history.back();
    }
  }, [isOpen, pushPanelEntry]);

  return useCallback(() => {
    if (!isOpenRef.current) return true;
    if (shouldConfirmRef.current && !window.confirm(confirmMessageRef.current)) return false;

    const ownsCurrentEntry = window.history.state?.[PANEL_STATE_KEY] === markerRef.current;
    if (ownsCurrentEntry) {
      bypassConfirmRef.current = true;
      window.history.back();
    } else {
      activeRef.current = false;
      onCloseRef.current();
    }
    return true;
  }, []);
}
