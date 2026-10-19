import { expect, test, type Page } from '@playwright/test';
import { mockEcladoApis, adminProductRows } from './support/eclado-mocks';

const user = { id:'admin-students', email:'ecladotaiwan@gmail.com', user_metadata:{ name:'管理員' }, app_metadata:{provider:'email'}, aud:'authenticated', role:'authenticated', created_at:'2026-05-01T00:00:00Z' };
const profiles = [
  { id:'teacher-a', name:'老師A', role:'instructor', email:'a@example.test', created_at:'2026-05-01T00:00:00Z' },
  { id:'teacher-b', name:'老師B', role:'instructor', email:'b@example.test', created_at:'2026-05-01T00:00:00Z' },
  { id:'student-a', name:'學生A', role:'pro', email:'s@example.test', created_at:'2026-05-01T00:00:00Z' },
];
async function setup(page: Page, manage = true) {
  await mockEcladoApis(page, { authUser:user, profiles, products:adminProductRows, backofficeAccess:{ role:'admin',
    permissions:['orders.read','catalog.read','members.read', ...(manage ? ['instructor_students.manage'] : [])] } });
}
async function open(page: Page, name: string) {
  if ((page.viewportSize()?.width || 0) <= 900) await page.getByRole('button', { name:'開啟選單' }).click();
  await page.locator('.app-sidebar button:not(.sidebar-star)').filter({ hasText:name }).first().click();
}
const empty = () => ({ context:{ has_binding:false, binding_id:null, instructor_id:null, student_price_type:null,
  student_role_eligible:true, instructor_role_eligible:false, instructor_type_set:false,
  student_pricing_eligible:false, prices_applied:false }, instructor_settings:null, students:[], history:[] });

test('學生折數独立設定、版本衝突可重讀，原會員折數不被呼叫', async ({ page }) => {
  await setup(page);
  let oldPricingCalls = 0, payload: any;
  await page.route('**/rest/v1/rpc/get_admin_member_pricing', async route => { oldPricingCalls++; await route.fulfill({ json:{} }); });
  await page.route('**/rest/v1/rpc/save_student_pricing_settings', async route => {
    payload = route.request().postDataJSON();
    await route.fulfill({ status:400, json:{ code:'40001', message:'設定已被其他管理員修改，請重新載入' } });
  });
  await page.goto('/admin'); await open(page,'系統設定');
  await expect(page.getByLabel('學生1預設折數')).toHaveValue('9');
  await expect(page.getByLabel('學生2預設折數')).toHaveValue('9.5');
  await page.getByLabel('學生1預設折數').fill('8.8');
  await page.getByRole('button',{ name:'儲存學生折數', exact:true }).click();
  await expect(page.getByRole('alert')).toContainText('重新載入');
  expect(payload).toEqual({ p_multipliers:{ student_1:0.88, student_2:0.95 }, p_expected_version:0 });
  expect(oldPricingCalls).toBe(0);
  await page.getByRole('button',{ name:'重新載入學生設定' }).click();
  await expect(page.getByLabel('學生1預設折數')).toHaveValue('9');
  await page.route('**/rest/v1/rpc/save_student_pricing_settings', async route => {
    const args=route.request().postDataJSON(); await route.fulfill({ json:{ multipliers:args.p_multipliers,version:1,prices_applied:false } });
  });
  await page.getByLabel('學生1預設折數').fill('8.8');
  await page.getByRole('button',{ name:'儲存學生折數', exact:true }).click();
  await expect(page.getByRole('status')).toContainText('商品售價不變');
});

