import {test,expect,type Page} from '@playwright/test';
import {mockEcladoApis,adminProfileRows,adminProductRows} from './support/eclado-mocks';
import {canAccessBackofficePage} from '../src/admin/domain/access.js';
const user={id:'reward-reader',email:'reader@example.test',user_metadata:{name:'返饋老師'},app_metadata:{provider:'email'},aud:'authenticated',role:'authenticated',created_at:'2026-05-01'};
const report={summary:{balance:-12,available_balance:0,pending_balance:100,credited_total:300,reversed_total:312},order_count:21,ledger_count:1,
  orders:[{order_id:'HISTORICAL-OLD-TEACHER',created_at:'2026-10-10T00:00:00Z',order_source:'online',student_name:'歷史學生',student_deleted:false,reward_status:'reversed',total_reward:100,
    items:[{product_id:1,variant_id:1,name:'歷史商品',size:'100ml',qty:2,unit_price:900,reward:100}]}],
  entries:[{id:1,order_id:'HISTORICAL-OLD-TEACHER',event_type:'reverse',amount:100,balance_after:-12,pending_after:100,created_at:'2026-10-11T00:00:00Z'}]};
async function setup(page:Page,role='instructor',permissions?:string[]){
  await mockEcladoApis(page,{authUser:user,adminAccess:!!permissions,products:adminProductRows,
    profiles:[{...adminProfileRows[0],id:user.id,email:user.email,role,name:'返饋老師'}],
    ...(permissions?{backofficeAccess:{role:'admin',permissions}}:{})});
}
async function rewards(page:Page){await page.goto('/account');await page.getByRole('tab',{name:'師資返饋金',exact:true}).click();return page.getByRole('region',{name:'師資返饋金',exact:true});}
test('teacher summary emphasizes available rewards and expands financial details',async({page})=>{
  await setup(page);
  await page.route('**/rest/v1/rpc/get_my_instructor_reward_report',r=>r.fulfill({json:{...report,summary:{...report.summary,reserved_balance:200,withdrawal_reserved_balance:300}}}));
  const panel=await rewards(page),summary=panel.locator('.reward-balance-summary');
  await expect(summary.getByText('可用返饋金',{exact:true})).toBeVisible();
  await expect(summary.getByText('累計已入帳',{exact:true})).not.toBeVisible();
  await expect(summary.getByText('另有 NT$ 200 購物付款處理中。',{exact:true})).toBeVisible();
  await expect(summary.getByText('另有 NT$ 300 提領處理中。',{exact:true})).toBeVisible();
  await summary.getByText('查看金額明細',{exact:true}).click();
  await expect(summary.getByText('累計已入帳',{exact:true})).toBeVisible();
  await expect(summary.getByText('帳戶餘額',{exact:true})).toBeVisible();
  await summary.getByText('查看金額明細',{exact:true}).click();
  await expect(summary.getByText('累計已入帳',{exact:true})).not.toBeVisible();
});
test('teacher scoped report, debt and separate pagination; focus refresh uses no caller teacher ID',async({page})=>{
  await setup(page);const args:any[]=[];
  await page.route('**/rest/v1/rpc/get_my_instructor_reward_report',r=>{const a=r.request().postDataJSON();args.push(a);return r.fulfill({json:{...report,orders:a.p_offset?[{...report.orders[0],order_id:'NEXT-PAGE'}]:report.orders}});});
  const panel=await rewards(page);await expect(panel.getByText('HISTORICAL-OLD-TEACHER · 歷史學生',{exact:true})).toBeVisible();
  await expect(panel.getByText('歷史商品 100ml × 2',{exact:false})).toBeVisible();await expect(panel.getByText('帳戶為負餘額',{exact:false})).toBeVisible();
  await panel.getByRole('button',{name:'訂單下一頁'}).click();await expect(panel.getByText('NEXT-PAGE',{exact:false}).first()).toBeVisible();
  expect(args.at(-1)).toEqual({p_offset:20,p_limit:20,p_ledger_offset:0});
  const count=args.length;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect.poll(()=>args.length).toBeGreaterThan(count);
});
test('permission revocation clears previously loaded data; failed lookup cannot appear as zero balance',async({page})=>{
  await setup(page);let allowed=true;
  await page.route('**/rest/v1/rpc/get_my_instructor_reward_report',r=>allowed?r.fulfill({json:report}):r.fulfill({status:403,json:{code:'42501',message:'師資資格不足'}}));
  const panel=await rewards(page);await expect(panel.getByText('HISTORICAL-OLD-TEACHER · 歷史學生',{exact:true})).toBeVisible();allowed=false;
  await panel.getByRole('button',{name:'重新整理',exact:true}).click();await expect(panel.getByRole('alert')).toHaveText('師資資格不足');
  await expect(panel.getByText('HISTORICAL-OLD-TEACHER · 歷史學生',{exact:true})).toHaveCount(0);await expect(panel.getByText('可用餘額',{exact:true})).toHaveCount(0);
});
test('empty and missing RPC are distinct; pro has no teacher query entrance',async({page})=>{
  await setup(page);let installed=true;
  await page.route('**/rest/v1/rpc/get_my_instructor_reward_report',r=>installed?r.fulfill({json:{...report,orders:[],entries:[],order_count:0,ledger_count:0}}):r.fulfill({status:404,json:{code:'PGRST202',message:'not installed'}}));
  const panel=await rewards(page);await expect(panel.getByText('目前沒有返饋訂單紀錄。')).toBeVisible();installed=false;
  await panel.getByRole('button',{name:'重新整理',exact:true}).click();await expect(panel.getByRole('alert')).toHaveText('返饋查詢尚未安裝。');
});
test('non instructor role cannot see rewards tab',async({page})=>{await setup(page,'pro');await page.goto('/account');await expect(page.getByRole('tab',{name:'師資返饋金'})).toHaveCount(0);});
async function admin(page:Page,permissions:string[]){await setup(page,'consumer',permissions);await page.goto('/admin');if((page.viewportSize()?.width||0)<=900)await page.getByRole('button',{name:'開啟選單'}).click();}
test('admin reads named account history through limited RPC only',async({page})=>{
  await page.route('**/rest/v1/rpc/get_admin_instructor_reward_accounts',r=>r.fulfill({json:{total:1,accounts:[{id:'teacher-history',name:'帳務老師',balance:-12,pending_balance:100,student_count:0,inconsistent:true}]}}));
  await admin(page,['orders.read','members.read','catalog.read']);
  // mock setup routes are registered last, override after setup.
  await page.route('**/rest/v1/rpc/get_admin_instructor_reward_accounts',r=>r.fulfill({json:{total:1,accounts:[{id:'teacher-history',name:'帳務老師',balance:-12,pending_balance:100,student_count:0,inconsistent:true}]}}));
  let args:any;await page.route('**/rest/v1/rpc/get_admin_instructor_reward_report',r=>{args=r.request().postDataJSON();return r.fulfill({json:report});});
  await page.locator('.app-sidebar button:not(.sidebar-star)').filter({hasText:'師資返饋管理'}).click();
  await page.getByRole('button',{name:/帳務老師/}).click();await expect(page.getByText('帳務需查核',{exact:false})).toBeVisible();await expect(page.getByText('HISTORICAL-OLD-TEACHER · 歷史學生',{exact:true})).toBeVisible();
  const dialog=page.getByRole('dialog',{name:'師資返饋帳務明細'});await expect(dialog).toBeVisible();
  await expect(dialog.getByText('HISTORICAL-OLD-TEACHER · 歷史學生',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'關閉師資帳務明細'}).click();await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button',{name:/帳務老師/})).toBeFocused();
  expect(args).toEqual({p_instructor_id:'teacher-history',p_offset:0,p_limit:20,p_ledger_offset:0});
});
test('twenty-account list opens drawer in viewport and preserves page and position on close',async({page})=>{
  await admin(page,['orders.read','members.read','catalog.read']);const offsets:number[]=[];
  await page.route('**/rest/v1/rpc/get_admin_instructor_reward_accounts',r=>{const offset=r.request().postDataJSON().p_offset;offsets.push(offset);return r.fulfill({json:{total:40,accounts:Array.from({length:20},(_,i)=>({id:`teacher-${offset+i+1}`,name:`帳務老師 ${offset+i+1}`,balance:100,pending_balance:0,student_count:1}))}});});
  await page.route('**/rest/v1/rpc/get_admin_instructor_reward_report',r=>r.fulfill({json:report}));
  await page.locator('.app-sidebar button:not(.sidebar-star)').filter({hasText:'師資返饋管理'}).click();
  await expect(page.locator('.reward-account-card')).toHaveCount(20);
  await page.getByRole('button',{name:'下一頁帳戶'}).click();await expect.poll(()=>offsets.at(-1)).toBe(20);
  const trigger=page.locator('.reward-account-card').filter({hasText:'帳務老師 21'});await expect(trigger).toBeVisible();await trigger.scrollIntoViewIfNeeded();const position=await page.evaluate(()=>scrollY),requests=offsets.length;
  await trigger.click();const dialog=page.getByRole('dialog',{name:'師資返饋帳務明細'});await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading',{name:'帳務老師 21 · 返饋帳務'})).toBeInViewport();
  expect(await dialog.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
  if((page.viewportSize()?.width||0)<=900){const width=await dialog.evaluate(el=>el.getBoundingClientRect().width);expect(width).toBeCloseTo(page.viewportSize()!.width,0);await dialog.getByRole('button',{name:'← 返回'}).click();}
  else await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();expect(offsets.length).toBe(requests);expect(offsets.at(-1)).toBe(20);expect(await page.evaluate(()=>scrollY)).toBeCloseTo(position,0);
  await trigger.click();await expect(dialog).toBeVisible();await page.goBack();await expect(dialog).toHaveCount(0);
});
test('backoffice entrance requires both read permissions and admin role',async({page})=>{
  await admin(page,['orders.read']);await expect(page.locator('.app-sidebar button').filter({hasText:'師資返饋管理'})).toHaveCount(0);
  for(const permissions of [['members.read'],['orders.read'],[]])expect(canAccessBackofficePage({role:'admin',permissions},'rewards')).toBe(false);
  expect(canAccessBackofficePage({role:'catalog_editor',permissions:['orders.read','members.read']},'rewards')).toBe(false);
  expect(canAccessBackofficePage({role:'admin',permissions:['orders.read','members.read']},'rewards')).toBe(true);
});
