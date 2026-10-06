const PRODUCT_WEBP_QUALITIES = [0.82, 0.76, 0.7, 0.64];
const DOCUMENT_WEBP_QUALITIES = [0.9, 0.87, 0.84];

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('圖片無法讀取'));
    };
    image.src = url;
  });
}

function canvasToWebp(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob || blob.type !== 'image/webp') {
        reject(new Error('目前瀏覽器不支援 WebP 圖片轉換'));
        return;
      }
      resolve(blob);
    }, 'image/webp', quality);
  });
}

async function optimizeImageFile(file, { maxDimension, targetBytes, qualities }) {
  const { image, url } = await loadImage(file);
  try {
    const sourceWidth = image.naturalWidth || image.width;
    const sourceHeight = image.naturalHeight || image.height;
    if (!sourceWidth || !sourceHeight) throw new Error('圖片尺寸無效');

    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('圖片轉換初始化失敗');
    context.drawImage(image, 0, 0, width, height);

    let optimizedBlob = null;
    for (const quality of qualities) {
      optimizedBlob = await canvasToWebp(canvas, quality);
      if (optimizedBlob.size <= targetBytes) break;
    }

    const baseName = String(file.name || 'image').replace(/\.[^.]+$/, '') || 'image';
    return {
      file: new File([optimizedBlob], `${baseName}.webp`, {
        type: 'image/webp',
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
  });
}
