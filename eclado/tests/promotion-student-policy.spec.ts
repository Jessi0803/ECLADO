import { expect, test, type Page } from '@playwright/test';
import { activePromotion, adminProductRows, adminProfileRows, mockEcladoApis } from './support/eclado-mocks';
import { getOrderPriceAdjustments } from '../src/domain/orderDiscounts.js';
import { calculateDiscount, getPromoDisplayPrice } from '../src/domain/promotions.js';

const admin = { id:'policy-admin',email:'policy@example.test',user_metadata:{name:'管理員'},app_metadata:{provider:'email'},aud:'authenticated',role:'authenticated',created_at:'2026-05-01' };
const activity = { ...activePromotion, id:'policy-promotion',name:'雙十一學生互斥',activation_type:'automatic',benefit_type:'percentage_discount',discount_rate:.8,
  updated_at:'2026-10-30T00:00:00Z',allow_student_price_stacking:false,instructor_reward_eligible:false };
const scopes = ['qualification','benefit'].map((scope_role, id) => ({ id,promotion_id:activity.id,scope_role,target_type:'product',product_id:adminProductRows[0].id,mode:'include' }));
async function open(page: Page) {
  await page.goto('/admin');
  if ((page.viewportSize()?.width || 0) <= 900) await page.getByRole('button',{name:'開啟選單'}).click();
  await page.locator('.app-sidebar button:not(.sidebar-star)').filter({hasText:'活動管理'}).first().click();
}
const options = { authUser:admin,products:adminProductRows,profiles:[{...adminProfileRows[0],id:admin.id,email:admin.email}],promotions:[activity],promotionScopes:scopes,
  backofficeAccess:{role:'super_admin',permissions:['promotions.manage','catalog.read']} };

test('空活動列表仍可設定學生政策，缺少欄位時保留舊相容模式', async ({ page }) => {
  await mockEcladoApis(page, { ...options,promotions:[],promotionScopes:[] });
  let installed = true;
  await page.route('**/rest/v1/promotions?*', route => {
    const selected = new URL(route.request().url()).searchParams.get('select');
    if (selected?.includes('allow_student_price_stacking') && !installed) {
      return route.fulfill({status:400,json:{code:'42703',message:'column does not exist'}});
    }
    return route.fulfill({json:[]});
  });
  await open(page);
  await page.getByRole('button',{name:'+ 新增優惠活動'}).click();
  await expect(page.getByLabel('可與學生價疊加')).toBeEnabled();
  await page.getByLabel('可與學生價疊加').uncheck();
  installed = false;
  await page.getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole('button',{name:'+ 新增優惠活動'}).click();
  await expect(page.getByLabel('可與學生價疊加')).toBeDisabled();
});

test('學生互斥活動複製保留兩個政策，優惠券專用恢復原規則', async ({ page }) => {
  const saves: Record<string, unknown>[] = [];
  await mockEcladoApis(page, { ...options,onDiscountPromotionSave:p => saves.push(p) });
  await open(page);
  await page.getByRole('button',{name:'複製',exact:true}).click();
  await expect(page.getByLabel('可與學生價疊加')).not.toBeChecked();
  await expect(page.getByLabel('活動參與件計入師資返饋')).not.toBeChecked();
  await page.getByRole('button',{name:/建立|儲存/}).last().click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].allow_student_price_stacking).toBe(false);
  expect(saves[0].instructor_reward_eligible).toBe(false);
  await page.getByRole('button',{name:'編輯活動',exact:true}).click();
  await page.getByLabel('啟用方式').selectOption('coupon_only');
  await expect(page.getByText('學生價與返饋排除設定僅適用自動價格活動；滿額贈、滿件贈及優惠券專用活動維持原規則。')).toBeVisible();
  await page.getByRole('button',{name:/建立|儲存/}).last().click();
  await expect.poll(() => saves.length).toBe(2);
  expect(saves[1].allow_student_price_stacking).toBe(true);
  expect(saves[1].instructor_reward_eligible).toBe(true);
});

test('既有複合活動可獨立設定學生價與返饋並處理過期設定', async ({ page }) => {
  await mockEcladoApis(page, { ...options,promotions:[{ ...activity,benefit_type:'legacy_discount' }] });
  let request: any;
  await page.route('**/rest/v1/rpc/save_promotion_student_policy', route => {
    request = route.request().postDataJSON();
    return route.fulfill({status:409,json:{code:'40001',message:'活動已變更，請重新載入'}});
  });
  await open(page);
  await page.getByRole('button',{name:'學生價與返饋設定',exact:true}).click();
  await page.getByLabel('可與學生價疊加').check();
  await page.getByRole('button',{name:'儲存學生價與返饋設定'}).click();
  await expect(page.getByText('儲存失敗：活動已變更，請重新載入')).toBeVisible();
  expect(request).toEqual({p_id:activity.id,p_allow_stacking:true,p_reward_eligible:false,p_expected_updated_at:activity.updated_at});
});

test('學生價不疊活動的估價等待後端，價格調整可核對同額方案', () => {
  const product = { id:1,price:2000,proPrice:1000,qty:4,studentPriceUserId:'student',studentDefaultVariantId:1,studentUnitPrices:{1:900} };
  const user = { uid:'student',role:'pro' };
  const promo = { ...activity,product_ids:[1],start_at:null,end_at:null,discount_amount:0 };
  expect(getPromoDisplayPrice(product,user,[promo])).toBeNull();
  expect(calculateDiscount([product],[promo],user).discount).toBe(0);
  const rows = getOrderPriceAdjustments({discount:0,adjustments:[
    {name:'活動九折',amount:400,adjustment_type:'percentage_discount'},
    {name:'活動商品不適用學生價',amount:400,adjustment_type:'student_price_restoration'},
  ]});
  expect(rows.map(r => r.amount)).toEqual([400,-400]);
});

test('購物車與結帳正確顯示不疊學生價的加回金額', async ({ page }) => {
  await mockEcladoApis(page);
  await page.route('**/rest/v1/rpc/quote_order_pricing', async route => {
    const input = route.request().postDataJSON().p_items;
    const subtotal = input.reduce((n: number, i: {qty:number}) => n + 3980 * i.qty, 0);
    await route.fulfill({json:{items:[],subtotal,discount:300,shipping:120,total:subtotal-180,automatic_allocation_version:1,
      adjustments:[{name:'雙十一優惠',amount:700,adjustment_type:'buy_x_get_y'},
        {name:'活動商品不適用學生價',amount:400,adjustment_type:'student_price_restoration'}]}});
  });
  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button',{name:/加入購物車/}).click();
  await page.locator('nav').getByRole('button',{name:/^購物車/}).click();
  const cart = page.getByRole('dialog',{name:'購物車'});
  await expect(cart.getByText('+NT$ 400',{exact:true})).toBeVisible();
  await expect(cart.getByText('−NT$ 700',{exact:true})).toBeVisible();
  await cart.getByRole('button',{name:'前往結帳',exact:true}).click();
  await page.getByRole('button',{name:'訪客結帳',exact:true}).click();
  await cart.waitFor({state:'hidden'});
  await expect(page.getByText('+NT$ 400',{exact:true})).toBeVisible();
});
