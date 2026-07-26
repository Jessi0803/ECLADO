import React, { useEffect, useRef, useState } from 'react';
import {
  PRODUCT_AUTO_IMAGE_TARGETS,
  analyzeTransparentImageBounds,
  getDefaultProductImageScale,
  normalizeProductImageScale,
} from '../../domain/catalog.jsx';

export default function ProductAutoImage({ src, alt, product, mode, style }) {
  const imgRef = useRef(null);
  const manualScale = mode === 'list' ? normalizeProductImageScale(product?.listImageScale) : null;
  const fallbackScale = manualScale || getDefaultProductImageScale(product) * (mode === 'detail' ? 0.84 : 1);
  const [fit, setFit] = useState({ scale: fallbackScale, x: 0, y: 0 });

  useEffect(() => {
    let cancelled = false;
    setFit({ scale: fallbackScale, x: 0, y: 0 });
    if (manualScale) return;
    analyzeTransparentImageBounds(src).then(bounds => {
      const el = imgRef.current;
      if (cancelled || !bounds || !el) return;
      const frameWidth = el.clientWidth;
      const frameHeight = el.clientHeight;
      if (!frameWidth || !frameHeight) return;
      const containScale = Math.min(frameWidth / bounds.naturalWidth, frameHeight / bounds.naturalHeight);
      const productWidth = bounds.width * containScale;
      const productHeight = bounds.height * containScale;
      const targetSize = Math.min(frameWidth, frameHeight) * (PRODUCT_AUTO_IMAGE_TARGETS[mode] || 0.8);
      const scale = Math.max(0.45, Math.min(2.4, targetSize / Math.max(productWidth, productHeight)));
      const drawnWidth = bounds.naturalWidth * containScale;
      const drawnHeight = bounds.naturalHeight * containScale;
      const drawnLeft = (frameWidth - drawnWidth) / 2;
      const drawnTop = (frameHeight - drawnHeight) / 2;
      const productCenterX = drawnLeft + (bounds.left + bounds.width / 2) * containScale;
      const productCenterY = drawnTop + (bounds.top + bounds.height / 2) * containScale;
      setFit({ scale, x: frameWidth / 2 - productCenterX, y: frameHeight / 2 - productCenterY });
    });
    return () => { cancelled = true; };
  }, [src, mode, manualScale, fallbackScale]);

  return (
    <img
      ref={imgRef}
      src={src}
      alt={alt}
      style={{ ...style, transform:'translate(' + fit.x + 'px, ' + fit.y + 'px) scale(' + fit.scale + ')', transformOrigin:'center center' }}
    />
  );
}
