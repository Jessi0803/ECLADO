import { useEffect } from 'react';

export default function useDocumentMeta(title, description) {
  useEffect(() => {
    const previousTitle = document.title;
    let meta = document.querySelector('meta[name="description"]');
    const createdMeta = !meta;
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    const previousDescription = meta?.getAttribute('content') || '';
    document.title = title;
    if (meta && description) meta.setAttribute('content', description);
    return () => {
      document.title = previousTitle;
      if (createdMeta) meta.remove();
      else meta.setAttribute('content', previousDescription);
    };
  }, [description, title]);
}
