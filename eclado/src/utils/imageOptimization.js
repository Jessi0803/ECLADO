const PRODUCT_WEBP_QUALITIES = [0.82, 0.76, 0.7, 0.64];
const DOCUMENT_WEBP_QUALITIES = [0.9, 0.87, 0.84];

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('圖片無法讀取，檔案可能損壞或格式不相容；請重新匯出為 JPG 或 PNG 後重試（不是只修改副檔名）'));
    };
    image.src = url;
  });
}

function canvasToImage(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(blob => {
        if (!blob) {
          reject(new Error('圖片處理未產生結果，請縮小圖片或重新匯出為 JPG 後重試'));
          return;
        }
        if (blob.type !== type) {
          reject(new Error(`目前瀏覽器無法輸出 ${type === 'image/webp' ? 'WebP' : 'JPEG'} 格式，請更新或更換瀏覽器後重試`));
          return;
        }
        resolve(blob);
      }, type, quality);
    } catch {
      reject(new Error('圖片編碼失敗，請重新匯出為 JPG、關閉其他分頁或更換瀏覽器後重試'));
    }
  });
}

async function optimizeImageFile(file, { maxDimension, targetBytes, qualities, jpegFallback = false }) {
  const { image, url } = await loadImage(file);
  try {
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (!sourceWidth || !sourceHeight) throw new Error('無法取得圖片尺寸，請重新匯出圖片後重試');

    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('無法啟動圖片處理，請關閉其他分頁或重新開啟瀏覽器後重試');
    if (jpegFallback) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
    }
    function drawSource() {
      try { context.drawImage(image, 0, 0, width, height); }
      catch { throw new Error('圖片縮放處理失敗，請縮小原圖或重新匯出為 JPG 後重試'); }
    }
    drawSource();

    async function encode(type) {
      let blob;
      for (const quality of qualities) {
        blob = await canvasToImage(canvas, type, quality);
        if (blob.size <= targetBytes) break;
      }
      return blob;
    }
    let optimizedBlob;
    try {
      optimizedBlob = await encode('image/webp');
    } catch (error) {
      if (!jpegFallback) throw error;
      // JPEG has no alpha channel. Redraw on white so transparent scans do not
      // acquire a black background. Keep the same dimensions and quality floor.
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
      drawSource();
      optimizedBlob = await encode('image/jpeg');
    }
    if (jpegFallback && optimizedBlob.size > 5 * 1024 * 1024) {
      throw new Error('處理後圖片仍超過 5 MB，請裁切多餘背景或重新匯出圖片後重試');
    }
    const extension = optimizedBlob.type === 'image/jpeg' ? 'jpg' : 'webp';

    const baseName = String(file.name || 'image').replace(/\.[^.]+$/, '') || 'image';
    return {
      file: new File([optimizedBlob], `${baseName}.${extension}`, {
        type: optimizedBlob.type,
        lastModified: Date.now(),
      }),
      width,
      height,
      sourceBytes: file.size,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function optimizeProductImageFile(file) {
  return optimizeImageFile(file, {
    maxDimension: 1600,
    targetBytes: 450 * 1024,
    qualities: PRODUCT_WEBP_QUALITIES,
  });
}

export function optimizeDocumentImageFile(file) {
  return optimizeImageFile(file, {
    maxDimension: 2400,
    targetBytes: 1250 * 1024,
    qualities: DOCUMENT_WEBP_QUALITIES,
    jpegFallback: true,
  });
}