test('會員詳情可設定老師類型並確認清空，保留學生', async ({ page }) => {
  await setup(page);
  let data: any = { ...empty(), instructor_settings:{ student_price_type:null,version:0 }, students:[] };
  await page.route('**/rest/v1/rpc/get_admin_instructor_student_member', route => route.fulfill({ json:data }));
  const writes: any[]=[];
  await page.route('**/rest/v1/rpc/set_instructor_student_price_type', async route => {
    const args=route.request().postDataJSON(); writes.push(args);
    data={ ...data, instructor_settings:{ student_price_type:args.p_student_price_type,version:writes.length },
      students:[{ binding_id:'binding-student-a',student_id:'student-a',student_name:'學生A',context:{ student_pricing_eligible:!!args.p_student_price_type } }] };
    await route.fulfill({ json:data });
  });
  await page.goto('/admin'); await open(page,'會員管理');
  await page.locator('tr').filter({ hasText:'老師A' }).click();
  const panel=page.getByRole('dialog',{ name:'會員詳情' });
  const typeBox=await panel.getByLabel('老師學生價格類型').boundingBox();
  const saveBox=await panel.getByRole('button',{name:'儲存老師類型'}).boundingBox();
  expect(typeBox).not.toBeNull();expect(saveBox).not.toBeNull();expect(saveBox!.height).toBeCloseTo(typeBox!.height,0);
  await panel.getByLabel('老師學生價格類型').selectOption('student_1');
  await panel.getByRole('button',{ name:'儲存老師類型' }).click();
  await expect(panel.getByRole('status')).toContainText('學生下次報價時會重新確認適用價格');
  await expect(panel.getByText('學生A · 資格符合', { exact:true })).toBeVisible();
  expect(writes[0]).toEqual({ p_instructor_id:'teacher-a',p_student_price_type:'student_1',p_expected_version:0 });
  await panel.getByLabel('老師學生價格類型').selectOption('');
  page.once('dialog',dialog=>dialog.dismiss());
  await panel.getByRole('button',{ name:'儲存老師類型' }).click();
  expect(writes).toHaveLength(1);
  page.once('dialog',async dialog=>{ expect(dialog.message()).toContain('保留綁定');await dialog.accept(); });
  await panel.getByRole('button',{ name:'儲存老師類型' }).click();
  await expect(panel.getByText('目前名下學生：1 位')).toBeVisible();
  await expect(panel.getByText('學生A · 資格暫停')).toBeVisible();
});

test('學生建立、換綁、解除只送RPC，確認取消不寫入', async ({ page }) => {
  await setup(page);
  let data: any=empty(); const writes: any[]=[];
  await page.route('**/rest/v1/rpc/get_admin_instructor_student_member', route=>route.fulfill({ json:data }));
  await page.route('**/rest/v1/rpc/save_instructor_student_binding', async route=>{
    const args=route.request().postDataJSON();writes.push(args);
    data={ ...data,context:{ ...data.context,has_binding:args.p_action!=='unbind',
      binding_id:args.p_action==='unbind'?null:`binding-${writes.length}`,instructor_id:args.p_instructor_id,
      instructor_name:args.p_instructor_id==='teacher-a'?'老師A':'老師B',student_price_type:'student_1',
      instructor_role_eligible:true,instructor_type_set:true,student_pricing_eligible:args.p_action!=='unbind' } };
    await route.fulfill({ json:data });
  });
  await page.goto('/admin'); await open(page,'會員管理');
  await page.locator('tr').filter({ hasText:'學生A' }).click();
  const section=page.getByRole('region',{ name:'師生綁定設定' });
  await section.getByLabel('搜尋綁定老師').fill('老師A');
  await section.getByLabel('選擇綁定老師').selectOption('teacher-a');
  await section.getByRole('button',{ name:'建立師生綁定' }).click();
  await expect(section.getByRole('status')).toContainText('建立綁定已完成');
  await expect(section).not.toContainText('價格未啟用');
  expect(writes[0]).toEqual({p_student_id:'student-a',p_instructor_id:'teacher-a',p_expected_binding_id:null,p_action:'bind'});
  await section.getByLabel('搜尋綁定老師').fill('老師B');
  await section.getByLabel('選擇綁定老師').selectOption('teacher-b');
  page.once('dialog',dialog=>dialog.dismiss());
  await section.getByRole('button',{name:'更換老師',exact:true}).click();expect(writes).toHaveLength(1);
  page.once('dialog',dialog=>dialog.accept());
  await section.getByRole('button',{name:'更換老師',exact:true}).click();
  await expect(section.getByRole('status')).toContainText('更換老師已完成');
  expect(writes[1].p_expected_binding_id).toBe('binding-1');
  page.once('dialog',dialog=>dialog.accept());
  await section.getByRole('button',{name:'解除師生綁定'}).click();
  await expect(section.getByText('目前老師：未綁定')).toBeVisible();
  expect(writes[2].p_instructor_id).toBeNull();
});

test('只有會員讀權限時可讀關係但無管理操作或設定入口', async ({ page })=>{
  await setup(page,false); await page.goto('/admin');
  await expect(page.locator('.app-sidebar').getByText('系統設定',{exact:true})).toHaveCount(0);
  await open(page,'會員管理');await page.locator('tr').filter({hasText:'學生A'}).click();
  const section=page.getByRole('region',{name:'師生綁定設定'});
  await expect(section.getByText('目前老師：未綁定')).toBeVisible();
  await expect(section.getByLabel('選擇綁定老師')).toHaveCount(0);
  await expect(section.getByRole('button',{name:'建立師生綁定'})).toHaveCount(0);
});
