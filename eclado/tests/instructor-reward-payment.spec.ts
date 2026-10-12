import {test,expect,type Page} from '@playwright/test';
import {mockEcladoApis,adminProfileRows,adminOrderRows,adminProductRows} from './support/eclado-mocks';
async function open(page:Page,write=true){
  const user={id:'reward-admin',email:'reward-admin@example.test',user_metadata:{name:'管理員'},app_metadata:{provider:'email'},aud:'authenticated',role:'authenticated',created_at:'2026-05-01'};
  await mockEcladoApis(page,{authUser:user,adminAccess:true,orders:adminOrderRows,products:adminProductRows,profiles:[{...adminProfileRows[0],id:user.id,email:user.email}],
    backofficeAccess:{role:'admin',permissions:write?['orders.read','orders.write','members.read','catalog.read']:['orders.read']}});
  await page.goto('/admin');
  if((page.viewportSize()?.width||0)<=900)await page.getByRole('button',{name:'開啟選單'}).click();
  await page.locator('.app-sidebar button:not(.sidebar-star)').filter({hasText:'訂單管理'}).first().click();
  await page.getByText('E2E-ORDER-001',{exact:true}).click();
  return page.getByRole('dialog',{name:'訂單詳情'});
}
test('manual reward receipt requires explicit confirmation; refusal does not write',async({page})=>{
  const panel=await open(page);let writes=0;let received:any;
  await page.route('**/rest/v1/rpc/get_admin_reward_payment_requirement',r=>r.fulfill({json:{applicable:true,confirmed:false}}));
  await page.route('**/rest/v1/rpc/confirm_admin_instructor_reward_payment',r=>{writes++;received=r.request().postDataJSON();return r.fulfill({json:{applicable:true,confirmed:true}});});
  const dismissed=new Promise<void>(resolve=>page.once('dialog',async d=>{await d.dismiss();resolve();}));
  await panel.getByRole('button',{name:'確認人工收款'}).click();await dismissed;
  expect(writes).toBe(0);
  const accepted=new Promise<void>(resolve=>page.once('dialog',async d=>{await d.accept();resolve();}));
  await panel.getByRole('button',{name:'確認人工收款'}).click();await accepted;
  await expect(page.getByText('已保存收款確認紀錄。')).toBeVisible();expect(writes).toBe(1);
  expect(received).toEqual({p_order_id:'E2E-ORDER-001',p_confirmed:true});
});
test('read-only backoffice cannot see the manual payment confirmation action',async({page})=>{
  const panel=await open(page,false);await expect(panel.getByRole('button',{name:'確認人工收款'})).toHaveCount(0);
});
test('installed dependency errors cannot silently become pre-2B compatibility',async({page})=>{
  const panel=await open(page);let writes=0;
  await page.route('**/rest/v1/rpc/get_admin_reward_payment_requirement',r=>r.fulfill({status:400,json:{code:'42883',message:'isolated dependency failure'}}));
  await page.route('**/rest/v1/rpc/confirm_admin_instructor_reward_payment',r=>{writes++;return r.fulfill({json:{}});});
  await panel.getByRole('button',{name:'確認人工收款'}).click();
  await expect(page.getByText('收款確認失敗：isolated dependency failure')).toBeVisible();expect(writes).toBe(0);
});
