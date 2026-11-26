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


for(const method of ['card','apple','google','atm'])test(`美容師 ${method} 原訂單續付`,async({page},info)=>{
 await mockMember(page,'pro',true);
 const order={id:orderId,course_id:courseId,course_name:course.name,total_twd:1200,status:'pending',
   payment_due_at:course.starts_at,payment_method:method,payment_link_expires_at:'2025-01-01T00:00:00Z',
   registrations:[{id:'p',name:'示範美容師',kind:'pro_self',status:'pending'}]};
 await page.route('**/rest/v1/rpc/get_my_course_orders',route=>route.fulfill({json:{orders:[order],ends_at:course.ends_at}}));
 let starts=0;
 await page.route('**/api/courses/payment/start',route=>{
  starts++;expect(route.request().postDataJSON()).toEqual({orderId,paymentMethod:method});
  return route.fulfill({json:{paymentMethod:method,paymentLink:'https://course-bank.example.test/renewed',
    ...(method==='atm'?{atmAccount:'22345678901234',atmDueAt:course.starts_at,linkExpiresAt:course.starts_at}:{})}});
 });
 await page.route('https://course-bank.example.test/renewed',route=>route.fulfill({body:'本機模擬續付成功'}));
 await page.reload();
 await expect(page.getByText('原付款連結或帳號已到期，訂單仍保留。點選下方按鈕確認付款狀態並繼續付款。')).toBeVisible();
 await expect(page.locator('.course-registration-form')).toHaveCount(0);
 await page.screenshot({path:`/tmp/course-resume-${method}-${info.project.name}.png`,fullPage:true});
 const button=method==='atm'?page.getByRole('button',{name:'取得虛擬帳號',exact:true}):page.getByRole('button',{name:/繼續.*付款/});
 await button.click();await expect.poll(()=>starts).toBe(1);
 if(method==='atm')await expect(page.getByText('22345678901234')).toBeVisible();else await expect(page).toHaveURL('https://course-bank.example.test/renewed');
});
for(const started of [false,true])test(`付款逾期重新報名入口：課程已開始 ${started}`,async({page},info)=>{
 await mockMember(page,'pro',true);
 const current={...course,...(started?{starts_at:'2025-01-01T00:00:00Z',ends_at:'2025-01-01T02:00:00Z'}:{})};
 await page.route('**/rest/v1/rpc/get_published_courses',route=>route.fulfill({json:[current]}));
 await page.route('**/rest/v1/rpc/get_my_course_orders',route=>route.fulfill({json:{ends_at:current.ends_at,orders:[{
  id:orderId,course_name:course.name,status:'expired',total_twd:1200,payment_due_at:'2025-01-01T00:00:00Z',
  registrations:[{id:'p',name:'示範美容師',kind:'pro_self',status:'cancelled'}]}]}}));
 await page.reload();
 const retry=page.getByRole('button',{name:'重新報名',exact:true});
 if(started){await expect(retry).toHaveCount(0);await expect(page.getByText('課程目前已停止報名，無法重新報名。')).toBeVisible();}
 else{
  await expect(retry).toBeVisible();await retry.click();await expect(page.locator('.course-registration-form')).toBeFocused();
  await expect(page.getByRole('button',{name:'前往付款',exact:true})).toBeVisible();
 }
 await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
 await page.screenshot({path:`/tmp/course-reenroll-${started}-${info.project.name}.png`,fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('停留頁面付款到期保留已報名，不出現重新報名',async({page})=>{
 await mockMember(page,'pro',true);await page.clock.install({time:new Date('2030-01-01T00:00:00Z')});
 await page.route('**/rest/v1/rpc/get_my_course_orders',route=>route.fulfill({json:{orders:[{
  id:orderId,course_name:course.name,status:'pending',total_twd:1200,payment_due_at:'2030-01-01T00:00:03Z',
  registrations:[{id:'p',name:'示範美容師',kind:'pro_self',status:'pending'}]}]}}));
 await page.reload();await expect(page.locator('.course-registration-form')).toHaveCount(0);
 await page.clock.fastForward(5000);await expect(page.getByRole('button',{name:'重新報名',exact:true})).toHaveCount(0);
 await expect(page.locator('.course-order')).toContainText('付款已逾期');
 await expect(page.locator('.course-order')).toContainText('示範美容師 · 已報名');
});
