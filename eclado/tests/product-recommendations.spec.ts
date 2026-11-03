import { expect, test, type Page } from '@playwright/test';
import { mockEcladoApis, type MockEcladoApiOptions } from './support/eclado-mocks';
import { getProductRecommendations } from '../src/domain/productRecommendations.js';

const entries = [
  ['perfect-cleansing-smoothie-balm', '完美潔面卸妝膏'],
  ['enhancer-mild-cleanser', '溫和增效潔面乳'],
  ['enzyme-deep-cleanser-pure-powder', '酵素潔顏粉'],
  ['rebalancing-toner', '平衡爽膚水'],
  ['vono-prime-peel', 'VONO 喚膚調理組'],
  ['gold-patch', '金箔貼片'],
  ['rejuven-fiber-ampoule-system', '棉花水光管理'],
  ['rescuer-filagen-ampoule', '胜肽再生安瓶'],
  ['rescuer-cica-pore-ampoule', '積雪草毛孔安瓶'],
  ['a-c-control-ampoule-f', '控油修護安瓶'],
  ['soothing-mask', '水嫩凍膜'],
  ['ultra-pearl-velvet-mask', '極致珍珠緞面膜'],
  ['cell-phyto-anti-wrinkle-serum', '記憶多肽精華'],
  ['cell-memory-cream', '記憶修護霜'],
  ['exo-clinica-uv-suncream', '精萃防曬乳'],
  ['respiration-snow-cream', '呼吸雪霜'],
  ['c-p-50-ampoule', 'C.P 50 安瓶組'],
  ['rescuer-hydra-complex-ampoule', '水合複合安瓶'],
  ['oxygen-bubble-pack', '氧氣泡泡'],
  ['ultra-gold-velvet-mask', '黃金天鵝絨面膜'],
  ['shining-moisturizing-massage-cream', '爆水按摩霜'],
  ['pha-soft-peel-15', 'PHA溫和煥膚'],
];
const rows = entries.map(([slug, name_zh], index) => ({
  id: 201 + index, slug, name: slug, name_zh, price: 2000, pro_price: 1500,
  stock: 10, size: '100ml', active: true, publication_status: 'active',
  is_pro_only: [4, 5, 6].includes(index), category: '其他', features: [],
}));
const variants = [
  { id: 501, product_id: 202, size: '200ml', price: 2000, pro_price: 1500, stock: 10, is_default: true, active: true },
  { id: 502, product_id: 202, size: '500ml', price: 3000, pro_price: 2250, stock: 0, active: true },
];
const products = rows.map(row => ({ ...row, nameZh: row.name_zh, isProOnly: row.is_pro_only, publicationStatus: row.publication_status }));
const user = { id:'recommendation-member', email:'recommendation@example.test', user_metadata:{name:'推薦測試'}, app_metadata:{provider:'email'}, aud:'authenticated', role:'authenticated', created_at:'2026-05-01T00:00:00Z' };
const pro = { role:'pro' };
function product(slug: string) { return products.find(product => product.slug === slug)!; }

async function setup(page: Page, professional = false, seed: unknown[] = [], overrides: MockEcladoApiOptions = {}) {
  await mockEcladoApis(page, {
    products:rows, productVariants:variants, promotions:[],
    ...(professional ? { authUser:user, profiles:[{id:user.id, email:user.email, name:'推薦測試', role:'pro'}] } : {}),
    ...overrides,
  });
  // Seed only once, so reload exercises the app's own persisted cart.
  await page.addInitScript(seed => {
    if (!sessionStorage.getItem('recommendation-test-seeded')) {
      localStorage.setItem('eclado_cart_v1', JSON.stringify(seed));
      sessionStorage.setItem('recommendation-test-seeded', '1');
    }
  }, seed);
}

