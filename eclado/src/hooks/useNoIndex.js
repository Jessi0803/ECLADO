import { useEffect } from 'react';

export default function useNoIndex(enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    let meta = document.querySelector('meta[name="robots"]');
    const created = !meta;
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'robots');
      document.head.appendChild(meta);
    }
    const previousContent = meta.getAttribute('content');
    meta.setAttribute('content', 'noindex, nofollow, noarchive');
    return () => {
      if (created) meta.remove();
      else if (previousContent == null) meta.removeAttribute('content');
      else meta.setAttribute('content', previousContent);
    };
  }, [enabled]);
}
