import { expect, test } from '@playwright/test';

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
