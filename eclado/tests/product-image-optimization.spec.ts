import { expect, test } from '@playwright/test';

for (const failure of ['wrong-format', 'encoder-exception']) {
  test(`圖片錯誤提示區分 ${failure}，不將所有原因誤報為不支援 WebP`, async ({ page }) => {
    await page.goto('/');
    const message = await page.evaluate(async failure => {
      const canvas = document.createElement('canvas');
      canvas.width = 10; canvas.height = 10;
      const source = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
      const original = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function(callback) {
        if (failure === 'encoder-exception') throw new Error('native encoder error');
        return original.call(this, callback, 'image/png');
      };
      try {
        const { optimizeDocumentImageFile } = await import('/src/utils/imageOptimization.js');
        await optimizeDocumentImageFile(new File([source], 'photo.png', { type:'image/png' }));
        return 'unexpected success';
      } catch (error) { return (error as Error).message; }
      finally { HTMLCanvasElement.prototype.toBlob = original; }
    }, failure);
    expect(message).toContain(failure === 'wrong-format' ? '無法輸出 JPEG 格式' : '圖片編碼失敗');
    expect(message).not.toContain('不支援 WebP');
    expect(message).not.toContain('native encoder error');
  });
}

test('小證照不放大，損壞圖片不誤判為 WebP 不支援', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { optimizeDocumentImageFile } = await import('/src/utils/imageOptimization.js');
    const canvas = document.createElement('canvas');
    canvas.width = 100; canvas.height = 60;
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
    const small = await optimizeDocumentImageFile(new File([blob], 'small.png', { type:'image/png' }));
    let error = '';
    try { await optimizeDocumentImageFile(new File(['not an image'], 'broken.jpg', { type:'image/jpeg' })); }
    catch (failure) { error = (failure as Error).message; }
    return { width:small.width, height:small.height, error };
  });
  expect(result.width).toBe(100);
  expect(result.height).toBe(60);
  expect(result.error).toContain('圖片無法讀取');
  expect(result.error).toContain('不是只修改副檔名');
});

for (const failure of ['png', 'null', 'throw']) {
  test(`證照 WebP 輸出 ${failure} 時改用 JPEG，保留尺寸與白底`, async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async failure => {
      const canvas = document.createElement('canvas');
      canvas.width = 2000; canvas.height = 3200;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#111';
      context.font = '80px sans-serif';
      context.fillText('ECLADO-2026-0001', 120, 240);
      const source = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
      const original = HTMLCanvasElement.prototype.toBlob;
      const qualities: number[] = [];
      HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
        if (type === 'image/webp') {
          if (failure === 'null') return callback(null);
          if (failure === 'throw') throw new Error('encoder failed');
          return original.call(this, callback, 'image/png');
        }
        if (type === 'image/jpeg') qualities.push(quality!);
        return original.call(this, callback, type, quality);
      };
      try {
        const { optimizeDocumentImageFile } = await import('/src/utils/imageOptimization.js');
        const optimized = await optimizeDocumentImageFile(new File([source], 'certificate.png', { type:'image/png' }));
        const bitmap = await createImageBitmap(optimized.file);
        const output = document.createElement('canvas');
        output.width = bitmap.width; output.height = bitmap.height;
        const ctx = output.getContext('2d')!;
        ctx.drawImage(bitmap, 0, 0);
        const white = Array.from(ctx.getImageData(0, 0, 1, 1).data);
        bitmap.close();
        return { name:optimized.file.name, type:optimized.file.type, width:optimized.width, height:optimized.height, white, qualities };
      } finally { HTMLCanvasElement.prototype.toBlob = original; }
    }, failure);
    expect(result.name).toBe('certificate.jpg');
    expect(result.type).toBe('image/jpeg');
    expect(result.width).toBe(1500);
    expect(result.height).toBe(2400);
    expect(result.white.slice(0, 3).every(channel => channel >= 250)).toBe(true);
    expect(result.qualities[0]).toBe(0.9);
    expect(result.qualities.every(quality => quality >= 0.84)).toBe(true);
  });
}

test('JPEG 也失敗時清楚報錯，商品圖不啟用 JPEG 備援', async ({ page }) => {
  await page.goto('/');
  const errors = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 10; canvas.height = 10;
    const source = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
    const file = new File([source], 'small.png', { type:'image/png' });
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = callback => callback(null);
    try {
      const { optimizeDocumentImageFile, optimizeProductImageFile } = await import('/src/utils/imageOptimization.js');
      const results: string[] = [];
      for (const optimize of [optimizeDocumentImageFile, optimizeProductImageFile]) {
        try { await optimize(file); results.push('unexpected success'); }
        catch (error) { results.push((error as Error).message); }
      }
      return results;
    } finally { HTMLCanvasElement.prototype.toBlob = original; }
  });
  expect(errors.every(error => error.includes('圖片處理未產生結果'))).toBe(true);
});

test('後台商品圖片會縮放並轉成 WebP', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 2000;
    canvas.height = 1000;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas unavailable');
    context.fillStyle = '#d6b48a';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const sourceBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('png unavailable')), 'image/png');
    });
    const sourceFile = new File([sourceBlob], 'sample.png', { type: 'image/png' });
    const { optimizeProductImageFile } = await import('/src/utils/imageOptimization.js');
    const optimized = await optimizeProductImageFile(sourceFile);
    return {
      name: optimized.file.name,
      type: optimized.file.type,
      width: optimized.width,
      height: optimized.height,
      size: optimized.file.size,
      sourceSize: sourceFile.size,
    };
  });

  expect(result.name).toBe('sample.webp');
  expect(result.type).toBe('image/webp');
  expect(result.width).toBe(1600);
  expect(result.height).toBe(800);
  expect(result.size).toBeLessThan(result.sourceSize);
});

test('證照與獎狀使用較高解析度的 WebP 設定', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 3200;
    canvas.height = 2000;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas unavailable');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#111';
    context.font = '80px sans-serif';
    context.fillText('證書編號 ECLADO-2026-0001', 120, 240);
    const sourceBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('png unavailable')), 'image/png');
    });
    const sourceFile = new File([sourceBlob], 'certificate.png', { type: 'image/png' });
    const { optimizeDocumentImageFile } = await import('/src/utils/imageOptimization.js');
    const optimized = await optimizeDocumentImageFile(sourceFile);
    return {
      name: optimized.file.name,
      type: optimized.file.type,
      width: optimized.width,
      height: optimized.height,
    };
  });

  expect(result.name).toBe('certificate.webp');
  expect(result.type).toBe('image/webp');
  expect(result.width).toBe(2400);
  expect(result.height).toBe(1500);
});
