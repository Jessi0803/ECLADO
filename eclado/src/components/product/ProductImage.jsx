import React, { forwardRef, useState } from 'react';

const ProductImage = forwardRef(function ProductImage({ src, alt, fallbackText = alt, style, ...props }, ref) {
  const [failedSrc, setFailedSrc] = useState(null);

  if (!src || failedSrc === src) {
    return (
      <div role="img" aria-label={fallbackText} style={{
        ...style,
        display:'flex', alignItems:'center', justifyContent:'center',
        boxSizing:'border-box', padding:24, background:'var(--off-white)',
        color:'var(--dark)', fontSize:14, lineHeight:1.6, textAlign:'center',
        overflowWrap:'anywhere', transform:'none',
      }}>
        {fallbackText}
      </div>
    );
  }

  return <img {...props} key={src} ref={ref} src={src} alt={alt} style={style} onError={() => setFailedSrc(src)} />;
});

export default ProductImage;
