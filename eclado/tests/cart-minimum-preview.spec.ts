import { test, expect } from '@playwright/test';
import { mockEcladoApis } from './support/eclado-mocks';
import { getOrderMinimumPreview } from '../src/domain/orderMinimumPreview.js';
const details={kind:'cart_minimum_preview',version:1,subtotal:5022,discount:372,merchandise_amount:4650,minimum:5000,remaining:350,
 adjustments:[{name:'呼吸系列任5送1',amount:930,adjustment_type:'buy_x_get_y'},{name:'活動商品不適用學生價',amount:558,adjustment_type:'student_price_restoration'}]};
test('only consistent minimum errors become display-only previews',()=>{
 const error={code:'22023',details:JSON.stringify(details)};
 expect(getOrderMinimumPreview(error)?.merchandiseAmount).toBe(4650);
 expect(getOrderMinimumPreview({...error,code:'42501'})).toBeNull();
 expect(getOrderMinimumPreview({...error,details:'invalid'})).toBeNull();
 expect(getOrderMinimumPreview({...error,details:JSON.stringify({...details,remaining:1})})).toBeNull();
 expect(getOrderMinimumPreview({...error,details:JSON.stringify({...details,merchandise_amount:5022})})).toBeNull();
 const projected=getOrderMinimumPreview({...error,details:JSON.stringify({...details,pricing_snapshot:{private:true},adjustments:[{...details.adjustments[0],qualification:{private:true}}]})});
 expect(JSON.stringify(projected)).not.toContain('private');
});

test('cart shows qualified activity, authoritative payable and shortage, then clears preview after adding goods',async({page})=>{
 await mockEcladoApis(page);
 let malformed=false; let slow=false;
 await page.route('**/rest/v1/rpc/quote_order_pricing',async route=>{
  const qty=route.request().postDataJSON().p_items[0].qty;
  if(slow) await new Promise(resolve=>setTimeout(resolve,350));
  if(qty===1) return route.fulfill({status:400,json:{code:'22023',message:'專業會員單筆訂單最低金額為 NT$ 5,000',details:malformed?'invalid':JSON.stringify(details)}});
  return route.fulfill({json:{items:[],subtotal:5859,discount:372,shipping:120,total:5607,adjustments:details.adjustments}});
 });
 await page.goto('/shop'); await page.getByText('胜肽修護精華液').first().click();
 await page.getByRole('button',{name:/加入購物車/}).click();
 await page.locator('nav').getByRole('button',{name:/^購物車/}).click();
 const cart=page.getByRole('dialog',{name:'購物車'}); const notice=cart.getByTestId('cart-minimum-preview');
 await expect(notice).toContainText('已達活動優惠條件');
 await expect(notice).toContainText('優惠後商品金額：NT$ 4,650（不含運費）');
 await expect(notice).toContainText('還差 NT$ 350');
 await expect(cart.getByText('−NT$ 930',{exact:true})).toBeVisible();
 await expect(cart.getByText('+NT$ 558',{exact:true})).toBeVisible();
 await expect(cart.getByRole('button',{name:'前往結帳',exact:true})).toBeDisabled();
 slow=true;await cart.getByRole('button',{name:'+',exact:true}).click();
 await expect(notice).toHaveCount(0);await expect(cart.getByText('NT$ 5,607',{exact:true})).toBeVisible();
 await expect(cart.getByRole('button',{name:'前往結帳',exact:true})).toBeEnabled();
 malformed=true;await cart.getByRole('button',{name:'−',exact:true}).click();
 await expect(cart.getByText('優惠金額暫時無法確認，將於結帳時重新計算。')).toBeVisible();await expect(notice).toHaveCount(0);
 await expect(cart.getByRole('button',{name:'前往結帳',exact:true})).toBeDisabled();
});


for (const view of ['full cart', 'cart drawer']) {
 test(`${view} without an applied activity shows a compact actual minimum shortfall`,async({page})=>{
  await mockEcladoApis(page);
  await page.route('**/rest/v1/rpc/quote_order_pricing',route=>route.fulfill({status:400,json:{code:'22023',message:'專業會員單筆訂單最低金額為 NT$ 5,000',details:JSON.stringify({...details,subtotal:4620,discount:0,merchandise_amount:4620,remaining:380,adjustments:[]})}}));
  await page.goto('/shop');await page.getByText('胜肽修護精華液').first().click();await page.getByRole('button',{name:/加入購物車/}).click();
  if (view === 'full cart') await page.goto('/cart');
  else await page.locator('nav').getByRole('button',{name:/^購物車/}).click();
  const cart = view === 'full cart' ? page.locator('body') : page.getByRole('dialog',{name:'購物車'});
  const notice=cart.getByTestId('cart-shipping-progress');
  await expect(notice).toHaveText('尚差 NT$380 可達最低訂購門檻。');
  await expect(cart.getByTestId('cart-minimum-preview')).toHaveCount(0);
  await expect(cart.getByText(/優惠後商品金額|已達活動優惠條件|折後滿/)).toHaveCount(0);
  if (view === 'cart drawer') await expect(cart.getByTestId('cart-summary-header').getByTestId('cart-shipping-progress')).toBeVisible();
  await expect(cart.getByRole('button',{name:'前往結帳',exact:true})).toBeDisabled();
  expect(await page.locator('body').evaluate(el=>el.scrollWidth<=window.innerWidth)).toBe(true);
 });
}
