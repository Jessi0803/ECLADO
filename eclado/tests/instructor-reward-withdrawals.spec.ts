import {test,expect,type Page} from '@playwright/test';
import {mockEcladoApis,adminProfileRows,adminProductRows} from './support/eclado-mocks';
import {canAccessBackofficePage} from '../src/admin/domain/access.js';
const uid='55555555-5555-4555-8555-555555555555';
const user={id:uid,email:'withdrawal@example.test',user_metadata:{name:'提領老師'},app_metadata:{provider:'email'},aud:'authenticated',role:'authenticated',created_at:'2026-05-01'};
const bank={bank_code:'807',bank_name:'隔離銀行',branch:'測試分行',holder:'師*',account:'******1234'};
const deductions={selection_policy:'single_per_batch_v1',income_tax:0,supplementary_premium:0,deduction_policy_version:'tw_withdrawal_v2'};
const summary={selection_policy:'single_per_batch_v1',withdrawal_batch:{batch_date:'2026-11-10',scheduled_date:'2026-11-10',blocked:false},withdrawal_estimate:{...deductions,amount:1000,fee:15,net_amount:985},balance:1000,available_balance:1000,shopping_reserved_balance:200,withdrawal_reserved_balance:0,bank:{version:1,masked:bank},total:0,withdrawals:[]};
const quote={...deductions,amount:1000,fee:15,net_amount:985,account_version:1,bank_version:1,bank,batch_date:'2026-11-10',scheduled_date:'2026-11-10'};
test('invalid withdrawal shows entered zero and dashes; only in-flight preview is calculating',async({page})=>{
 await setup(page);await page.route('**/rest/v1/rpc/get_my_reward_withdrawals',r=>r.fulfill({json:summary}));
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/rest/v1/rpc/quote_my_reward_withdrawal',async r=>{await gate;await r.fulfill({json:{...quote,amount:100,net_amount:85}});});
 const p=await panel(page),input=p.getByLabel('提領金額',{exact:true}),metrics=p.locator('.reward-withdrawal-summary');
 await input.fill('0');await expect(metrics.getByText('NT$ 0',{exact:true})).toHaveCount(1);await expect(metrics.getByText('—',{exact:true})).toHaveCount(4);
 await expect(p.getByText('請輸入至少 NT$16，且不超過可用餘額的整數金額。')).toBeVisible();
 await expect(metrics.getByText(/待更新|試算中/)).toHaveCount(0);await expect(p.getByRole('button',{name:'申請提領',exact:true})).toBeDisabled();
 const request=page.waitForRequest(r=>r.url().includes('quote_my_reward_withdrawal'));await input.fill('100');await request;
 await expect(metrics.getByText('試算中…',{exact:true})).toHaveCount(4);release();
 await expect(metrics.getByText('NT$ 85',{exact:true})).toBeVisible();await expect(metrics.getByText('NT$ 0',{exact:true})).toHaveCount(2);
 await expect(metrics.getByText('試算中…',{exact:true})).toHaveCount(0);
 await page.route('**/rest/v1/rpc/quote_my_reward_withdrawal',r=>r.fulfill({status:400,json:{code:'22023',message:'試算失敗，請重新確認'}}));
 await input.fill('200');await expect(p.getByText('試算失敗，請重新確認',{exact:true})).toBeVisible();
 await expect(metrics.getByText('—',{exact:true})).toHaveCount(4);await expect(metrics.getByText('試算中…',{exact:true})).toHaveCount(0);
});
async function setup(page:Page,permissions?:string[]){await mockEcladoApis(page,{authUser:user,products:adminProductRows,profiles:[{...adminProfileRows[0],id:uid,email:user.email,role:'instructor',name:'提領老師'}],...(permissions?{adminAccess:true,backofficeAccess:{role:'admin',permissions}}:{})});}
async function panel(page:Page){await page.goto('/account');await page.getByRole('tab',{name:'師資返饋金',exact:true}).click();return page.getByRole('region',{name:'返饋金提領',exact:true});}
test('full withdrawal uses authoritative preview and unique request key; bank remains masked',async({page})=>{
 await setup(page);let args:any;await page.route('**/rest/v1/rpc/get_my_reward_withdrawals',r=>r.fulfill({json:summary}));await page.route('**/rest/v1/rpc/quote_my_reward_withdrawal',r=>r.fulfill({json:quote}));await page.route('**/rest/v1/rpc/request_my_reward_withdrawal',r=>{args=r.request().postDataJSON();return r.fulfill({json:{id:'request',status:'pending'}});});
 const p=await panel(page);await expect(p.getByText(/\*\*\*\*\*\*1234/).first()).toBeVisible();await p.getByRole('button',{name:'申請提領'}).click();await page.getByRole('dialog',{name:'確認提領'}).getByRole('button',{name:'確認申請提領'}).click();await expect.poll(()=>args?.p_expected_quote.amount).toBe(1000);expect(args.p_request_key).toMatch(/^[0-9a-f-]{36}$/);expect(args.p_expected_quote.net_amount).toBe(985);
});
for(const balance of [0,15,-1])test(`withdrawal is disabled at available ${balance}`,async({page})=>{await setup(page);await page.route('**/rest/v1/rpc/get_my_reward_withdrawals',r=>r.fulfill({json:{...summary,balance,available_balance:Math.max(0,balance)}}));const p=await panel(page);await expect(p.getByRole('button',{name:'申請提領'})).toBeDisabled();await expect(p.getByText(/可用返饋金須超過 NT\$15/)).toBeVisible();});
test('bank save avoids persistent browser storage and sends no owner ID',async({page})=>{
 await setup(page);let args:any;await page.route('**/rest/v1/rpc/get_my_reward_withdrawals',r=>r.fulfill({json:summary}));await page.route('**/api/reward-bank',r=>{args=r.request().postDataJSON();return r.fulfill({json:{bank,version:2}});});
 const p=await panel(page);await expect(p.getByLabel('收款帳號',{exact:true})).toHaveCount(0);await p.getByRole('button',{name:'編輯',exact:true}).click();for(const [label,value]of [['銀行代碼','807'],['銀行名稱','隔離銀行'],['分行名稱','测试分行'],['收款戶名','测试老師'],['收款帳號','12345678901234']])await p.getByLabel(label,{exact:true}).fill(value);
 await p.getByRole('button',{name:'儲存收款銀行'}).click();await expect.poll(()=>args?.action).toBe('save');expect(args.userId).toBeUndefined();await expect(p.getByLabel('收款帳號',{exact:true})).toHaveCount(0);await p.getByRole('button',{name:'編輯',exact:true}).click();await expect(p.getByLabel('收款帳號',{exact:true})).toHaveValue('');await p.getByLabel('收款帳號',{exact:true}).fill('9876543210');await p.getByRole('button',{name:'取消編輯',exact:true}).click();await expect(p.getByLabel('收款帳號',{exact:true})).toHaveCount(0);await p.getByRole('button',{name:'編輯',exact:true}).click();await expect(p.getByLabel('收款帳號',{exact:true})).toHaveValue('');expect(await page.evaluate(()=>JSON.stringify({...localStorage}))).not.toContain('12345678901234');
});
test('stale withdrawal quote asks user to reconfirm and surfaces backend error',async({page})=>{
 await setup(page);await page.route('**/rest/v1/rpc/get_my_reward_withdrawals',r=>r.fulfill({json:summary}));await page.route('**/rest/v1/rpc/quote_my_reward_withdrawal',r=>r.fulfill({json:quote}));await page.route('**/rest/v1/rpc/request_my_reward_withdrawal',r=>r.fulfill({status:400,json:{code:'40001',message:'餘額、銀行資料或批次已變更，請重新確認'}}));
 const p=await panel(page);await p.getByRole('button',{name:'申請提領'}).click();await page.getByRole('dialog',{name:'確認提領'}).getByRole('button',{name:'確認申請提領'}).click();await expect(p.getByRole('alert')).toHaveText(/請重新確認/);
});
const w={id:'66666666-6666-4666-8666-666666666666',user_id:uid,name:'提領老師',amount:1000,fee:15,net_amount:985,bank,status:'pending',version:1,created_at:'2026-10-12',scheduled_date:'2026-11-10',events:[]};
async function admin(page:Page,permissions:string[]){await setup(page,permissions);await page.route('**/rest/v1/rpc/get_admin_reward_withdrawal_queue',r=>r.fulfill({json:{total:1,withdrawals:[w]}}));await page.goto('/admin');if((page.viewportSize()?.width||0)<=900)await page.getByRole('button',{name:'開啟選單'}).click();await page.locator('.app-sidebar button:not(.sidebar-star)').filter({hasText:'師資返饋管理'}).click();await page.getByRole('tab',{name:'提領匯款',exact:true}).click();}
test('read-only administrator sees masked bank but no transfer controls',async({page})=>{await admin(page,['orders.read','rewards.withdrawals.read']);await expect(page.getByRole('heading',{name:'師資提領管理'})).toBeVisible();await expect(page.getByRole('button',{name:'領取處理'})).toHaveCount(0);await expect(page.getByRole('button',{name:'查看匯款銀行快照'})).toHaveCount(0);});
test('authorized administrator claims once; processing ownership is required',async({page})=>{
 await admin(page,['orders.read','rewards.withdrawals.read','rewards.withdrawals.manage']);let args:any;await page.route('**/rest/v1/rpc/manage_reward_withdrawal',r=>{args=r.request().postDataJSON();return r.fulfill({json:{id:w.id,status:'processing',version:2}});});
 await page.getByRole('button',{name:'領取處理'}).click();await expect.poll(()=>args?.p_action).toBe('claim');expect(args.p_expected_version).toBe(1);
});
test('shared refresh retains withdrawal pagination',async({page})=>{
 await admin(page,['orders.read','rewards.withdrawals.read']);const offsets:number[]=[];
 await page.route('**/rest/v1/rpc/get_admin_reward_withdrawal_queue',r=>{offsets.push(r.request().postDataJSON().p_offset);return r.fulfill({json:{total:41,withdrawals:[w]}});});
 await page.getByRole('button',{name:'重新整理',exact:true}).click();await expect.poll(()=>offsets.length).toBe(1);
 await page.getByRole('button',{name:'管理提領下一頁'}).click();await expect.poll(()=>offsets.at(-1)).toBe(20);
 const count=offsets.length;await page.getByRole('button',{name:'重新整理',exact:true}).click();await expect.poll(()=>offsets.length).toBe(count+1);expect(offsets.at(-1)).toBe(20);
});
test('withdrawal management uses nominal monthly batch without annual bank calendar controls',async({page})=>{await admin(page,['orders.read','rewards.withdrawals.read','rewards.withdrawals.manage']);await expect(page.getByText(/每月 10 日為匯款批次/)).toBeVisible();await expect(page.getByRole('heading',{name:'年度銀行休假資料'})).toHaveCount(0);});
test('withdrawal access requires dedicated read capability and administrator role',()=>{expect(canAccessBackofficePage({role:'admin',permissions:['orders.read','members.read']},'withdrawals')).toBe(false);expect(canAccessBackofficePage({role:'catalog_editor',permissions:['rewards.withdrawals.read']},'withdrawals')).toBe(false);});
test('manual paid record supplies actual date reference amount; unresolved write retries same event key',async({page})=>{
 await admin(page,['orders.read','rewards.withdrawals.read','rewards.withdrawals.manage']);
 await page.route('**/rest/v1/rpc/get_admin_reward_withdrawal_queue',r=>r.fulfill({json:{total:1,withdrawals:[{...w,status:'processing',version:2,processor_id:uid}]}}));await page.getByRole('button',{name:'重新整理',exact:true}).click();
 const args:any[]=[];await page.route('**/rest/v1/rpc/manage_reward_withdrawal',r=>{args.push(r.request().postDataJSON());return args.length===1?r.fulfill({status:503,json:{code:'503',message:'隔離網路結果不明'}}):r.fulfill({json:{id:w.id,status:'paid',version:3}});});
 await page.getByRole('button',{name:'記錄已匯款'}).click();const dialog=page.getByRole('dialog',{name:'記錄匯款結果'});await dialog.getByLabel('實際匯款日期').fill('2026-10-12');await dialog.getByLabel('銀行交易序號').fill('BANK-ISOLATED-001');await dialog.getByRole('button',{name:'確認記錄已匯款'}).click();await expect(page.getByRole('button',{name:'重送原處理結果'})).toBeVisible();
 await page.getByRole('button',{name:'重新整理',exact:true}).click();await expect(page.getByRole('button',{name:'重送原處理結果'})).toBeVisible();
 await page.getByRole('button',{name:'重送原處理結果'}).click();await expect.poll(()=>args.length).toBe(2);expect(args[0]).toEqual(args[1]);expect(args[0].p_details).toEqual({transfer_date:'2026-10-12',reference:'BANK-ISOLATED-001',amount:985});
});
test('manager bank snapshot is temporary and clears on page focus',async({page})=>{
 await admin(page,['orders.read','rewards.withdrawals.read','rewards.withdrawals.manage']);await page.route('**/api/reward-bank',r=>r.fulfill({json:{bank:{...bank,holder:'測試老師',account:'12345678901234'}}}));
 await page.getByRole('button',{name:'查看匯款銀行快照'}).click();const snapshot=page.getByRole('region',{name:'匯款銀行快照',exact:true});
 for(const [label,value] of [['銀行代碼','807'],['銀行名稱','隔離銀行'],['分行名稱','測試分行'],['收款戶名','測試老師'],['收款帳號','12345678901234']]){await expect(snapshot.locator('dl > div').filter({has:page.locator('dt',{hasText:label})}).locator('dd')).toHaveText(value);}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await snapshot.getByRole('button',{name:'隱藏銀行資料'}).click();await expect(snapshot).toHaveCount(0);
 await page.getByRole('button',{name:'查看匯款銀行快照'}).click();await expect(snapshot).toBeVisible();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByText(/12345678901234/)).toHaveCount(0);expect(await page.evaluate(()=>JSON.stringify({...localStorage}))).not.toContain('12345678901234');
});

