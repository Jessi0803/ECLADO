import { expect, test } from '@playwright/test';
import { mockEcladoApis, mockProducts } from './support/eclado-mocks';

test('search stays fixed-width at right and fills the row below modes when space runs out', async ({ page }) => {
  await mockEcladoApis(page);
  await page.goto('/shop');
  for (const width of [1000,700,520,360,700]) {
    await page.setViewportSize({width,height:900});
    const toolbar=page.locator('.shop-search-toolbar');
    const modes=page.locator('.shop-filter-modes');
    const search=page.getByRole('search');
    await expect.poll(async()=>{
      const [container,left,right]=await Promise.all([toolbar.boundingBox(),modes.boundingBox(),search.boundingBox()]);
      if(!container||!left||!right)return false;
      const fits=left.width+320+14<=container.width;
      return Math.abs(right.width-(fits ? 320 : container.width))<1
        && Math.abs(right.x+right.width-container.x-container.width)<1
        && (fits ? Math.abs(left.y+left.height/2-right.y-right.height/2)<2 : right.y>=left.y+left.height && Math.abs(right.x-container.x)<1);
    }).toBe(true);
    await page.getByRole('searchbox',{name:'搜尋商品'}).fill('清潔');
    await expect(page.getByRole('button',{name:'清除搜尋',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.getByRole('button',{name:'清除搜尋',exact:true}).click();
  }
});

test('shop name search supports Chinese and case-insensitive English and clearing', async ({ page }) => {
  await mockEcladoApis(page);
  await page.goto('/shop');
  const input=page.getByRole('searchbox',{name:'搜尋商品'});
  await input.focus();
  await expect(input).toHaveCSS('outline-color','rgb(4, 19, 132)');
  await expect(input).toHaveCSS('border-top-color','rgb(4, 19, 132)');
  await expect(page.locator('.g4lg article')).toHaveCount(mockProducts.length);
  await input.fill('清潔泡沫');
  await expect(page.locator('.g4lg article')).toHaveCount(1);
  await expect(page.locator('.g4lg')).toContainText('深層清潔泡沫洗面乳');
  await input.fill('  DEEP   cleansing  ');
  await expect(page.locator('.g4lg article')).toHaveCount(1);
  await page.getByRole('button',{name:'清除搜尋',exact:true}).click();
  await expect(input).toHaveValue('');
  await expect(page.locator('.g4lg article')).toHaveCount(mockProducts.length);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('shop search intersects category and series; clear all resets both', async ({ page }) => {
  await mockEcladoApis(page);
  await page.goto('/shop');
  const input=page.getByRole('searchbox',{name:'搜尋商品'});
  await page.locator('.filter-tabs').getByRole('link',{name:'面膜',exact:true}).click();
  await input.fill('清潔泡沫');
  await expect(page.locator('.g4lg article')).toHaveCount(0);
  await expect(page.getByText('目前分類／系列找不到符合的商品',{exact:false})).toBeVisible();
  await expect(page.locator('.filter-tabs').getByRole('link',{name:'面膜',exact:true})).toHaveAttribute('aria-current','page');
  await page.getByRole('button',{name:'清除搜尋',exact:true}).click();
  await expect(page.locator('.g4lg article')).toHaveCount(1);
  await input.fill('清潔泡沫');
  await page.getByRole('button',{name:'清除所有條件'}).click();
  await expect(input).toHaveValue('');
  await expect(page.locator('.g4lg article')).toHaveCount(mockProducts.length);
  await page.getByRole('link',{name:'依系列分類',exact:true}).click();
  await page.locator('.filter-tabs').getByRole('link',{name:'Cell',exact:true}).click();
  await input.fill('清潔泡沫');
  await expect(page.locator('.g4lg article')).toHaveCount(0);
  await page.getByRole('button',{name:'清除所有條件'}).click();
  await expect(page.locator('.filter-tabs').getByRole('link',{name:'所有產品',exact:true})).toHaveAttribute('aria-current','page');
  await expect(page.locator('.g4lg article')).toHaveCount(mockProducts.length);
});

test('search uses only storefront products and does not reveal restricted prices', async ({ page }) => {
  await mockEcladoApis(page,{products:[...mockProducts,{...mockProducts[0],id:999,name_zh:'隱藏測試商品',active:false}]});
  await page.goto('/shop');
  const input=page.getByRole('searchbox',{name:'搜尋商品'});
  await input.fill('隱藏測試');
  await expect(page.locator('.g4lg article')).toHaveCount(0);
  await input.fill('NK');
  await expect(page.locator('.g4lg article')).toHaveCount(1);
  await expect(page.locator('.g4lg')).not.toContainText('6,600');
  await expect(page.locator('.g4lg').getByRole('button',{name:'加入購物車'})).toHaveCount(0);
  await input.fill('不存在的商品名稱'.repeat(5));
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
