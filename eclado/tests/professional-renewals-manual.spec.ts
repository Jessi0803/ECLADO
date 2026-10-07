import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { buildRenewalRosterPreview, getTaipeiYear } from '../src/domain/professionalRenewals.js';
import { mockEcladoApis } from './support/eclado-mocks';

const sql = fs.readFileSync('supabase-professional-renewals-manual-processing.sql', 'utf8');
const base = fs.readFileSync('supabase-professional-renewals.sql', 'utf8');

test('手動 migration 與完整 schema 一致，舊批次入口失效且保留交易防護', () => {
  const block = sql.slice(sql.indexOf('create table'), sql.lastIndexOf("notify pgrst")).replace(/commit;\s*$/, '').trim();
  expect(base).toContain(block);
  const bulk = sql.slice(sql.indexOf('create or replace function public.finalize_professional_renewal_year'), sql.indexOf('create or replace function public.finalize_professional_renewal_application'));
  expect(bulk).toContain('Bulk annual settlement is disabled');
  expect(bulk).not.toMatch(/update public|insert into|delete from/);
  expect(bulk).toContain('from public, anon, authenticated, service_role');
  const finalize = sql.slice(sql.indexOf('create or replace function public.finalize_professional_renewal_application'), sql.indexOf('create or replace function public.downgrade_professional_renewal_nonapplicant'));
  expect(finalize).toContain("has_backoffice_permission('members.write')");
  expect(finalize).toContain('for update');
  expect(finalize).toContain("if target.status <> 'submitted'");
  expect(finalize).toContain('extract(year from today)::integer - 1');
  expect(finalize).toContain('where id = target.id');
  expect(finalize).not.toMatch(/update public.profiles|delete from/);
  expect(sql).toContain('unique (user_id, renewal_year)');
  expect(sql).toContain('enable row level security');
  expect(sql).toContain('Member has a renewal application; use application review instead');
  expect(sql).toContain('membership.role = target_profile.role');
  expect(sql).toContain('set ended_on = today');
  expect(sql).toContain('Member qualification has changed; refresh and verify membership history');
  const cron = fs.readFileSync('api/professional-quarterly-notices.js', 'utf8');
  expect(cron).not.toContain('finalize_professional_renewal_year');
  expect(cron).toContain('prepare_professional_quarterly_notices');
});

test('唯讀預覽：台灣跨年、資格邊界、歷史申請與人數分開計算', () => {
  expect(getTaipeiYear(new Date('2026-12-31T16:00:00Z'))).toBe(2027);
  const profiles = [{id:'a',role:'instructor'}, {id:'b',role:'pro'}, {id:'c',role:'distributor'}, {id:'d',role:'instructor'}];
  const memberships = [
    {user_id:'a',role:'instructor',started_on:'2026-05-01',ended_on:null},
    {user_id:'b',role:'distributor',started_on:'2026-01-01',ended_on:'2027-01-03'},
    {user_id:'c',role:'distributor',started_on:'2027-01-02',ended_on:null},
    {user_id:'d',role:'instructor',started_on:'2026-01-01',ended_on:'2026-09-01'},
  ];
  const preview = buildRenewalRosterPreview(profiles,memberships,[{id:'app',user_id:'d',role:'instructor',renewal_year:2027,status:'approved'}],2027,new Date('2027-01-05T00:00:00Z'));
  expect(preview.eligible_count).toBe(3);
  expect(preview.current_instructors + preview.current_distributors).toBe(3);
  expect(preview.submitted_count).toBe(1);
  expect(preview.not_submitted_count).toBe(2);
  expect(preview.rows.find(row=>row.user_id==='a')?.status).toBe('overdue');
  expect(preview.rows.find(row=>row.user_id==='b')?.status).toBe('qualification_changed');
  expect(preview.rows.every(row=>!row.can_finalize && !row.can_downgrade)).toBe(true);
});

function fixtures() {
  const common = {renewal_year:2027,assessment_year:2026,role:'instructor',member_role:'instructor',evidence:[],recent_notices:[],assessment:{annual_sales_amount:120000,annual_threshold:120000,a_qualified:true,quarters:[]}};
  return [
    {...common,id:'app-a',application_id:'app-a',user_id:'a',member_name:'測試師資甲',status:'submitted',can_finalize:true},
    {...common,id:'2027:b',application_id:null,user_id:'b',member_name:'測試經銷乙',role:'distributor',member_role:'distributor',status:'overdue',can_downgrade:true},
    {...common,id:'app-c',application_id:'app-c',user_id:'c',member_name:'已通過丙',status:'approved'},
  ];
}

