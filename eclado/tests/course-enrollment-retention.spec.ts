import { expect, test, type Page } from '@playwright/test';
import { mockEcladoApis } from './support/eclado-mocks';

const courseId = 'c0ea0000-0000-4000-8000-000000000001';
const orderId = 'c0ea0000-0000-4000-8000-000000000002';
const course = {
  id: courseId, name: '專業護膚課程', description: '護膚實作', price_twd: 1200,
  starts_at: '2035-11-11T02:00:00Z', ends_at: '2035-11-11T04:00:00Z',
};

async function mockMember(page: Page, role: string, fromCourse = false, viaDetail = false) {
  const user = {
    id: 'course-test-member', email: 'courses@example.test', user_metadata: { name: '會員甲' },
    app_metadata: { provider: 'email' }, aud: 'authenticated', role: 'authenticated',
    created_at: '2026-05-01T00:00:00.000Z',
  };
  await page.route('https://**/*', route => route.abort());
  await mockEcladoApis(page, {
    signInUser: user,
    profiles: [{ id: user.id, name: '會員甲', role }],
    adminAccess: role === 'staff',
    backofficeAccess: { role: 'admin', permissions: ['orders.read', 'courses.manage', 'notifications.send'] },
  });
  await page.route('**/rest/v1/rpc/get_published_courses', route => route.fulfill({ json: [course] }));
  if (viaDetail) await page.route('**/rest/v1/rpc/get_my_course_orders', route => route.fulfill({ json: { orders: [] } }));
  await page.goto(fromCourse ? `/courses/${courseId}${viaDetail ? '' : '/register'}` : role === 'staff' ? '/admin' : '/login');
  if (viaDetail) await page.getByRole('link', { name: '立即報名', exact: true }).click();
  if (fromCourse) {
    await expect(page).toHaveURL(`/login?next=${encodeURIComponent(`/courses/${courseId}/register`)}`);
    await expect(page.getByText('再回到本頁報名或查詢付款。')).toHaveCount(0);
  }
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill('local-test-password');
  await page.getByRole('button', { name: role === 'staff' ? '進入後台' : '登入', exact: true }).last().click();
  if (role !== 'staff') await expect(page).not.toHaveURL(/\/login/);
}


for(const stage of ['before','started','ended'])test(`美容師保留已報名與付款狀態 ${stage}`,async({page},info)=>{
 await mockMember(page,'pro',true);
 const current={...course,...(stage==='before'?{}:{starts_at:'2025-01-01T00:00:00Z',ends_at:stage==='ended'?'2025-01-01T02:00:00Z':course.ends_at})};
 await page.route('**/rest/v1/rpc/get_published_courses',route=>route.fulfill({json:[current]}));
 await page.route('**/rest/v1/rpc/get_my_course_orders',route=>route.fulfill({json:{ends_at:current.ends_at,orders:[{
  id:orderId,course_name:course.name,status:stage==='before'?'pending':'expired',total_twd:1200,
  payment_due_at:stage==='before'?course.starts_at:'2025-01-01T00:00:00Z',
  registrations:[{id:'p',name:'示範美容師',kind:'pro_self',status:'pending'}]}]}}));
 await page.reload();await expect(page.locator('.course-order')).toContainText('示範美容師 · 已報名');
 await expect(page.locator('.course-registration-form')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'重新報名',exact:true})).toHaveCount(0);
 await expect(page.getByRole('link',{name:'開啟 Zoom 會議',exact:true})).toHaveCount(0);
 await expect(page.locator('.course-order')).toContainText(stage==='before'?'待付款':'付款已逾期');
 if(stage!=='before')await expect(page.getByText(/付款期限已過，報名仍為您保留/)).toBeVisible();
 await page.screenshot({path:`/tmp/course-retention-${stage}-${info.project.name}.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('課後後台可篩選未付款並依客人要求取消，其他參加者保留',async({page},info)=>{
 await mockMember(page,'staff');
 const ended={...course,published:true,version:1,ends_at:'2025-01-01T02:00:00Z',starts_at:'2025-01-01T00:00:00Z'};
 const registrations=[{id:'unpaid-a',name:'待聯繫甲',kind:'delegated',status:'pending',payer_name:'測試師資',order_id:orderId,order_total_twd:2400,payment_status:'expired'},
  {id:'unpaid-b',name:'待聯繫乙',kind:'delegated',status:'pending',payer_name:'測試師資',order_id:orderId,order_total_twd:2400,payment_status:'expired'},
  {id:'paid',name:'已付款丙',kind:'pro_self',status:'active',payer_name:'已付款丙',order_id:orderId,order_total_twd:1200,payment_status:'paid'}];
 await page.route('**/rest/v1/rpc/get_admin_courses',route=>route.fulfill({json:[ended]}));
 const cases:any[]=[];
 await page.route('**/rest/v1/rpc/get_admin_course_roster',route=>route.fulfill({json:{registrations,cases}}));
 await page.route('**/rest/v1/rpc/get_admin_course_income',route=>route.fulfill({json:{paid_orders:1,paid_twd:1200,review_twd:0,refund_twd:0,net_twd:1200}}));
 let cancellations=0;
 await page.route('**/rest/v1/rpc/cancel_course_registration',route=>{
  expect(route.request().postDataJSON()).toEqual({p_registration_id:'unpaid-a',p_reason:'客人私訊要求取消'});cancellations++;
  registrations[0].status='cancelled';registrations[0].payment_status='hold';registrations[1].payment_status='hold';cases.push({id:'manual-unpaid',order_id:orderId,registration_id:'unpaid-a',kind:'cancelled_unpaid_registration',reason:'依客人要求取消，其他參加者保留，原付款待人工確認'});return route.fulfill({json:null});
 });
 if((page.viewportSize()?.width||0)<=900)await page.getByRole('button',{name:'開啟選單'}).click();
 await page.locator('.app-sidebar button:not(.sidebar-star)').filter({hasText:/^課程管理$/}).click();
 await page.getByRole('button',{name:'查看 專業護膚課程 報名名單'}).click();
 await page.getByLabel('付款狀態篩選').selectOption('unpaid');
 await expect(page.getByRole('row',{name:/已付款丙/})).toHaveCount(0);
 await expect(page.getByRole('row',{name:/待聯繫甲/})).toContainText('已報名');
 await page.getByRole('row',{name:/待聯繫甲/}).getByRole('button',{name:'取消報名',exact:true}).click();
 await page.getByLabel('取消原因').fill('客人私訊要求取消');
 await page.getByRole('button',{name:'確認取消報名',exact:true}).click();
 await expect.poll(()=>cancellations).toBe(1);
 await expect(page.getByRole('row',{name:/待聯繫乙/})).toContainText('已報名');
 await expect(page.getByRole('row',{name:/待聯繫乙/})).toContainText('付款暫停');
 await page.getByLabel('付款狀態篩選').selectOption('all');
 await expect(page.getByRole('row',{name:/待聯繫甲/})).toContainText('已取消');
 await page.screenshot({path:`/tmp/course-retention-admin-${info.project.name}.png`,fullPage:true});
});