test('三份手冊：金箔片觸發金緞、安瓶分組、共通清潔不混入院線', () => {
  const gold = getProductRecommendations({ sources:[product('gold-patch')], products, user:pro });
  expect(gold.map(group => group.options.map(option => option.slug))).toEqual([
    ['respiration-snow-cream'], ['c-p-50-ampoule', 'rescuer-hydra-complex-ampoule'],
    ['oxygen-bubble-pack'], ['ultra-gold-velvet-mask'],
  ]);
  const vono = getProductRecommendations({ sources:[product('vono-prime-peel')], products, user:pro });
  expect(vono[0].options.map(option => option.slug)).toEqual(['rescuer-filagen-ampoule', 'rescuer-cica-pore-ampoule', 'a-c-control-ampoule-f']);
  const cotton = getProductRecommendations({ sources:[product('rejuven-fiber-ampoule-system')], products, user:pro });
  expect(cotton.map(group => group.options[0].slug)).toEqual([
    'shining-moisturizing-massage-cream', 'pha-soft-peel-15', 'c-p-50-ampoule', 'soothing-mask', 'ultra-pearl-velvet-mask',
  ]);
  expect(getProductRecommendations({ sources:[product('ultra-gold-velvet-mask')], products, user:pro })).toEqual([]);
});

test('多主商品合併推薦、已購安瓶仍保留替代款，失效商品及資格篩選', () => {
  const sources = [product('vono-prime-peel'), product('rejuven-fiber-ampoule-system')];
  const groups = getProductRecommendations({sources, products, cart:[product('rescuer-cica-pore-ampoule')], user:pro});
  const slugs = groups.flatMap(group => group.options.map(option => option.slug));
  expect(slugs).toContain('rescuer-filagen-ampoule');
  expect(slugs).toContain('rescuer-cica-pore-ampoule');
  expect(slugs.filter(slug => slug === 'soothing-mask')).toHaveLength(1);
  expect(getProductRecommendations({sources, products, user:null})).toEqual([]);
  const unavailable = products.map(row => row.slug === 'respiration-snow-cream' ? {...row, publicationStatus:'archived'}
    : row.slug === 'oxygen-bubble-pack' ? {...row, variants:[{id:'inactive', size:'100ml', active:false}]} : row);
  const availableSlugs = getProductRecommendations({sources:[product('gold-patch')], products:unavailable, user:pro})
    .flatMap(group => group.options.map(option => option.slug));
  expect(availableSlugs).not.toContain('respiration-snow-cream');
  expect(availableSlugs).not.toContain('oxygen-bubble-pack');
  expect(getProductRecommendations({sources:[{...product('rebalancing-toner'), recommendationOnly:true}], products, user:pro})).toEqual([]);
});

test('商品頁沿用商城小卡，加入後保留推薦並可重複加入或點進詳細頁', async ({ page }, testInfo) => {
  await setup(page);
  await page.goto('/products/perfect-cleansing-smoothie-balm');
  const section = page.getByRole('region', {name:'搭配選購'});
  await expect(section.getByRole('article')).toHaveCount(3);
  await expect(section.getByText(/依商品搭配選購|已加入/)).toHaveCount(0);
  const card = section.getByRole('article').filter({hasText:'溫和增效潔面乳'});
  await expect(card.getByRole('link', {name:'查看溫和增效潔面乳'})).toHaveAttribute('href', '/products/enhancer-mild-cleanser');
  await card.hover();
  await card.getByRole('button', {name:'加入購物車', exact:true}).click();
  await expect(section.getByRole('article')).toHaveCount(3);
  await card.hover();
  await card.getByRole('button', {name:'加入購物車', exact:true}).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('eclado_cart_v1') || '[]'))).toEqual([
    {id:202, variantId:'501', qty:2, recommendationOnly:true},
  ]);
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({path:`/tmp/eclado-recommendations-product-${testInfo.project.name}.png`});
  await page.reload();
  await expect(section.getByRole('article')).toHaveCount(3);
  await card.getByRole('link', {name:'查看溫和增效潔面乳'}).click();
  await expect(page).toHaveURL(/products\/enhancer-mild-cleanser$/);
  await expect(page.getByRole('heading', {name:'溫和增效潔面乳', exact:true, level:1})).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', {name:'完美潔面卸妝膏', exact:true, level:1})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('院線商品頁平列安瓶小卡與擇一標示，加入後保留全部推薦', async ({ page }) => {
  await setup(page, true);
  await page.goto('/products/vono-prime-peel');
  const section = page.getByRole('region', {name:'搭配選購'});
  await expect(section.getByRole('article')).toHaveCount(8);
  const card = section.getByRole('article').filter({hasText:'積雪草毛孔安瓶'});
  await expect(card.getByText('NT$ 1,500', {exact:true})).toBeVisible();
  await expect(section.getByText('導入安瓶・擇一搭配', {exact:true})).toHaveCount(3);
  await card.hover();
  await card.getByRole('button', {name:'加入購物車', exact:true}).click();
  await expect(section.getByRole('article')).toHaveCount(8);
  await expect(section.getByRole('link', {name:'查看胜肽再生安瓶'})).toHaveCount(1);
});