test('missing bank explains disabled withdrawal and edits do not affect existing applications',async({page})=>{
 await setup(page);await page.route('**/rest/v1/rpc/get_my_reward_withdrawals',r=>r.fulfill({json:{...summary,bank:null}}));
 const p=await panel(page);await expect(p.getByRole('button',{name:'申請提領'})).toBeDisabled();await expect(p.getByText('請先設定收款銀行，才能申請提領。')).toBeVisible();await expect(p.getByText(/修改後僅適用於新申請，不影響已送出的提領申請/)).toBeVisible();
});
test('teacher confirmation is cancellable and reviews authoritative quote without sending request',async({page})=>{
 await setup(page);let requests=0;await page.route('**/rest/v1/rpc/get_my_reward_withdrawals',r=>r.fulfill({json:summary}));await page.route('**/rest/v1/rpc/quote_my_reward_withdrawal',r=>r.fulfill({json:{...quote,amount:900,net_amount:885}}));await page.route('**/rest/v1/rpc/request_my_reward_withdrawal',r=>{requests++;return r.fulfill({json:{}});});
 const p=await panel(page);await p.getByRole('button',{name:'申請提領'}).click();const modal=page.getByRole('dialog',{name:'確認提領'});await expect(modal).toBeVisible();
 for(const text of ['NT$ 900','NT$ 15','NT$ 885','2026-11-10','807','******1234'])await expect(modal.getByText(text,{exact:true})).toBeVisible();
 expect(await modal.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);const box=await modal.boundingBox();expect(box).not.toBeNull();expect(Math.abs(box!.x+box!.width/2-page.viewportSize()!.width/2)).toBeLessThan(2);await expect(modal.getByRole('button',{name:'返回修改'})).toBeFocused();await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);expect(requests).toBe(0);await expect(p.getByRole('button',{name:'申請提領'})).toBeFocused();
 await p.getByRole('button',{name:'申請提領'}).click();await modal.getByRole('button',{name:'返回修改'}).click();expect(requests).toBe(0);
});
test('teacher statuses are plain language and uncertain submissions retry the same request',async({page})=>{
 await setup(page);const attempts:any[]=[];await page.route('**/rest/v1/rpc/get_my_reward_withdrawals',r=>r.fulfill({json:{...summary,total:2,withdrawals:[{...w,id:'failed-demo',status:'failed'},{...w,id:'unknown-demo',status:'unknown'}]}}));await page.route('**/rest/v1/rpc/quote_my_reward_withdrawal',r=>r.fulfill({json:quote}));await page.route('**/rest/v1/rpc/request_my_reward_withdrawal',r=>{attempts.push(r.request().postDataJSON());return attempts.length===1?r.fulfill({status:503,json:{code:'503',message:'暫時無法確認結果'}}):r.fulfill({json:{id:'ok'}});});
 const p=await panel(page);await expect(p.getByText('匯款失敗（已全額退回）',{exact:true})).toBeVisible();await expect(p.getByText('匯款結果確認中',{exact:true})).toBeVisible();await expect(p.getByText('購物付款處理中',{exact:true})).toBeVisible();await expect(p.getByText('提領處理中',{exact:true})).toBeVisible();
 await p.getByRole('button',{name:'申請提領'}).click();await page.getByRole('dialog',{name:'確認提領'}).getByRole('button',{name:'確認申請提領'}).click();await expect(p.getByRole('button',{name:'重查提領申請結果'})).toBeVisible();await p.getByRole('button',{name:'重查提領申請結果'}).click();await expect.poll(()=>attempts.length).toBe(2);expect(attempts[1]).toEqual(attempts[0]);
});

