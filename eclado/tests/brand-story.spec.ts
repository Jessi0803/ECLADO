import { expect, test } from '@playwright/test';
import { mockEcladoApis } from './support/eclado-mocks';

test('品牌故事圖文、素材與導覽在不同寬度保持完整', async ({ page }, testInfo) => {
  await mockEcladoApis(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/about');
  const story = page.getByRole('article', { name: 'ECLADO 品牌故事', exact: true });
  await expect(story.getByRole('heading', { level: 1 })).toHaveText('品牌故事');
  await expect(story.locator('img')).toHaveCount(8);
  await expect(story.locator(':scope > section')).toHaveCount(7);
  await expect(story.locator('.brand-story-count-value')).toHaveText(['1998', '8,000', '150']);
  for (const width of [375, 640, 768, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const img of await story.locator('img').all()) {
      await img.scrollIntoViewIfNeeded();
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const height = await story.evaluate(el => el.getBoundingClientRect().height);
    console.log('brand-story layout', { width, height });
    expect(height).toBeLessThan(width <= 640 ? 8500 : 7200);
    if (width >= 1280) expect(height).toBeGreaterThan(4300);
    for (const poster of [story.locator('.brand-story-portrait'), story.locator('.brand-story-closing img')]) {
      expect(await poster.evaluate((el: HTMLImageElement) => {
        const css = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return css.objectFit === 'contain' || Math.abs(box.width / box.height - el.naturalWidth / el.naturalHeight) < 0.02;
      })).toBe(true);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    if (width === 375 || width === 1440) {
      await page.screenshot({ path: testInfo.outputPath('brand-story-' + width + '.png'), fullPage: true });
    }
  }
  await expect(story.getByRole('link', { name: '探索保養系列' })).toHaveAttribute('href', '/shop?view=series');
  await expect(story.getByRole('link', { name: '與我們聯繫' })).toHaveAttribute('href', '/contact');
  await story.getByRole('link', { name: '探索保養系列' }).click();
  await expect(page).toHaveURL(new RegExp('/shop[?]view=series$'));
  await page.goto('/about');
  await story.getByRole('link', { name: '與我們聯繫' }).click();
  await expect(page).toHaveURL(/\/contact$/);
});

test('品牌故事數字進入畫面上數一次，導覽可回頂且不增加歷史紀錄', async ({ page }) => {
  await mockEcladoApis(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/about');
  const counters = page.locator('.brand-story-count-value');
  await expect(counters).toHaveText(['0', '0', '0']);
  await page.locator('.brand-story-facts').scrollIntoViewIfNeeded();
  await expect.poll(async () => {
    const count = Number((await counters.nth(1).innerText()).replaceAll(',', ''));
    return count > 0 && count < 8000;
  }).toBe(true);
  await expect(counters).toHaveText(['1998', '8,000', '150']);
  const historyLength = await page.evaluate(() => history.length);
  if ((page.viewportSize()?.width || 0) <= 900) {
    await page.getByRole('button', { name: '開啟選單' }).click();
  }
  await page.getByRole('button', { name: '品牌故事', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await page.locator('.brand-story-facts').scrollIntoViewIfNeeded();
  await expect(counters).toHaveText(['1998', '8,000', '150']);
});