test('結帳加購重新向後端報價，保留收件資訊並顯示更新優惠運費', async ({ page }, testInfo) => {
  await setup(page, false, [{id:201, qty:1}]);
  const requests: any[] = [];
  await page.route('**/rest/v1/rpc/quote_order_pricing', async route => {
    const request = route.request().postDataJSON(); requests.push(request);
    const added = request.p_items.some((item: any) => item.product_id === 202);
    await route.fulfill({json:{
      items:request.p_items.map((item: any) => ({...item, id:item.product_id, nameZh:item.product_id === 202 ? '溫和增效潔面乳' : '完美潔面卸妝膏', qty:item.qty, unit_price:2000, size:'200ml'})),
      subtotal:added ? 4000 : 2000, discount:added ? 300 : 0, shipping:added ? 0 : 120,
      total:added ? 3700 : 2120,
      adjustments:added ? [{name:'搭配品既有活動', amount:300, adjustment_type:'fixed_discount'}] : [],
    }});
  });
  await page.goto('/checkout');
  const section = page.getByRole('region', {name:'搭配選購'});
  await expect(section.getByRole('article')).toHaveCount(3);
  const summary = page.getByTestId('checkout-order-summary');
  await expect(summary.getByText('NT$ 2,120', {exact:true})).toBeVisible();
  const cleanser = section.getByRole('article', {name:'溫和增效潔面乳', exact:true});
  await cleanser.getByLabel('溫和增效潔面乳容量規格').selectOption('502');
  await expect(cleanser.getByText('NT$ 3,000', {exact:true})).toBeVisible();
  await cleanser.getByLabel('溫和增效潔面乳容量規格').selectOption('501');
  await page.locator('form input').first().fill('加購測試');
  await section.getByRole('button', {name:'加購溫和增效潔面乳'}).click();
  await expect(summary.getByText('NT$ 3,700', {exact:true})).toBeVisible();
  await expect(summary.getByText('搭配品既有活動', {exact:true})).toBeVisible();
  await expect(summary.getByText('免運', {exact:true})).toBeVisible();
  await expect(page.locator('form input').first()).toHaveValue('加購測試');
  expect(requests.at(-1).p_items).toEqual([
    {product_id:201, variant_id:null, qty:1}, {product_id:202, variant_id:'501', qty:1},
  ]);
  await expect(section.getByRole('article')).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({path:`/tmp/eclado-recommendations-checkout-${testInfo.project.name}.png`});
  await page.reload();
  await expect(section.getByRole('article')).toHaveCount(3);
});

test('只有推薦加購的清潔商品，不會在結帳啟動新一輪推薦', async ({ page }) => {
  await setup(page, false, [{id:204, qty:1, recommendationOnly:true}]);
  await page.goto('/checkout');
  await expect(page.getByTestId('checkout-order-summary')).toBeVisible();
  await expect(page.getByRole('region', {name:'搭配選購'})).toBeHidden();
  await page.reload();
  await expect(page.getByTestId('checkout-order-summary')).toBeVisible();
  await expect(page.getByRole('region', {name:'搭配選購'})).toBeHidden();
});

