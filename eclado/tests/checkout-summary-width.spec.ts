import { test, expect, type Page } from '@playwright/test';
import { mockEcladoApis } from './support/eclado-mocks';

const longActivity='11.11 限定｜呼吸系列 任5件贈送1件（加贈拉伸化妝棉）-'+ 'BREATHING-SERIES-PROMOTION-'.repeat(8);
const longGift='贈 Eclado拉伸化妝棉｜'+ '加贈商品說明'.repeat(12);
async function expectContained(page:Page){
 await expect(page.getByTestId('checkout-order-summary').getByText(longActivity,{exact:true})).toBeVisible();
 const sizes=await page.evaluate(()=>{
  const card=document.querySelector('[data-testid="checkout-order-summary"]')!;const rect=card.getBoundingClientRect();
  return {viewport:window.innerWidth,page:document.documentElement.scrollWidth,left:rect.left,right:rect.right,cardWidth:rect.width,cardScroll:card.scrollWidth};
 });
 expect(sizes.page).toBeLessThanOrEqual(sizes.viewport);expect(sizes.left).toBeGreaterThanOrEqual(0);
 expect(sizes.right).toBeLessThanOrEqual(sizes.viewport);expect(sizes.cardScroll).toBeLessThanOrEqual(sizes.cardWidth+1);
 const name=page.getByTestId('checkout-order-summary').getByText(longActivity,{exact:true});
 const nameBounds=await name.boundingBox();expect(nameBounds?.height).toBeGreaterThan(20);
 await expect(page.getByTestId('checkout-order-summary').getByText('−NT$ 930',{exact:true})).toBeVisible();
 await expect(page.getByTestId('checkout-order-summary').getByText('贈品 × 1',{exact:true})).toBeVisible();
}
for(const width of [320,390,1280])test(`checkout activity and gift text stays inside ${width}px viewport in both steps`,async({page})=>{
 await page.setViewportSize({width,height:900});await mockEcladoApis(page);
 await page.route('**/rest/v1/rpc/quote_order_pricing',async route=>{
  const original=route.request().postDataJSON().p_items[0];
  return route.fulfill({json:{items:[{...original,nameZh:'呼吸安瓶',name:'呼吸安瓶',qty:7,unit_price:930,line_total:6510,fulfillment_type:'preorder',size:'30ml'},
   {product_id:991,variant_id:991,promotion_id:'gift',name:longGift,nameZh:longGift,size:'200抽',qty:1,unit_price:0,line_total:0,is_gift:true,line_type:'gift'}],
   subtotal:6510,discount:930,shipping:120,total:5700,adjustments:[{promotion_id:'bogo',name:longActivity,amount:930,adjustment_type:'buy_x_get_y'},
   {promotion_id:'gift',name:longGift,amount:0,gift_quantity:1,adjustment_type:'quantity_gift'}]}});
 });
 await page.goto('/shop');await page.getByText('胜肽修護精華液').first().click();await page.getByRole('button',{name:/加入購物車/}).click();
 await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));
 expect(await page.evaluate(()=>window.scrollY)).toBeGreaterThan(0);
 await page.locator('nav').getByRole('button',{name:/^購物車/}).click();await page.getByRole('button',{name:'前往結帳',exact:true}).click();
 await page.getByRole('button',{name:'訪客結帳',exact:true}).click();await expectContained(page);
 await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);
 const expectLayout=async()=>{
  const summary=await page.getByTestId('checkout-order-summary').boundingBox();
  const fields=await page.getByTestId('checkout-fields').boundingBox();
  expect(summary).not.toBeNull();expect(fields).not.toBeNull();
  if(width<=900)expect(summary!.y+summary!.height).toBeLessThanOrEqual(fields!.y);
  else expect(summary!.x).toBeGreaterThan(fields!.x+fields!.width);
 };
 await expectLayout();
 const inputs=page.locator('form input');await inputs.nth(0).fill('TEST');await inputs.nth(1).fill('0900000000');await inputs.nth(2).fill('layout@example.test');
 await page.getByPlaceholder('縣市').fill('TEST');await page.getByPlaceholder('區域').fill('TEST');await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('TEST');
 await page.getByRole('button',{name:'繼續確認付款',exact:true}).click();await expectContained(page);
 await expectLayout();
 if(width<=900){
  await expect.poll(async()=>Math.abs((await page.getByTestId('checkout-fields').boundingBox())!.y-84)).toBeLessThanOrEqual(3);
  await page.getByRole('button',{name:'修改',exact:true}).first().click();
  await expect(page.getByPlaceholder('縣市')).toHaveValue('TEST');
  await expect.poll(async()=>Math.abs((await page.getByTestId('checkout-fields').boundingBox())!.y-84)).toBeLessThanOrEqual(3);
 }
});
