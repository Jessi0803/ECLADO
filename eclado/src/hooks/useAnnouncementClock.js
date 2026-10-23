import { useEffect, useState } from 'react';

// Re-evaluate open pages at each boundary, including after browser sleep/tab changes.
export default function useAnnouncementClock(announcement) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let timer;
    function tick() {
      clearTimeout(timer);
      const current = Date.now();
      setNow(current);
      const next = [announcement?.start_at, announcement?.end_at]
        .filter(Boolean).map(Date.parse).filter(value => Number.isFinite(value) && value > current)
        .sort((a,b) => a-b)[0];
      if (announcement?.enabled && next !== undefined) timer = setTimeout(tick, Math.min(next-current, 2147483647));
    }
    tick();
    const onVisible = () => { if (!document.hidden) tick(); };
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [announcement?.start_at, announcement?.end_at, announcement?.enabled]);
  return now;
}
