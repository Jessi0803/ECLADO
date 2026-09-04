import { expect, test } from '@playwright/test';
import { mockEcladoApis } from './support/eclado-mocks';
import { CLINICAL_JOURNAL_ARTICLES } from '../src/data/clinicalJournalArticles';
import { HERO_SLIDES } from '../src/data/homeContent';

const unsupportedClaims = /外泌體|exosomes|泛紅|無刺激性|0\.000|15\.20|4,000|4000|22\.19|22\.70|17\.15|18\.14|26\.50|30\.53|85\.13|90\.11|無一例外|最多|Clinical Proven/i;

test('公開文章資料及首頁入口不再包含待確認宣稱', () => {
  expect(JSON.stringify(CLINICAL_JOURNAL_ARTICLES)).not.toMatch(unsupportedClaims);
  expect(JSON.stringify(HERO_SLIDES[1])).not.toMatch(unsupportedClaims);
});

test('首頁第二個 Hero 保養分享仍連到第一篇文章', async ({ page }) => {
  await mockEcladoApis(page);
  await page.goto('/');
  const cta = page.getByRole('button', { name: '查看保養分享', exact: true });
  await expect(cta).toBeVisible({ timeout: 12000 });
  await cta.click();
  await expect(page).toHaveURL(/\/journal\/azulene-ampoule-clinical-data$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('乾燥緊繃時，給肌膚柔潤的日常照護');
});

for (const [slug, title, image, fit] of [
  ['azulene-ampoule-clinical-data', '乾燥緊繃時，給肌膚柔潤的日常照護', 'journal-clinical-azulene.jpg', 'contain'],
  ['exo-clinica-gel-clinical-data', '補水不必厚重，找回清爽舒適的保養節奏', 'journal-hydration-wide.png', 'cover'],
]) {
  test(`保養專欄：${slug}`, async ({ page }, testInfo) => {
    await mockEcladoApis(page);
    await page.goto('/journal');
    await expect(page.locator('.journal-list-grid > a')).toHaveCount(8);
    await page.getByRole('link', { name: new RegExp(title) }).click();
    await expect(page).toHaveURL(new RegExp(`/journal/${slug}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
    await expect(page).toHaveTitle(new RegExp(title));
    expect(await page.locator('meta[name="description"]').getAttribute('content')).not.toMatch(unsupportedClaims);
    const article = page.locator('article');
    await expect(article).not.toContainText(unsupportedClaims);
    await expect(article.locator('img').first()).toHaveAttribute('src', `/assets/images/${image}`);
    await expect(article.locator('.journal-figure, .journal-data-table, .journal-supplement')).toHaveCount(0);
    await expect(article.locator('h2')).toHaveCount(4);
    await expect(article.locator('a[href$=".pdf"]')).toHaveCount(0);
    const note = article.locator('.journal-section-note');
    await expect(note).toHaveText(/^＊ /);
    await expect(note).toHaveCSS('font-size', '12px');
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const img of await article.locator('img').all()) {
        await img.scrollIntoViewIfNeeded();
        await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
        await expect(img).toHaveCSS('object-fit', fit);
        expect(await img.evaluate((el: HTMLImageElement) => el.currentSrc)).toContain(
          slug.startsWith('exo') && width <= 640 ? 'journal-hydration-cover.png' : image,
        );
      }
      await page.screenshot({ path: testInfo.outputPath(`${slug}-${width}.png`) });
    }
    await page.getByRole('button', { name: '← 返回保養專欄' }).click();
    await expect(page).toHaveURL(/\/journal$/);
  });
}
