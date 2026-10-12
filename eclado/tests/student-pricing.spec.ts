import {expect,test,type Page} from '@playwright/test';
import {mockEcladoApis,adminProductRows,adminProfileRows} from './support/eclado-mocks';
import {getMemberPrice,applyVariantToProduct} from '../src/domain/catalog.jsx';
const user={id:'student-e2e',email:'student@example.test',user_metadata:{name:'學生'},app_metadata:{provider:'email'},aud:'authenticated',role:'authenticated',created_at:'2026-05-01'};
const product={...adminProductRows[0],id:1,name_zh:'學生測試商品',name:'Student Product',price:2000,pro_price:1000,
  instructor_price_multiplier:null,distributor_price_multiplier:null,staff_price_multiplier:null,
  pricing_defaults:{instructor:0.7,distributor:0.65,staff:0.5}};
const variants=[{id:101,product_id:1,sku:'S1',size:'100ml',price:2000,pro_price:1000,stock:20,is_default:true,sort_order:0,active:true},
  {id:102,product_id:1,sku:'S2',size:'200ml',price:4000,pro_price:2000,stock:20,is_default:false,sort_order:1,active:true}];
async function setup(page:Page){
  await mockEcladoApis(page,{authUser:user,profiles:[{...adminProfileRows[0],id:user.id,email:user.email,role:'pro'}],
    products:[product],productVariants:variants,promotions:[]});
}
test('student price display is identity scoped; six original roles remain unchanged',()=>{
  const base={id:1,price:2000,proPrice:1000,pricingOverrides:{instructor:null,distributor:null,staff:null},pricingDefaults:product.pricing_defaults};
  const tagged={...base,studentPriceUserId:'student',studentDefaultVariantId:101,studentUnitPrices:{101:900,102:1800}};
  for(const [role,expected]of [['consumer',2000],['pending',2000],['pro',1000],['instructor',700],['distributor',650],['staff',500]] as const){
    expect(getMemberPrice(tagged,{uid:'other',role})).toBe(expected);
  }
  expect(getMemberPrice(tagged,{uid:'student',role:'pro'})).toBe(900);
  expect(getMemberPrice(applyVariantToProduct(tagged,{id:102,size:'200ml',price:4000,proPrice:2000}),{uid:'student',role:'pro'})).toBe(1800);
});
test('server student prices reach list, variants and cart; focus changes refresh them',async({page})=>{
  await setup(page);let unit=900;
  await page.route('**/rest/v1/rpc/get_my_student_product_prices',route=>route.fulfill({json:{enabled:true,prices:[
    {product_id:1,variant_id:101,unit_price:unit},{product_id:1,variant_id:102,unit_price:unit*2}]}}));
  await page.goto('/shop');await expect(page.getByText('學生專屬價').first()).toBeVisible();
  await expect(page.getByText('NT$ 900',{exact:true}).first()).toBeVisible();
  await page.getByText('學生測試商品').first().click();await page.getByRole('button',{name:'200ml',exact:true}).click();
  await expect(page.getByText('NT$ 1,800',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:/加入購物車/}).click();
  await page.locator('nav').getByRole('button',{name:/^購物車/}).click();
  const cart=page.getByRole('dialog',{name:'購物車'});await expect(cart.getByText('NT$ 1,800',{exact:true}).first()).toBeVisible();
  unit=950;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(cart.getByText('NT$ 1,900',{exact:true}).first()).toBeVisible();
});
test('OFF or pre-1C database preserves professional prices',async({page})=>{
  await setup(page);
  await page.route('**/rest/v1/rpc/get_my_student_product_prices',route=>route.fulfill({status:404,json:{code:'PGRST202',message:'1C not installed'}}));
  await page.goto('/shop');await expect(page.getByText('NT$ 1,000',{exact:true}).first()).toBeVisible();
  await expect(page.getByText('學生專屬價')).toHaveCount(0);
});
test('price lookup failure is not mistaken for OFF',async({page})=>{
  await setup(page);
  await page.route('**/rest/v1/rpc/get_my_student_product_prices',route=>route.fulfill({status:503,json:{code:'503',message:'temporarily unavailable'}}));
  await page.goto('/shop');await expect(page.getByText('會員價格暫時無法確認，請重新整理後再結帳。')).toBeVisible();
});
test('assisted manual equality stays MANUAL and AUTO uses server preview',async({page})=>{
  await mockEcladoApis(page,{authUser:user,profiles:[{...adminProfileRows[0],id:user.id,email:user.email,role:'consumer'}],products:[product],productVariants:variants,
    backofficeAccess:{role:'admin',permissions:['orders.read','orders.write','members.read','catalog.read']}});
  let mode='';
  await page.route('**/rest/v1/rpc/quote_assisted_order',route=>{
    const payload=route.request().postDataJSON().p_payload;mode=payload.items[0].price_mode;
    const price=mode==='AUTO'?1800:payload.items[0].unit_price;
    return route.fulfill({json:{price_modes_supported:true,subtotal:price,discount:0,shipping:120,total:price+120,default_shipping:120,payment_amount:price+120,items:[{variant_id:101,unit_price:price}],adjustments:[]}});
  });
  await page.goto('/admin');if((page.viewportSize()?.width||0)<=900)await page.getByRole('button',{name:'開啟選單'}).click();
  await page.locator('.app-sidebar button:not(.sidebar-star)').filter({hasText:'訂單管理'}).first().click();
  await page.getByRole('button',{name:'新增代客訂單'}).click();
  const dialog=page.getByRole('dialog',{name:'新增代客訂單'});
  await dialog.getByLabel('商品 1',{exact:true}).selectOption('1');
  await expect(dialog.getByLabel('單價模式 1')).toHaveValue('AUTO');
  await expect(dialog.getByText('商品 1 後端單價：NT$ 1,800')).toBeVisible();
  await dialog.getByLabel('單價模式 1').selectOption('MANUAL');
  await dialog.getByLabel('成交單價 1').fill('2000'); // Explicit MANUAL stays MANUAL even at suggested retail.
  await expect(dialog.getByLabel('單價模式 1')).toHaveValue('MANUAL');
  await expect.poll(()=>mode).toBe('MANUAL');
  await dialog.getByLabel('單價模式 1').selectOption('AUTO');await expect.poll(()=>mode).toBe('AUTO');
});
test('old assisted backend cannot silently treat AUTO as manual',async({page})=>{
  await mockEcladoApis(page,{authUser:user,profiles:[{...adminProfileRows[0],id:user.id,email:user.email,role:'consumer'}],products:[product],productVariants:variants,
    backofficeAccess:{role:'admin',permissions:['orders.read','orders.write','members.read','catalog.read']}});
  await page.route('**/rest/v1/rpc/quote_assisted_order',route=>route.fulfill({json:{subtotal:2000,discount:0,shipping:120,total:2120,items:[],payment_amount:2120}}));
  let writes=0;await page.route('**/rest/v1/rpc/create_assisted_order',route=>{writes++;return route.fulfill({json:{order_id:'should-not-exist'}});});
  await page.goto('/admin');if((page.viewportSize()?.width||0)<=900)await page.getByRole('button',{name:'開啟選單'}).click();
  await page.locator('.app-sidebar button:not(.sidebar-star)').filter({hasText:'訂單管理'}).first().click();
  await page.getByRole('button',{name:'新增代客訂單'}).click();
  const dialog=page.getByRole('dialog',{name:'新增代客訂單'});
  await dialog.getByLabel('商品 1',{exact:true}).selectOption('1');
  await expect(dialog.getByText(/後端尚未支援 AUTO 計價/)).toBeVisible();
  expect(writes).toBe(0);
});
