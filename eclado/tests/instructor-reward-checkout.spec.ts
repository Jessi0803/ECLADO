import {test,expect,type Page} from '@playwright/test';
import {mockEcladoApis,adminProfileRows,mockProducts} from './support/eclado-mocks';
const user={id:'wallet-teacher',email:'wallet@example.test',user_metadata:{name:'老師'},app_metadata:{provider:'email'},aud:'authenticated',role:'authenticated',created_at:'2026-05-01'};
const product={...mockProducts[0],price:2000,pro_price:1000,stock:100};
async function checkout(page:Page,role='instructor',balance=30000){
 await mockEcladoApis(page,{authUser:user,profiles:[{...adminProfileRows[0],id:user.id,email:user.email,role}],products:[product],promotions:[],shoppingCreditByMember:{[user.id]:{available_balance:300,entries:[]}}});
 await page.route('**/rest/v1/rpc/get_my_reward_credit',r=>r.fulfill({json:{available_balance:Math.max(0,balance),balance,reserved_balance:0,version:1}}));
 await page.addInitScript(()=>localStorage.setItem('eclado_cart_v1',JSON.stringify([{id:1,qty:30}])));
 await page.goto('/checkout');
 const inputs=page.locator('form input');await inputs.nth(0).fill('老師');await inputs.nth(1).fill('0912345678');await inputs.nth(2).fill('wallet@example.test');
 await page.getByPlaceholder('縣市').fill('台北市');await page.getByPlaceholder('區域').fill('大安區');await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('測試路1號');
 await page.getByRole('button',{name:/繼續確認付款/}).click();
}
function walletQuote(args:any){const sc=Number(args.p_shopping_credit_amount),rc=Number(args.p_reward_credit_amount);
 return {subtotal:21000,discount:0,shipping:0,total:21000,shopping_credit_amount:sc,reward_credit_amount:rc,payment_amount:21000-sc-rc,reward_account_version:1,
 items:[{product_id:1,id:1,variant_id:1,qty:30,name:product.name_zh,unit_price:700,price:700}],adjustments:[]};}
test('both wallets share one NT$1 payment floor; backend create and bank use the same amount',async({page})=>{
 await checkout(page);let created:any,bank:any;
 await page.route('**/rest/v1/rpc/quote_order_with_wallets',r=>r.fulfill({json:walletQuote(r.request().postDataJSON())}));
 await page.route('**/rest/v1/rpc/create_order_with_wallets',r=>{created=r.request().postDataJSON();return r.fulfill({json:{...walletQuote(created),order_id:'WALLET-ONE',payment_token:'test-token'}});});
 await page.route('https://pay.ecladotaiwan.com/api/sinopac/create-payment',r=>{bank=r.request().postDataJSON();return r.fulfill({json:{ok:true,paymentLink:'https://sandbox.sinopac.test/pay',response:{Status:'S'},order:{id:'WALLET-ONE',payment_amount:1,total:21000}}});});
 await page.getByRole('switch',{name:'使用購物金',exact:true}).click();await page.getByLabel('購物金使用金額').fill('300');
 await page.getByRole('switch',{name:'使用返饋金',exact:true}).click();await expect(page.getByLabel('返饋金使用金額')).toHaveValue('20699');
 await page.getByRole('button',{name:/建立付款單/}).click();await expect.poll(()=>created?.p_reward_credit_amount).toBe(20699);
 expect(created.p_shopping_credit_amount).toBe(300);expect(created.p_expected_quote.payment_amount).toBe(1);await expect.poll(()=>bank?.amount).toBe(1);
});
test('wallet repricing requires confirmation; refusal creates no order',async({page})=>{
 await checkout(page);let writes=0;await page.getByRole('switch',{name:'使用返饋金',exact:true}).click();await page.getByLabel('返饋金使用金額').fill('300');
 await page.route('**/rest/v1/rpc/quote_order_with_wallets',r=>r.fulfill({json:{...walletQuote(r.request().postDataJSON()),total:21100,shipping:100,payment_amount:20800}}));
 await page.route('**/rest/v1/rpc/create_order_with_wallets',r=>{writes++;return r.fulfill({json:{}});});
 const dialog=new Promise<void>(resolve=>page.once('dialog',async d=>{await d.dismiss();resolve();}));
 await page.getByRole('button',{name:/建立付款單/}).click();await dialog;expect(writes).toBe(0);
});
test('insufficient server balance prevents creation and shows clear failure',async({page})=>{
 await checkout(page);let writes=0;await page.getByRole('switch',{name:'使用返饋金',exact:true}).click();
 await page.route('**/rest/v1/rpc/quote_order_with_wallets',r=>r.fulfill({status:400,json:{code:'22003',message:'可用返饋金不足'}}));
 await page.route('**/rest/v1/rpc/create_order_with_wallets',r=>{writes++;return r.fulfill({json:{}});});
 await page.getByRole('button',{name:/建立付款單/}).click();await expect(page.getByText('可用返饋金不足',{exact:false})).toBeVisible();expect(writes).toBe(0);
});
for(const balance of [0,-100])test(`nonpositive balance ${balance} disables reward spending`,async({page})=>{await checkout(page,'instructor',balance);await expect(page.getByRole('switch',{name:'使用返饋金'})).toBeDisabled();});
test('pro has no reward credit spending entrance',async({page})=>{await checkout(page,'pro');await expect(page.getByRole('switch',{name:'使用返饋金'})).toHaveCount(0);});
