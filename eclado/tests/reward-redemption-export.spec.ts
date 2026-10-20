import {test,expect,type Page} from '@playwright/test';
import fs from 'node:fs/promises';
import {mockEcladoApis,adminProductRows,adminProfileRows} from './support/eclado-mocks';
async function open(page:Page,allowed=true){
  const user={id:'export-admin',email:'export@example.test',user_metadata:{name:'管理員'},app_metadata:{provider:'email'},aud:'authenticated',role:'authenticated',created_at:'2026-05-01'};
  await mockEcladoApis(page,{authUser:user,products:adminProductRows,profiles:[{...adminProfileRows[0],id:user.id}],backofficeAccess:{role:'admin',permissions:allowed?['orders.read','members.read','catalog.read']:['orders.read']}});
  await page.goto('/admin');if((page.viewportSize()?.width||0)<=900)await page.getByRole('button',{name:'開啟選單'}).click();
  if(allowed)await page.locator('.app-sidebar button:not(.sidebar-star)').filter({hasText:'師資返饋管理'}).click();
  return page.getByRole('region',{name:'返饋金折抵紀錄匯出'});
}
test('export uses server filters and all returned rows, Chinese statuses and safe CSV text',async({page})=>{
  const panel=await open(page);let args:any;
  await page.route('**/rest/v1/rpc/export_admin_reward_redemptions',r=>{args=r.request().postDataJSON();return r.fulfill({json:{export_id:'audit',count:25,rows:Array.from({length:25},(_,i)=>({order_id:`ORDER-${i}`,created_at:'2026-10-19T16:00:00Z',instructor_name:i===0?'=SUM(1,2)':'老師,"甲"',total:1000,shopping_credit_amount:100,reward_credit_amount:300,payment_amount:600,order_status:'returned',redemption_status:'refunded',consumed_amount:300,refunded_amount:300,consumed_at:null,refunded_at:'2026-10-20T01:00:00Z',released_at:null,payment_exception:false}))}});});
  await panel.getByLabel('折抵匯出建單起日').fill('2026-10-20');await panel.getByLabel('折抵匯出建單迄日').fill('2026-10-21');
  await panel.getByLabel('折抵匯出搜尋').fill('老師');await panel.getByLabel('折抵匯出狀態').selectOption('refunded');
  const download=page.waitForEvent('download');await panel.getByRole('button',{name:'匯出折抵紀錄 CSV'}).click();const file=await download;
  const csv=await fs.readFile((await file.path())!,'utf8');
  expect(args).toEqual({p_start_date:'2026-10-20',p_end_date:'2026-10-21',p_search:'老師',p_status:'refunded'});
  expect(csv.charCodeAt(0)).toBe(0xfeff);expect(csv).toContain('ORDER-24');expect(csv).toContain('已返還');expect(csv).toContain('2026-10-20 00:00:00');
  expect(csv).toContain('"\'=SUM(1,2)"');expect(csv).toContain('"老師,""甲"""');expect(csv).not.toContain('銀行帳號');
  await expect(panel.getByRole('status')).toContainText('25 筆');
});
test('missing migration and denied access cannot appear as successful export',async({page})=>{
  const panel=await open(page);
  await page.route('**/rest/v1/rpc/export_admin_reward_redemptions',r=>r.fulfill({status:404,json:{code:'PGRST202',message:'missing'}}));
  await panel.getByRole('button',{name:'匯出折抵紀錄 CSV'}).click();await expect(panel.getByRole('alert')).toHaveText('返饋金折抵匯出功能尚未安裝。');
  await page.route('**/rest/v1/rpc/export_admin_reward_redemptions',r=>r.fulfill({status:403,json:{code:'42501',message:'返饋帳務查詢權限不足'}}));
  await panel.getByRole('button',{name:'匯出折抵紀錄 CSV'}).click();await expect(panel.getByRole('alert')).toContainText('權限不足');
  await expect(panel.getByRole('status')).toHaveCount(0);
});
test('date validation and no reward permission do not request export',async({page})=>{
  const panel=await open(page);let calls=0;await page.route('**/rest/v1/rpc/export_admin_reward_redemptions',r=>{calls++;return r.fulfill({json:{count:0,rows:[]}});});
  await panel.getByLabel('折抵匯出建單起日').fill('2026-10-21');await panel.getByLabel('折抵匯出建單迄日').fill('2026-10-20');
  await panel.getByRole('button',{name:'匯出折抵紀錄 CSV'}).click();await expect(panel.getByRole('alert')).toContainText('不得晚於');expect(calls).toBe(0);
  await open(page,false);await expect(page.getByRole('region',{name:'返饋金折抵紀錄匯出'})).toHaveCount(0);
});
