import React, { useEffect, useRef, useState } from 'react';

export default function CountUp({ value, grouping = true, duration = 1600 }) {
  const ref = useRef(null);
  const [display, setDisplay] = useState(value);
  const format = number => number.toLocaleString('en-US', { useGrouping: grouping });

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let observer;
    let started = false;
    const finish = () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      setDisplay(value);
    };
    if (motion.matches) {
      finish();
      return undefined;
    }
    setDisplay(0);
    observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || started) return;
      started = true;
      observer.disconnect();
      const start = performance.now();
      const tick = now => {
        const progress = Math.min((now - start) / duration, 1);
        setDisplay(Math.round(value * (1 - Math.pow(1 - progress, 3))));
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, { threshold: 0.5 });
    observer.observe(ref.current);
    const onMotionChange = () => { if (motion.matches) finish(); };
    motion.addEventListener('change', onMotionChange);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      motion.removeEventListener('change', onMotionChange);
    };
  }, [value, duration]);

  return (
    <span ref={ref} className="brand-story-count" aria-label={format(value)}>
      <span className="brand-story-count-space" aria-hidden="true">{format(value)}</span>
      <span className="brand-story-count-value" aria-hidden="true">{format(display)}</span>
    </span>
  );
}