test('結帳推薦為緊湊列表，最多顯示三條半並可向下捲動，重複加購累加數量', async ({ page }, testInfo) => {
  await setup(page, true, [{id:205, qty:1}]);
  await page.goto('/checkout');
  const section = page.getByRole('region', {name:'搭配選購'});
  const list = section.getByRole('region', {name:'推薦商品列表'});
  await expect(list.getByRole('article')).toHaveCount(8);
  const geometry = await list.evaluate(element => ({height:element.clientHeight, scrollHeight:element.scrollHeight, rowHeight:element.querySelector('article')!.getBoundingClientRect().height}));
  expect(geometry.height / geometry.rowHeight).toBeCloseTo(3.5, 1);
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.height);
  const button = list.getByRole('button', {name:'加購胜肽再生安瓶'});
  await expect(button).toHaveText('＋');
  await button.click();
  await expect(button).toHaveAttribute('title', '已加入訂單明細');
  await expect(button.locator('svg')).toBeVisible();
  await button.click();
  await expect(list.getByRole('article')).toHaveCount(8);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('eclado_cart_v1') || '[]').find((item: any) => item.id === 208)?.qty)).toBe(2);
  await expect(button).toHaveText('＋');
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({path:`/tmp/eclado-recommendations-scroll-${testInfo.project.name}.png`});
  await list.getByRole('button', {name:'加購精萃防曬乳'}).scrollIntoViewIfNeeded();
  expect(await list.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('確認付款頁驗證優惠碼期間暫停加購，加購後清除舊優惠碼報價', async ({ page }) => {
  await setup(page, false, [{id:201, qty:1}]);
  let releaseCoupon: () => void = () => {};
  const couponGate = new Promise<void>(resolve => { releaseCoupon = resolve; });
  await page.route('**/rest/v1/rpc/quote_order_pricing', async route => {
    const request = route.request().postDataJSON();
    if (request.p_coupon_code) await couponGate;
    const subtotal = request.p_items.length * 2000;
    const discount = request.p_coupon_code ? 100 : 0;
    await route.fulfill({json:{
      items:request.p_items.map((item: any) => ({...item, id:item.product_id, nameZh:rows.find(row => row.id === item.product_id)?.name_zh, unit_price:2000})),
      subtotal, discount, shipping:120, total:subtotal - discount + 120,
      ...(request.p_coupon_code ? {coupon_campaign_id:'test-coupon', coupon_name:'測試優惠券'} : {}),
    }});
  });
  await page.goto('/checkout');
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('加購測試'); await inputs.nth(1).fill('0900000000'); await inputs.nth(2).fill('test@example.test');
  await page.getByPlaceholder('縣市').fill('台北市'); await page.getByPlaceholder('區域').fill('中正區');
  await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('測試路1號');
  await page.getByRole('button', {name:'繼續確認付款'}).click();
  const section = page.getByRole('region', {name:'搭配選購'});
  await page.getByPlaceholder('輸入優惠碼').fill('TEST');
  await page.getByRole('button', {name:'套用', exact:true}).click();
  await expect(section.getByRole('button', {name:'加購溫和增效潔面乳'})).toBeDisabled();
  releaseCoupon();
  await expect(page.getByText('已套用「測試優惠券」', {exact:false})).toBeVisible();
  await section.getByRole('button', {name:'加購溫和增效潔面乳'}).click();
  await expect(page.getByText('購物內容或收件資料已變更，請重新套用優惠碼。')).toBeVisible();
  await expect(page.getByTestId('checkout-order-summary').getByText('NT$ 4,120', {exact:true})).toBeVisible();
  await expect(page.getByText('已套用「測試優惠券」', {exact:false})).toHaveCount(0);
  await expect(page.getByRole('button', {name:'確認訂單', exact:true})).toBeVisible();
});

for (const pendingPreview of [false, true]) {
  test(`確認訂單前才加購：${pendingPreview ? '背景報價尚未返回' : '已完成重新報價'}仍以最新活動金額建單付款`, async ({ page }) => {
    // No requests can escape the mocked backend/payment routes to production.
    await page.context().route('**/*', route => {
      const host = new URL(route.request().url()).hostname;
      return ['127.0.0.1', 'localhost'].includes(host) ? route.continue() : route.abort('blockedbyclient');
    });
    const orders: any[] = [], payments: any[] = [], creates: any[] = [], quotes: any[] = [];
    await setup(page, false, [{id:201, qty:1}], {
      promotions:[{
        id:'late-add-promo', name:'潔面乳九折', product_ids:[202], active:true,
        discount_rate:0.9, discount_amount:0, discount_order:'rate_then_amount',
        audience_roles:['consumer'], allow_guest:true,
      }],
      onOrderInsert:order => orders.push(order),
      onOrderPricingRequest:request => creates.push(request),
      onPaymentRequest:payment => payments.push(payment),
    });
    let releasePreview = () => {}, releaseFinal = () => {};
    const previewGate = new Promise<void>(resolve => { releasePreview = resolve; });
    const finalGate = new Promise<void>(resolve => { releaseFinal = resolve; });
    let previewWaiting = false, finalWaiting = false;
    await page.route('**/rest/v1/rpc/quote_order_pricing', async route => {
      const request = route.request().postDataJSON();
      quotes.push(request);
      if (request.p_guest_email) {
        finalWaiting = true;
        await finalGate;
      } else if (pendingPreview && request.p_items.some((item: any) => item.product_id === 202)) {
        previewWaiting = true;
        await previewGate;
      }
      await route.fallback();
    });
    page.on('dialog', dialog => dialog.accept());
    try {
      await page.goto('/checkout');
      const inputs = page.locator('form input');
      await inputs.nth(0).fill('最後加購測試'); await inputs.nth(1).fill('0900000000');
      await inputs.nth(2).fill('late-add@example.test');
      await page.getByPlaceholder('縣市').fill('台北市'); await page.getByPlaceholder('區域').fill('中正區');
      await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('測試路1號');
      await page.getByRole('button', {name:'繼續確認付款'}).click();
      const section = page.getByRole('region', {name:'搭配選購'});
      await section.getByLabel('溫和增效潔面乳容量規格').selectOption('502');
      const add = section.getByRole('button', {name:'加購溫和增效潔面乳'});
      await add.click();
      if (pendingPreview) {
        await expect.poll(() => previewWaiting).toBe(true);
      } else {
        await expect(page.getByTestId('checkout-order-summary').getByText('潔面乳九折', {exact:true})).toBeVisible();
        await expect(page.getByTestId('checkout-order-summary').getByText('NT$ 4,820', {exact:true})).toBeVisible();
      }
      await page.getByRole('button', {name:'確認訂單', exact:true}).click();
      await expect.poll(() => finalWaiting).toBe(true);
      // While the final authoritative quote is pending, additions must be frozen.
      await expect(add).toBeDisabled();
      expect(creates).toHaveLength(0);
      expect(quotes.at(-1).p_items).toEqual([
        {product_id:201, variant_id:null, qty:1}, {product_id:202, variant_id:'502', qty:1},
      ]);
      releaseFinal();
      await expect(page.getByRole('heading', {name:'請完成付款'})).toBeVisible();
      expect(orders).toHaveLength(1);
      expect(creates).toHaveLength(1);
      expect(payments).toHaveLength(1);
      expect(creates[0].p_items).toEqual([
        {product_id:201, variant_id:null, qty:1, expected_unit_price:2000},
        {product_id:202, variant_id:'502', qty:1, expected_unit_price:3000},
      ]);
      expect(creates[0].p_expected_quote).toMatchObject({subtotal:5000, discount:300, shipping:120, total:4820});
      expect(orders[0]).toMatchObject({subtotal:5000, discount:300, total:4820, payment_amount:4820, promotion_id:'late-add-promo'});
      expect(payments[0].amount).toBe(4820);
      releasePreview();
      await expect(page.getByTestId('checkout-order-summary').getByText('NT$ 4,820', {exact:true})).toBeVisible();
      await expect(page.getByRole('region', {name:'搭配選購'})).toHaveCount(0);
    } finally {
      releasePreview(); releaseFinal();
    }
  });
}