async function setup(page:Page, options:{readOnly?:boolean; missing?:boolean; fail?:boolean; alreadyProcessed?:boolean}={}) {
  await page.clock.setFixedTime(new Date('2027-01-05T02:00:00Z'));
  // Catch unmatched external data calls: tests cannot write to the real database.
  await page.route('**/*.supabase.co/**', route=>route.abort());
  await mockEcladoApis(page, {authUser:{id:'admin-user-1',email:'baby90522@gmail.com',user_metadata:{name:'管理員'},app_metadata:{provider:'email'},aud:'authenticated',role:'authenticated',created_at:'2026-01-01T00:00:00Z'},
    ...(options.readOnly ? {backofficeAccess:{role:'staff',permissions:['members.read']}} : {})});
  let rows = fixtures();
  const calls:{name:string;body:any}[]=[];
  await page.route('**/rest/v1/rpc/*professional*', async route=>{
    const name = new URL(route.request().url()).pathname.split('/').pop()!;
    const body = route.request().postDataJSON();
    const json = (value:any,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
    if (name === 'get_admin_professional_quarterly_notices') return json([]);
    if (name === 'get_admin_professional_sales') return route.fallback();
    if (name === 'get_admin_professional_renewals') return json([fixtures()[0]]);
    if (name === 'get_admin_professional_renewal_roster') {
      if(options.missing) return json({code:'PGRST202',message:'missing function'},404);
      const year=body.p_renewal_year;
      const selected = year===2027 ? rows : rows.map(row=>({...row,renewal_year:year,can_finalize:false,can_downgrade:false}));
      return json({rows:selected,current_instructors:2,current_distributors:rows[1].member_role==='pro'?0:1,eligible_count:3,submitted_count:2,not_submitted_count:1,unprocessed_count:selected.filter(row=>['submitted','pending_review','overdue'].includes(row.status)).length});
    }
    calls.push({name,body});
    if(options.fail) return json({code:'22023',message:'Member qualification has changed'},400);
    if(name==='finalize_professional_renewal_application') rows=rows.map(row=>row.application_id===body.p_application_id?{...row,status:'pending_review',can_finalize:false}:row);
    if(name==='downgrade_professional_renewal_nonapplicant') rows=rows.map(row=>row.user_id===body.p_member_id?{...row,status:'not_applied_downgraded',member_role:'pro',can_downgrade:false,decision_reason:body.p_reason}:row);
    return json({changed:!options.alreadyProcessed});
  });
  if(options.missing) {
    await page.route('**/rest/v1/profiles?*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify([{id:'a',name:'測試師資甲',role:'instructor'},{id:'b',name:'測試經銷乙',role:'distributor'}])}));
    await page.route('**/rest/v1/professional_memberships?*',route=>route.fulfill({contentType:'application/json',body:JSON.stringify([{id:'m',user_id:'b',role:'distributor',started_on:'2026-01-01',ended_on:null}])}));
  }
  await page.goto('/admin');
  if((page.viewportSize()?.width||0)<=900) await page.getByRole('button',{name:'開啟選單'}).click();
  await page.locator('.app-sidebar button:not(.sidebar-star)').filter({hasText:/^專業資格續約$/}).first().click();
  await page.getByLabel('續約年度',{exact:true}).selectOption('2027');
  await expect(page.locator('article').filter({hasText:'測試師資甲'})).toBeVisible();
  return calls;
}

test('年度名單、單人結算與篩選不影響其他會員',async({page})=>{
  const calls=await setup(page);
  await expect(page.getByRole('button',{name:'執行年度結算'})).toHaveCount(0);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'結算此會員'}).click();
  await expect(page.getByRole('button',{name:'核准續約'})).toBeVisible();
  expect(calls).toEqual([{name:'finalize_professional_renewal_application',body:{p_application_id:'app-a'}}]);
  await expect(page.locator('article').filter({hasText:'測試經銷乙'})).toContainText('逾期未提交');
  await page.getByRole('button',{name:'未提交待處理',exact:true}).click();
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.locator('article')).toContainText('測試經銷乙');
});

