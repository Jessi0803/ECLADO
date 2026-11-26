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



for(const withOrder of [true,false])test(`開課前半小時後停止付款但保留報名 ${withOrder}`,async({page},info)=>{
 await mockMember(page,'pro',true);
 const start=Date.now()+29*60000,cutoff=start-30*60000;
 const current={...course,starts_at:new Date(start).toISOString(),ends_at:new Date(start+7200000).toISOString()};
 await page.route('**/rest/v1/rpc/get_published_courses',route=>route.fulfill({json:[current]}));
 await page.route('**/rest/v1/rpc/get_my_course_orders',route=>route.fulfill({json:{ends_at:current.ends_at,orders:withOrder?[{
  id:orderId,course_name:course.name,status:'expired',total_twd:1200,payment_due_at:new Date(cutoff).toISOString(),
  registrations:[{id:'p',name:'示範美容師',kind:'pro_self',status:'pending'}]}]:[]}}));
 await page.reload();
 if(withOrder){
  await expect(page.locator('.course-order')).toContainText('付款已逾期');await expect(page.locator('.course-order')).toContainText('示範美容師 · 已報名');
  await expect(page.getByText(/付款已於開課前 30 分鐘截止/)).toBeVisible();
  await expect(page.getByRole('button',{name:/繼續.*付款|取得虛擬帳號|重新報名/})).toHaveCount(0);
 }else{
  await expect(page.getByText(/付費報名與付款已於開課前 30 分鐘截止/)).toBeVisible();
  await expect(page.getByRole('button',{name:'前往付款',exact:true})).toBeDisabled();
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`/tmp/course-cutoff-${withOrder}-${info.project.name}.png`,fullPage:true});
});
test('報名前顯示開課前30分鐘付款截止說明',async({page})=>{
 await mockMember(page,'pro',true);await page.route('**/rest/v1/rpc/get_my_course_orders',route=>route.fulfill({json:{orders:[]}}));await page.reload();
 await expect(page.locator('.course-registration-form')).toContainText('開課前 30 分鐘');
 await expect(page.getByRole('button',{name:'前往付款',exact:true})).toBeEnabled();
});