test('admin filters reach backend, batch summary spans all pages and export is explicit',async({page})=>{
 await admin(page,['orders.read','rewards.withdrawals.read','rewards.withdrawals.manage']);const queries:any[]=[];
 await page.route('**/rest/v1/rpc/get_admin_reward_withdrawal_queue',r=>{const args=r.request().postDataJSON();queries.push(args);return r.fulfill({json:{total:args.p_search?1:25,withdrawals:[w],batches:['2026-11-10','2026-12-10'],batch_summary:args.p_batch_date?{batch_date:args.p_batch_date,count:25,amount:25000,fee:375,net_amount:24625}:null}});});await page.getByRole('button',{name:'重新整理',exact:true}).click();
 await expect(page.getByRole('button',{name:'匯出本批次匯款 CSV'})).toBeDisabled();await page.getByLabel('匯款批次',{exact:true}).selectOption('2026-11-10');const summary=page.getByRole('region',{name:'匯款批次合計'});await expect(summary.getByText('25 筆',{exact:true})).toBeVisible();await expect(summary.getByText('NT$ 24,625',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'管理提領下一頁'}).click();await expect.poll(()=>queries.at(-1)?.p_offset).toBe(20);await page.getByLabel('申請狀態',{exact:true}).selectOption('pending');await expect.poll(()=>queries.at(-1)?.p_offset).toBe(0);await page.getByLabel('老師姓名／申請編號').fill('提領老師');await page.getByRole('button',{name:'搜尋',exact:true}).click();await expect.poll(()=>queries.at(-1)?.p_search).toBe('提領老師');await expect(summary.getByText('25 筆',{exact:true})).toBeVisible();
 let body:any;await page.route('**/api/reward-bank',r=>{body=r.request().postDataJSON();return r.fulfill({contentType:'text/csv; charset=utf-8',body:'申請編號,完整帳號\r\nTEST,0001234'});});const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'匯出本批次匯款 CSV'}).click();expect((await downloaded).suggestedFilename()).toBe('reward-withdrawals-2026-11-10.csv');expect(body).toEqual({action:'export',batchDate:'2026-11-10'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('read only has no export and paid form preserves draft and validates amount',async({page})=>{
 await admin(page,['orders.read','rewards.withdrawals.read']);await expect(page.getByRole('button',{name:'匯出本批次匯款 CSV'})).toHaveCount(0);
 await admin(page,['orders.read','rewards.withdrawals.read','rewards.withdrawals.manage']);await page.route('**/rest/v1/rpc/get_admin_reward_withdrawal_queue',r=>r.fulfill({json:{total:1,withdrawals:[{...w,status:'processing',processor_id:uid,version:2}]}}));await page.getByRole('button',{name:'重新整理',exact:true}).click();let calls=0;await page.route('**/rest/v1/rpc/manage_reward_withdrawal',r=>{calls++;return r.fulfill({json:{}});});
 await page.getByRole('button',{name:'記錄已匯款',exact:true}).click();let d=page.getByRole('dialog',{name:'記錄匯款結果'});await d.getByLabel('實際匯款日期').fill('2026-10-12');await d.getByLabel('銀行交易序號').fill('DRAFT-123');await d.getByLabel('實際匯款金額').fill('100');await d.getByRole('button',{name:'確認記錄已匯款'}).click();await expect(d.getByRole('alert')).toBeVisible();expect(calls).toBe(0);await page.keyboard.press('Escape');await expect(d).toHaveCount(0);
 await page.getByRole('button',{name:'記錄已匯款',exact:true}).click();d=page.getByRole('dialog',{name:'記錄匯款結果'});await expect(d.getByLabel('銀行交易序號')).toHaveValue('DRAFT-123');await expect(d.getByLabel('實際匯款金額')).toHaveValue('100');await expect(d.getByLabel('實際匯款日期')).toHaveValue('2026-10-12');await d.getByLabel('實際匯款金額').fill('985');await d.getByRole('button',{name:'確認記錄已匯款'}).click();await expect.poll(()=>calls).toBe(1);
});

for(const [amount,tax,premium,net] of [[19999,0,0,19984],[20000,0,422,19563],[20001,2000,422,17564],[30000,3000,633,26352]])test(`withdrawal tax preview and frozen confirmation at ${amount}`,async({page})=>{
 await setup(page);const calculation={...quote,amount,income_tax:tax,supplementary_premium:premium,net_amount:net};let submitted:any;
 await page.route('**/rest/v1/rpc/get_my_reward_withdrawals',r=>r.fulfill({json:{...summary,balance:amount,available_balance:amount,withdrawal_estimate:calculation,total:1,withdrawals:[{...w,...calculation}]}}));
 await page.route('**/rest/v1/rpc/quote_my_reward_withdrawal',r=>r.fulfill({json:calculation}));
 await page.route('**/rest/v1/rpc/request_my_reward_withdrawal',r=>{submitted=r.request().postDataJSON();return r.fulfill({json:{id:'taxed'}});});
 const p=await panel(page);await expect(p.getByText(/提領總額超過 NT\$20,000/)).toBeVisible();
 await expect(p.locator('.reward-withdrawal-summary').getByText(`NT$ ${net.toLocaleString('zh-TW')}`,{exact:true})).toBeVisible();
 await p.getByRole('button',{name:'申請提領'}).click();const dialog=page.getByRole('dialog',{name:'確認提領'});
 await expect(dialog.getByText('預扣所得稅（10%）',{exact:true})).toBeVisible();await expect(dialog.getByText('二代健保補充保費（2.11%）',{exact:true})).toBeVisible();
 await expect(dialog.getByText(`NT$ ${net.toLocaleString('zh-TW')}`,{exact:true})).toBeVisible();await dialog.getByRole('button',{name:'確認申請提領'}).click();await expect.poll(()=>submitted?.p_expected_quote).toEqual(calculation);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('legacy server cannot silently submit a fee-only withdrawal',async({page})=>{
 await setup(page);await page.route('**/rest/v1/rpc/get_my_reward_withdrawals',r=>r.fulfill({json:summary}));
 await page.route('**/rest/v1/rpc/quote_my_reward_withdrawal',r=>r.fulfill({json:{amount:30000,fee:15,net_amount:29985}}));let count=0;
 await page.route('**/rest/v1/rpc/request_my_reward_withdrawal',r=>{count++;return r.fulfill({json:{}});});
 const p=await panel(page);await p.getByRole('button',{name:'申請提領'}).click();await expect(p.getByRole('alert')).toHaveText('提領金額與批次規則更新尚未安裝，請聯繫管理員。');expect(count).toBe(0);
});

test('taxed admin totals and paid dialog enforce the frozen net transfer',async({page})=>{
 await admin(page,['orders.read','rewards.withdrawals.read','rewards.withdrawals.manage']);
 const taxed={...w,...deductions,amount:30000,income_tax:3000,supplementary_premium:633,net_amount:26352,status:'processing',version:2,processor_id:uid};
 await page.route('**/rest/v1/rpc/get_admin_reward_withdrawal_queue',r=>r.fulfill({json:{total:1,withdrawals:[taxed],batches:['2026-11-10'],batch_summary:{batch_date:'2026-11-10',count:1,amount:30000,fee:15,income_tax:3000,supplementary_premium:633,net_amount:26352}}}));
 await page.getByRole('button',{name:'重新整理',exact:true}).click();const summary=page.getByRole('region',{name:'匯款批次合計'});
 await expect(summary.getByText('預扣所得稅合計',{exact:true})).toBeVisible();await expect(summary.getByText('NT$ 3,000',{exact:true})).toBeVisible();await expect(summary.getByText('NT$ 26,352',{exact:true})).toBeVisible();
 let sent:any;await page.route('**/rest/v1/rpc/manage_reward_withdrawal',r=>{sent=r.request().postDataJSON();return r.fulfill({json:{}});});
 await page.getByRole('button',{name:'記錄已匯款',exact:true}).click();const dialog=page.getByRole('dialog',{name:'記錄匯款結果'});
 await dialog.getByLabel('實際匯款日期').fill('2026-10-12');await dialog.getByLabel('銀行交易序號').fill('MOCK-NO-BANK');await dialog.getByLabel('實際匯款金額').fill('29985');
 await dialog.getByRole('button',{name:'確認記錄已匯款'}).click();await expect(dialog.getByRole('alert')).toBeVisible();expect(sent).toBeUndefined();
 await dialog.getByLabel('實際匯款金額').fill('26352');await dialog.getByRole('button',{name:'確認記錄已匯款'}).click();await expect.poll(()=>sent?.p_details?.amount).toBe(26352);
});

test('custom amount previews on backend, full amount fills and partial submission locks current batch',async({page})=>{
 await setup(page);let blocked=false,sent:any;const amount=30000;
 await page.route('**/rest/v1/rpc/get_my_instructor_reward_report',r=>r.fulfill({json:{summary:{balance:blocked?20000:amount,available_balance:blocked?20000:amount,pending_balance:0,credited_total:amount,reversed_total:0,withdrawal_reserved_balance:blocked?10000:0},order_count:0,ledger_count:0,orders:[],entries:[]}}));
 await page.route('**/rest/v1/rpc/get_my_reward_withdrawals',r=>r.fulfill({json:{...summary,balance:blocked?20000:amount,available_balance:blocked?20000:amount,withdrawal_estimate:{...quote,amount,net_amount:26352,income_tax:3000,supplementary_premium:633},withdrawal_batch:{...summary.withdrawal_batch,blocked}}}));
 const previews:number[]=[];await page.route('**/rest/v1/rpc/quote_my_reward_withdrawal',r=>{const a=r.request().postDataJSON().p_amount;previews.push(a);return r.fulfill({json:{...quote,amount:a,net_amount:a-15}});});
 await page.route('**/rest/v1/rpc/request_my_reward_withdrawal',r=>{sent=r.request().postDataJSON();blocked=true;return r.fulfill({json:{id:'partial'}});});
 const p=await panel(page),input=p.getByLabel('提領金額',{exact:true}),button=p.getByRole('button',{name:'申請提領',exact:true});
 for(const invalid of ['', '0','15','-1','100.5','30001','1e3']){await input.fill(invalid);await expect(button).toBeDisabled();}
 expect(previews).toHaveLength(0);await input.fill('10000');await expect(p.locator('.reward-withdrawal-summary').getByText('NT$ 9,985',{exact:true})).toBeVisible();expect(previews.at(-1)).toBe(10000);
 await p.getByRole('button',{name:'全額帶入'}).click();await expect(input).toHaveValue('30000');await expect(p.locator('.reward-withdrawal-summary').getByText('NT$ 26,352',{exact:true})).toBeVisible();
 await input.fill('10000');await expect(button).toBeEnabled();await button.click();const d=page.getByRole('dialog',{name:'確認提領',exact:true});await expect(d.getByText('NT$ 10,000',{exact:true})).toBeVisible();await d.getByRole('button',{name:'確認申請提領'}).click();
 await expect.poll(()=>sent?.p_expected_quote.amount).toBe(10000);await expect(p.getByText(/本批次（2026-11-10）已有提領申請/)).toBeVisible();await expect(button).toBeDisabled();await expect(input).toBeDisabled();await expect(page.locator('.reward-balance-primary .reward-metric--available strong')).toHaveText('NT$ 20,000');await expect(page.getByText('另有 NT$ 10,000 提領處理中。',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('batch restriction comes from server across pagination; failed batch can be reapplied',async({page})=>{
 await setup(page);let blocked=true;
 await page.route('**/rest/v1/rpc/get_my_reward_withdrawals',r=>r.fulfill({json:{...summary,total:40,withdrawals:[],withdrawal_batch:{...summary.withdrawal_batch,blocked}}}));
 const p=await panel(page),button=p.getByRole('button',{name:'申請提領',exact:true});await expect(button).toBeDisabled();await p.getByRole('button',{name:'提領下一頁'}).click();await expect(button).toBeDisabled();
 blocked=false;await p.getByRole('button',{name:'重新整理提領'}).click();await expect(button).toBeEnabled();
});

test('late custom preview cannot replace newer amount and missing migration blocks submission',async({page})=>{
 await setup(page);let old=false;
 await page.route('**/rest/v1/rpc/get_my_reward_withdrawals',r=>r.fulfill({json:{...summary,...(old?{selection_policy:undefined}:{}),available_balance:30000}}));
 await page.route('**/rest/v1/rpc/quote_my_reward_withdrawal',async r=>{const a=r.request().postDataJSON().p_amount;if(a===10000)await new Promise(resolve=>setTimeout(resolve,800));await r.fulfill({json:{...quote,amount:a,net_amount:a-15}});});
 const p=await panel(page),input=p.getByLabel('提領金額',{exact:true});const oldResponse=page.waitForResponse(r=>r.url().includes('quote_my_reward_withdrawal')&&r.request().postDataJSON().p_amount===10000);await input.fill('10000');await page.waitForRequest(r=>r.url().includes('quote_my_reward_withdrawal'));await input.fill('12000');await expect(p.locator('.reward-withdrawal-summary').getByText('NT$ 11,985',{exact:true})).toBeVisible();
 await oldResponse;await expect(p.locator('.reward-withdrawal-summary').getByText('NT$ 11,985',{exact:true})).toBeVisible();await expect(p.locator('.reward-withdrawal-summary').getByText('NT$ 9,985',{exact:true})).toHaveCount(0);
 old=true;await p.getByRole('button',{name:'重新整理提領'}).click();await expect(p.getByText('提領金額與批次規則更新尚未安裝，請聯繫管理員。')).toBeVisible();await expect(p.getByRole('button',{name:'申請提領',exact:true})).toBeDisabled();
});