test('未申請降級需原因與確認，處理後仍留在年度名單',async({page})=>{
  const calls=await setup(page);
  page.on('dialog',dialog=>dialog.accept(dialog.type()==='prompt'?'逾期未申請':undefined));
  await page.getByRole('button',{name:'未申請降回美容師'}).click();
  await expect(page.locator('article').filter({hasText:'測試經銷乙'})).toContainText('未申請，已降回美容師');
  expect(calls).toEqual([{name:'downgrade_professional_renewal_nonapplicant',body:{p_member_id:'b',p_renewal_year:2027,p_reason:'逾期未申請'}}]);
  await expect(page.locator('article')).toHaveCount(3);
  await expect(page.getByText('當前師資＋經銷商').locator('..')).toContainText('2 位');
  await expect(page.getByText('2027 年度續約名單').locator('..')).toContainText('3 位');
  await expect(page.getByRole('button',{name:'未申請降回美容師'})).toHaveCount(0);
  await page.getByRole('button',{name:'已處理／資格已變更'}).click();
  await expect(page.locator('article')).toHaveCount(2);
});

test('取消確認不寫入；未結束年度禁止結算及降級',async({page})=>{
  const calls=await setup(page);
  page.once('dialog',dialog=>dialog.dismiss());
  await page.getByRole('button',{name:'結算此會員'}).click();
  expect(calls).toHaveLength(0);
  await page.getByLabel('續約年度',{exact:true}).selectOption('2028');
  await expect(page.getByRole('button',{name:'結算此會員'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'未申請降回美容師'})).toBeDisabled();
});

test('資格變更拒絕後可重試、不顯示成功',async({page})=>{
  await setup(page,{fail:true});
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'結算此會員'}).click();
  await expect(page.getByRole('status')).toContainText('結算失敗');
  await expect(page.getByRole('button',{name:'結算此會員'})).toBeEnabled();
});

test('SQL 未部署只有唯讀預覽，禁止任何新寫入',async({page})=>{
  const calls=await setup(page,{missing:true});
  await expect(page.getByRole('alert')).toContainText('目前為唯讀預覽');
  await expect(page.getByRole('button',{name:'結算此會員'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'未申請降回美容師'})).toBeDisabled();
  expect(calls).toHaveLength(0);
});

test('僅讀取權限不提供資格異動操作',async({page})=>{
  await setup(page,{readOnly:true});
  await expect(page.getByRole('button',{name:'結算此會員'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'未申請降回美容師'})).toHaveCount(0);
});

test('另一分頁已結算時不當成新成功，重新載入並移除結算按鈕',async({page})=>{
  await setup(page,{alreadyProcessed:true});
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'結算此會員'}).click();
  await expect(page.getByRole('status')).toContainText('此申請已處理');
  await expect(page.getByRole('button',{name:'結算此會員'})).toHaveCount(0);
});

test('快速切換年度，較慢的舊年度回應不能覆蓋新名單',async({page})=>{
  await setup(page);
  await page.route('**/rest/v1/rpc/get_admin_professional_renewal_roster',async route=>{
    const year=route.request().postDataJSON().p_renewal_year;
    if(year===2028) await new Promise(resolve=>setTimeout(resolve,400));
    await route.fulfill({contentType:'application/json',body:JSON.stringify({rows:[{...fixtures()[0],member_name:`年度${year}`,renewal_year:year,can_finalize:false}]})});
  });
  const oldResponse=page.waitForResponse(response=>response.url().includes('get_admin_professional_renewal_roster') && response.request().postDataJSON().p_renewal_year===2028);
  await page.getByLabel('續約年度',{exact:true}).selectOption('2028');
  await page.getByLabel('續約年度',{exact:true}).selectOption('2026');
  await expect(page.locator('article')).toContainText('年度2026');
  await oldResponse;
  await expect(page.locator('article')).toContainText('年度2026');
});

test('審核成功但通知斷線，仍更新狀態且不允許重複審核',async({page})=>{
  await setup(page);
  await page.route('**/api/professional-renewal-notice',route=>route.abort());
  await page.route('**/rest/v1/rpc/review_professional_renewal_application',async route=>{
    await page.route('**/rest/v1/rpc/get_admin_professional_renewal_roster',next=>next.fulfill({contentType:'application/json',body:JSON.stringify({rows:[{...fixtures()[0],status:'approved'}]})}));
    await route.fulfill({contentType:'application/json',body:'{}'});
  });
  page.on('dialog',dialog=>dialog.accept(dialog.type()==='prompt'?'確認採購符合':undefined));
  await page.getByRole('button',{name:'結算此會員'}).click();
  await page.getByRole('button',{name:'核准續約'}).click();
  await expect(page.getByRole('status')).toContainText('審核完成，但通知失敗');
  await expect(page.getByRole('button',{name:'核准續約'})).toHaveCount(0);
  await expect(page.getByLabel('續約年度',{exact:true})).toBeEnabled();
});
