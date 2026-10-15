import {test,expect,type Page} from '@playwright/test';
import {mockEcladoApis,adminProfileRows,adminProductRows} from './support/eclado-mocks';
import {canAccessBackofficePage} from '../src/admin/domain/access.js';
const permissions=['orders.read','members.read','rewards.withdrawals.read','rewards.withdrawals.manage','notifications.send'];
const authUser={id:'11111111-1111-4111-8111-111111111111',email:'admin@example.test',user_metadata:{name:'測試管理員'},app_metadata:{provider:'email'},aud:'authenticated',role:'authenticated',created_at:'2026-05-01'};
const notification={id:'notice',withdrawal_id:'withdrawal',event_type:'requested',audience:'teacher',recipient_mask:'t***@example.test',status:'failed',channel:'email',line_attempts:1,email_attempts:6,version:1,last_error:'permanent'};
async function setup(page:Page,p=permissions){
 await mockEcladoApis(page,{authUser,products:adminProductRows,profiles:adminProfileRows,adminAccess:true,backofficeAccess:{role:'admin',permissions:p}});
 await page.route('**/rest/v1/rpc/get_admin_reward_notifications',r=>r.fulfill({json:{total:1,notifications:[notification],attempts:[],corrections:[{id:1,withdrawal_id:'withdrawal',created_at:'2026-10-13'}]}}));
 await page.route('**/rest/v1/rpc/get_admin_reward_reconciliation',r=>r.fulfill({json:{total:1,runs:[{id:'run',scope:'all_reward_finances',status:'complete',snapshot_at:'2026-10-13',checked_count:50,finding_count:1}],findings:[{id:1,rule:'withdrawal_unknown',source:'withdrawal',expected:{action:'manual_review'},actual:{status:'unknown'},present:true,first_seen_at:'2026-10-13',last_seen_at:'2026-10-13'}]}}));
 await page.goto('/admin');
}
async function open(page:Page,label:string){if((page.viewportSize()?.width||0)<=900)await page.getByRole('button',{name:'開啟選單'}).click();await page.locator('.app-sidebar button:not(.sidebar-star)').filter({hasText:'師資返饋管理'}).click();await page.getByRole('tab',{name:label==='返饋金通知紀錄'?'通知紀錄':'財務對帳',exact:true}).click();}
test('unified reward management preserves tab permissions and switches reports',async({page})=>{
 await setup(page);await open(page,'返饋金通知紀錄');
 await expect(page.getByRole('heading',{name:'師資返饋管理',exact:true})).toBeVisible();
 await expect(page.getByRole('tablist',{name:'師資返饋管理功能'}).getByRole('tab')).toHaveCount(4);
 await page.getByRole('tab',{name:'財務對帳',exact:true}).click();
 await expect(page.getByText('待人工查核',{exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'通知紀錄',exact:true}).click();
 await expect(page.getByText(/t\*\*\*@example.test/)).toBeVisible();
});
test('withdrawal-only administrator sees unified entrance without account or reconciliation tabs',async({page})=>{
 await setup(page,['rewards.withdrawals.read']);await open(page,'返饋金通知紀錄');
 await expect(page.getByRole('tab',{name:'返饋帳務',exact:true})).toHaveCount(0);
 await expect(page.getByRole('tab',{name:'財務對帳',exact:true})).toHaveCount(0);
 await expect(page.getByRole('tab',{name:'提領匯款',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'確認另寄新版本'})).toHaveCount(0);
});
test('shared refresh queries only active tab without running reconciliation; tabs fit their contents',async({page})=>{
 await setup(page);const counts=[0,0,0,0];let runs=0;
 const endpoints=['get_admin_instructor_reward_accounts','get_admin_reward_withdrawals','get_admin_reward_notifications','get_admin_reward_reconciliation'];
 for(const [i,name]of endpoints.entries())await page.route(`**/rest/v1/rpc/${name}`,r=>{counts[i]++;return r.fulfill({json:{total:0,accounts:[],withdrawals:[],notifications:[],runs:[],findings:[]}});});
 await page.route('**/rest/v1/rpc/run_reward_reconciliation',r=>{runs++;return r.fulfill({json:{}});});
 await open(page,'返饋金通知紀錄');
 for(const [i,label]of ['返饋帳務','提領匯款','通知紀錄','財務對帳'].entries()){
  const beforeSwitch=counts[i];await page.getByRole('tab',{name:label,exact:true}).click();await expect.poll(()=>counts[i]).toBeGreaterThan(beforeSwitch);
  const before=[...counts];await expect(page.getByRole('button',{name:'重新整理',exact:true})).toHaveCount(1);
  await page.getByRole('button',{name:'重新整理',exact:true}).click();await expect.poll(()=>counts[i]).toBe(before[i]+1);
  expect(counts.filter((_,j)=>j!==i)).toEqual(before.filter((_,j)=>j!==i));
 }
 expect(runs).toBe(0);
 const size=await page.getByRole('tablist',{name:'師資返饋管理功能'}).evaluate(el=>({width:el.getBoundingClientRect().width,buttons:[...el.children].reduce((sum,child)=>sum+child.getBoundingClientRect().width,0)}));
 expect(size.width).toBeLessThanOrEqual(size.buttons+3);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('notification report is masked and uses original responsive styles',async({page})=>{
 await setup(page);await open(page,'返饋金通知紀錄');await expect(page.getByRole('heading',{name:'返饋金通知紀錄'})).toBeVisible();await expect(page.getByText(/t\*\*\*@example.test/)).toBeVisible();await expect(page.getByText(/Email 嘗試 6 次/)).not.toBeVisible();
 await expect(page.getByRole('button',{name:'重試原通知'})).toBeVisible();
 await page.getByText('詳細資料與重試紀錄',{exact:true}).click();await expect(page.getByText(/Email 嘗試 6 次/)).toBeVisible();
 await page.getByText('詳細資料與重試紀錄',{exact:true}).click();await expect(page.getByText(/Email 嘗試 6 次/)).not.toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('pending notice remains compact with no resend controls and retains detailed attempts',async({page})=>{
 await setup(page);await page.route('**/rest/v1/rpc/get_admin_reward_notifications',r=>r.fulfill({json:{total:1,notifications:[{...notification,status:'pending',last_attempt_at:'2026-10-15T01:00:00Z'}],attempts:[{notification_id:'notice',created_at:'2026-10-15T01:00:00Z',action:'manual:retry',result:'queued'}],corrections:[]}}));
 await open(page,'返饋金通知紀錄');await expect(page.getByRole('button',{name:'重試原通知'})).toHaveCount(0);await expect(page.getByRole('button',{name:'確認另寄新版本'})).toHaveCount(0);
 await expect(page.getByText(/最後嘗試.*09:00:00/)).toBeVisible();await expect(page.getByText(/人工補發.*queued/)).not.toBeVisible();
 await page.getByText('詳細資料與重試紀錄',{exact:true}).click();await expect(page.getByText(/人工補發.*queued/)).toBeVisible();
});
test('read-only permissions hide supplement and correction actions',async({page})=>{
 await setup(page,['orders.read','members.read','rewards.withdrawals.read']);await open(page,'返饋金通知紀錄');await expect(page.getByRole('button',{name:'確認另寄新版本'})).toHaveCount(0);await expect(page.getByRole('button',{name:'確認發送更正說明'})).toHaveCount(0);
});
test('manual supplement retries same key after unknown response',async({page})=>{
 await setup(page);const args:any[]=[];await page.route('**/rest/v1/rpc/retry_reward_notification',r=>{args.push(r.request().postDataJSON());return args.length===1?r.fulfill({status:503,json:{code:'503',message:'mock unknown'}}):r.fulfill({json:'notice2'});});await open(page,'返饋金通知紀錄');
 page.on('dialog',d=>d.accept(d.type()==='prompt'?'隔離補發':' '));await page.getByRole('button',{name:'確認另寄新版本'}).click();await expect(page.getByRole('button',{name:'重送原操作'})).toBeVisible();await page.getByRole('button',{name:'重新整理',exact:true}).click();await page.getByRole('button',{name:'重送原操作'}).click();await expect.poll(()=>args.length).toBe(2);expect(args[0]).toEqual(args[1]);expect(args[0].p_new_version).toBe(true);
});
test('explicit correction sends only immutable event ID and request key',async({page})=>{
 await setup(page);let args:any;await page.route('**/rest/v1/rpc/queue_reward_correction_notice',r=>{args=r.request().postDataJSON();return r.fulfill({json:'correction_notice'});});await open(page,'返饋金通知紀錄');page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'確認發送更正說明'}).click();await expect.poll(()=>args?.p_event_id).toBe(1);expect(Object.keys(args).sort()).toEqual(['p_event_id','p_key']);
});
test('reconciliation lists pending review and executes no financial corrections',async({page})=>{
 await setup(page);let args:any;await page.route('**/rest/v1/rpc/run_reward_reconciliation',r=>{args=r.request().postDataJSON();return r.fulfill({json:{id:'run2',status:'complete',checked:50,findings:1}});});await open(page,'返饋金財務對帳');await expect(page.getByText('待人工查核',{exact:true})).toBeVisible();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'執行財務對帳'}).click();await expect.poll(()=>args?.p_request_key).toMatch(/^[0-9a-f-]{36}$/);expect(Object.keys(args)).toEqual(['p_request_key']);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('reconciliation explains mismatch in Chinese and keeps raw codes in collapsed details',async({page})=>{
 await setup(page);await page.route('**/rest/v1/rpc/get_admin_reward_reconciliation',r=>r.fulfill({json:{total:1,runs:[],findings:[{id:1,rule:'account_ledger',source:'demo-teacher',expected:{balance:1000,pending:0,shopping_hold:0,withdrawal_hold:0},actual:{balance:1100,pending:0,shopping_hold:0,withdrawal_hold:0},present:true}]}}));
 await open(page,'返饋金財務對帳');await expect(page.getByRole('heading',{name:'帳戶與帳務明細不一致',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'預期應有資料'}).getByText('NT$ 1,000',{exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'目前實際資料'}).getByText('NT$ 1,100',{exact:true})).toBeVisible();
 await expect(page.getByText('異常代碼：account_ledger',{exact:true})).not.toBeVisible();await page.getByText('技術明細',{exact:true}).click();await expect(page.getByText('異常代碼：account_ledger',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('query failure clears previous report instead of exposing stale records',async({page})=>{
 await setup(page);await open(page,'返饋金通知紀錄');await expect(page.getByText(/t\*\*\*@example.test/)).toBeVisible();await page.route('**/rest/v1/rpc/get_admin_reward_notifications',r=>r.fulfill({status:403,json:{code:'42501',message:'denied'}}));await page.getByRole('button',{name:'重新整理',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByText(/t\*\*\*@example.test/)).toHaveCount(0);
});
test('uninstalled stage 6 shows explicit installation message',async({page})=>{
 await setup(page);await page.route('**/rest/v1/rpc/get_admin_reward_notifications',r=>r.fulfill({status:404,json:{code:'PGRST202',message:'missing'}}));await open(page,'返饋金通知紀錄');await expect(page.getByRole('alert')).toHaveText(/尚未安裝/);
});
test('access policies require dedicated report capability and active administrator role',()=>{
 expect(canAccessBackofficePage({role:'catalog_editor',permissions},'reward_notifications')).toBe(false);
 expect(canAccessBackofficePage({role:'admin',permissions:['orders.read']},'reward_notifications')).toBe(false);
 expect(canAccessBackofficePage({role:'admin',permissions:['orders.read']},'reward_reconciliation')).toBe(false);
});
