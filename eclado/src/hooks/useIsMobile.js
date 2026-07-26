import { useEffect, useState } from 'react';

export default function useIsMobile() {
  const [w, setW] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200);
  useEffect(() => {
    const h = () => setW(window.innerWidth);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return w <= 900;
}

// ─── DATA ────────────────────────────────────────────────────────────────────
