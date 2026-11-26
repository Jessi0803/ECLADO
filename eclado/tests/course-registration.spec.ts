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

test('訪客從立即報名直接登入，帳密登入後返回同一堂課程', async ({ page }) => {
  await mockMember(page, 'pro', true, true);
  await expect(page).toHaveURL(`/courses/${courseId}/register`);
  await expect(page.getByText('美容師本人付費報名', { exact: true })).toBeVisible();
});

test('課程代稱網址、識別碼轉向與登入返回仍以正確識別碼報名', async ({ page }) => {
  await mockMember(page, 'pro');
  const slug='2035-gold-care';
  await page.route('**/rest/v1/rpc/resolve_course_slug', route => {
    expect(route.request().postDataJSON()).toEqual({p_slug:slug});
    return route.fulfill({json:courseId});
  });
  await page.route('**/rest/v1/rpc/get_published_courses', route => route.fulfill({json:[{...course,slug}]}));
  await page.route('**/rest/v1/rpc/get_my_course_orders', route => {
    const key=route.request().postDataJSON().p_course_id;
    if(key)expect(key).toBe(courseId);
    return route.fulfill({json:{orders:[],courses:[]}});
  });
  await page.goto('/courses');
  await expect(page.getByRole('link',{name:/專業護膚課程/})).toHaveAttribute('href','/courses/'+slug);
  await page.getByRole('link',{name:/專業護膚課程/}).click();
  await expect(page).toHaveURL('/courses/'+slug);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href','https://ecladotaiwan.com/courses/'+slug);
  await page.goto('/courses/'+courseId);
  await expect(page).toHaveURL('/courses/'+slug);
  await page.getByRole('link',{name:'立即報名',exact:true}).click();
  await expect(page).toHaveURL('/courses/'+courseId+'/register');
  await expect(page.getByText('美容師本人付費報名',{exact:true})).toBeVisible();
  await page.goto('/courses/'+slug+'/register');
  await expect(page.getByText('美容師本人付費報名',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

for (const scenario of ['consumer', 'pending', 'consumer-pending', 'distributor', 'status-error'] as const) {
  test(`課程報名資格提示與申請入口 ${scenario}`, async ({ page }) => {
    const role = ['consumer-pending', 'status-error'].includes(scenario) ? 'consumer' : scenario;
    await mockMember(page, role);
    await page.route('**/rest/v1/rpc/get_my_course_orders', route => route.fulfill({ json: { orders: [] } }));
    let failed = scenario === 'status-error';
    await page.route('**/rest/v1/professional_applications**', route => route.fulfill(
      failed ? { status: 503, json: { message: 'Temporary outage' } }
        : { json: scenario === 'consumer-pending' ? { status: 'pending' } : null },
    ));
    await page.goto(`/courses/${courseId}/register`);
    const notice = page.getByRole('region', { name: '報名資格說明' });
    await expect(notice.getByText('本課程開放美容師及師資會員報名。')).toBeVisible();
    const apply = notice.getByRole('link', { name: '申請美容師資格 →' });
    if (scenario === 'consumer') {
      await expect(apply).toHaveAttribute('href', '/professional-apply');
      await apply.click();
      await expect(page).toHaveURL('/professional-apply');
      await expect(page.getByRole('heading', { name: '申請成為專業會員' })).toBeVisible();
    } else if (scenario.includes('pending')) {
      await expect(notice).toContainText('您的美容師資格申請正在審核中');
      await expect(apply).toHaveCount(0);
      await expect(notice.getByRole('link', { name: '查看申請狀態 →' })).toHaveAttribute('href', '/account');
    } else if (scenario === 'distributor') {
      await expect(notice).toContainText('您目前為經銷商會員');
      await expect(apply).toHaveCount(0);
    } else {
      await expect(notice.getByRole('alert')).toContainText('暫時無法確認申請狀態');
      await expect(apply).toHaveCount(0);
      failed = false;
      await notice.getByRole('button', { name: '重新確認' }).click();
      await expect(apply).toBeVisible();
    }
  });
}

for (const scenario of ['instructor', 'pro'] as const) {
  test(`${scenario} 課程報名、付款返回及狀態查詢`, async ({ page }) => {
    await mockMember(page, scenario, true);
    await expect(page).toHaveURL(`/courses/${courseId}/register`);
    const instructor = scenario === 'instructor';
    const due = '2035-11-11T01:50:00Z';
    const amount = instructor ? 2400 : 1200;
    const order = { id: orderId, course_id: courseId, course_name: course.name, total_twd: amount,
      status: 'pending', payment_due_at: due, registrations: [
        { id: 'self', name: '會員甲', kind: instructor ? 'instructor_self' : 'pro_self', status: instructor ? 'active' : 'pending' },
        ...(instructor ? [
          { id: 'student', name: '學生乙', kind: 'delegated', status: 'pending' },
          { id: 'guest', name: '王小美', kind: 'delegated', status: 'pending' },
        ] : []),
      ],
    };
    let created = false;
    let paid = false;
    let paymentStarts = 0;
    await page.route('**/rest/v1/rpc/get_my_instructor_students', route => route.fulfill({
      json: [{ binding_id: 'known-binding', student_name: '學生乙' }],
    }));
    await page.route('**/rest/v1/rpc/get_my_course_orders', route => route.fulfill({
      json: { orders: created ? [order] : [], zoom_url: paid ? 'https://zoom.us/j/123' : null },
    }));
    await page.route('**/rest/v1/rpc/create_course_registration', route => {
      const args = route.request().postDataJSON();
      expect(args).toMatchObject({ p_course_id: courseId, p_self: true, p_expected_price: 1200,
        p_participants: instructor ? [{ binding_id: 'known-binding' }, { family_name: '王', given_name: '小美' }] : [],
      });
      expect(args.p_request_id).toMatch(/^[0-9a-f-]{36}$/);
      created = true;
      return route.fulfill({ json: order });
    });
    await page.route('**/api/courses/payment/start', route => {
      expect(route.request().postDataJSON()).toEqual({ orderId, paymentMethod: instructor ? 'apple' : 'card' });
      expect(route.request().headers().authorization).toMatch(/^Bearer /);
      expect(created).toBe(true);
      paymentStarts += 1;
      if (instructor && paymentStarts === 1) {
        return route.fulfill({ status: 503, json: { error: '暫時無法啟動付款' } });
      }
      return route.fulfill({ json: { paymentLink: 'https://course-bank.example.test/pay' } });
    });
    await page.route('https://course-bank.example.test/pay', route => route.fulfill({ body: '本機模擬銀行付款頁' }));
    await page.route('**/api/courses/payment/status', route => {
      expect(route.request().postDataJSON()).toEqual({ orderId });
      paid = true;
      order.status = 'paid';
      order.registrations.forEach(reg => { reg.status = 'active'; });
      return route.fulfill({ json: { order } });
    });

    await page.reload();
    if (instructor) {
      await page.getByLabel('我本人也要報名（免費）').check();
      await expect(page.getByText(/預計回饋 NT\$ 0 購物金/)).toBeVisible();
      await page.getByRole('button', { name: '新增參加者' }).click();
      const first = page.getByRole('group', { name: '參加者 1' });
      await first.getByLabel('如何填寫姓名？').selectOption('binding');
      await first.getByLabel('學生姓名', { exact: true }).selectOption('known-binding');
      await page.getByRole('button', { name: '新增參加者' }).click();
      const second = page.getByRole('group', { name: '參加者 2' });
      await second.getByLabel('姓', { exact: true }).fill('王');
      await second.getByLabel('名', { exact: true }).fill('小美');
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(second.getByLabel('名', { exact: true })).toHaveValue('小美');
    }
    await expect(page.locator('form strong')).toHaveText(instructor ? 'NT$ 2,400' : 'NT$ 1,200');
    if (instructor) await expect(page.getByText(/預計回饋 NT\$ 2,400 購物金/)).toBeVisible();
    const paymentMethods = page.locator('form').getByRole('group', { name: '付款方式' });
    await expect(paymentMethods.locator('.payment-method-name')).toHaveText(['虛擬帳號匯款', '信用卡', 'Apple Pay', 'Google Pay']);
    if (instructor) await paymentMethods.getByRole('button', { name: /Apple Pay/ }).click();
    await page.getByRole('button', { name: '前往付款', exact: true }).click();
    if (instructor) {
      const paymentArea = page.getByRole('article', { name: '接續付款' });
      await expect(paymentArea).toBeFocused();
      await expect(paymentArea.getByText('會員甲 · 報名成立')).toBeVisible();
      await expect(paymentArea.getByText('王小美 · 待付款')).toBeVisible();
      await expect(paymentArea.getByRole('status')).toContainText('暫時無法啟動付款');
      await expect(paymentArea.getByRole('button', { name: /^Apple Pay/ })).toHaveAttribute('aria-pressed', 'true');
      await paymentArea.getByRole('button', { name: '前往Apple Pay付款' }).click();
    }
    await expect(page).toHaveURL('https://course-bank.example.test/pay');
    await page.goBack();
    await expect(page.getByText(instructor ? '王小美 · 待付款' : '會員甲 · 待付款')).toBeVisible();
    await page.getByRole('button', { name: '查詢付款狀態' }).click();
    await expect(page.getByRole('link', { name: '開啟 Zoom 會議' })).toBeVisible();
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async (value: string) => sessionStorage.setItem('copiedMeetingLink', value) },
      });
    });
    await page.getByRole('button', { name: '複製會議連結' }).click();
    await expect(page.getByText('會議連結已複製。')).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('copiedMeetingLink'))).toBe('https://zoom.us/j/123');

    if (instructor) await expect(page.getByText('王小美 · 報名成立')).toBeVisible();
    await page.route('**/rest/v1/rpc/get_my_course_orders', route => route.fulfill({
      json: { orders: [order], zoom_url: 'https://zoom.us/j/123', ends_at: '2020-01-01T00:00:00Z' },
    }));
    await page.reload();
    await expect(page.getByRole('region', { name: '我的課程報名' })).toBeVisible();
    await expect(page.getByRole('link', { name: '開啟 Zoom 會議' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '複製會議連結' })).toHaveCount(0);
  });
}

test('後台取消一人、保留同單其他報名並可記錄人工處理', async ({ page }) => {
  await mockMember(page, 'staff');
  const registrations = ['王小美', '學生乙'].map((name, i) => ({
    id: String(i), name, kind: 'delegated', status: 'active', payer_name: '師資甲',
    order_id: orderId, order_total_twd: 2400, payment_status: 'paid',
  }));
  const cases: { id: string; order_id: string; registration_id: string; kind: string; reason: string;
    resolved_at?: string; resolution?: string }[] = [];
  await page.route('**/rest/v1/rpc/get_admin_courses', route => route.fulfill({ json: [{ ...course, published: true, version: 1, open_case_count: 1, notification_exception_count: 2 }] }));
  await page.route('**/rest/v1/rpc/get_admin_course_roster', route => route.fulfill({ json: { registrations, cases } }));
  await page.route('**/rest/v1/rpc/get_admin_course_income', route => route.fulfill({ json: { paid_orders: 1, paid_twd: 2400, review_twd: 0, refund_twd: 0, net_twd: 2400 } }));
  await page.route('**/rest/v1/rpc/cancel_course_registration', route => {
    expect(route.request().postDataJSON()).toEqual({ p_registration_id: '0', p_reason: '參加者臨時無法出席' });
    registrations[0].status = 'cancelled';
    cases.push({ id: 'refund-case', order_id: orderId, registration_id: '0', kind: 'cancelled_paid_registration', reason: '參加者臨時無法出席' });
    return route.fulfill({ json: null });
  });
  await page.route('**/rest/v1/rpc/resolve_course_manual_case', route => {
    expect(route.request().postDataJSON()).toEqual({ p_case_id: 'refund-case', p_resolution: '已人工聯繫並記錄' });
    Object.assign(cases[0], { resolved_at: '2035-11-10', resolution: '已人工聯繫並記錄' });
    return route.fulfill({ json: null });
  });

  if ((page.viewportSize()?.width || 0) <= 900) await page.getByRole('button', { name: '開啟選單' }).click();
  await page.locator('.app-sidebar button:not(.sidebar-star)').filter({ hasText: /^課程管理$/ }).click();
  await page.getByRole('button', { name: '查看 專業護膚課程 報名名單' }).click();
  await expect(page.getByText('有效報名 2 人')).toBeVisible();
  const cancel = page.getByRole('row', { name: /王小美/ }).getByRole('button', { name: '取消報名', exact: true });
  await cancel.click();
  const dialog = page.getByRole('dialog', { name: '取消報名' });
  await expect(dialog.getByText('王小美', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '保留報名' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('有效報名 2 人')).toBeVisible();
  await cancel.click();
  await dialog.getByLabel('取消原因').fill('參加者臨時無法出席');
  await dialog.getByRole('button', { name: '確認取消報名' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('有效報名 1 人')).toBeVisible();
  await expect(page.getByRole('row', { name: /學生乙/ })).toContainText('報名成立');
  await expect(page.getByRole('row', { name: /王小美/ })).toContainText('已付款');
  await page.getByRole('button', { name: '記錄處理結果' }).click();
  await page.getByLabel('處理結果').fill('已人工聯繫並記錄');
  await page.getByRole('button', { name: '儲存處理紀錄' }).click();
  await expect(page.getByText('已結案 · 已人工聯繫並記錄')).toBeVisible();
});

test('課程後台可選取有效報名發送通知、查看結果及收入摘要', async ({ page }) => {
  await mockMember(page, 'staff');
  const registrations = ['王小美', '學生乙', '取消的人'].map((name, index) => ({
    id: String(index), name, kind: 'delegated', status: index === 2 ? 'cancelled' : 'active', payer_name: '師資甲',
    order_id: orderId, order_total_twd: 3600, payment_status: 'paid',
  }));
  let state = '';
  await page.route('**/rest/v1/rpc/get_admin_courses', route => route.fulfill({ json: [{ ...course, published: true, version: 1, open_case_count: 1, notification_exception_count: 2 }] }));
  await page.route('**/rest/v1/rpc/get_admin_course_roster', route => route.fulfill({ json: { registrations, cases: [] } }));
  await page.route('**/rest/v1/rpc/queue_manual_course_notification', route => {
    expect(route.request().postDataJSON()).toMatchObject({
      p_course_id: courseId, p_registration_ids: ['0', '1'], p_message: '請提早登入',
    });
    state = 'pending';
    return route.fulfill({ json: 1 });
  });
  await page.route('**/rest/v1/rpc/get_admin_course_notifications', route => route.fulfill({
    json: state ? [{ id: 'notice1', kind: 'manual', status: state, payer_name: '師資甲', channel: 'line',
      created_at: course.starts_at }] : [],
  }));
  await page.route('**/rest/v1/rpc/get_admin_course_income', route => route.fulfill({
    json: { paid_orders: 1, paid_twd: 3600, review_twd: 1200, refund_twd: 1000, net_twd: 3800 },
  }));

  if ((page.viewportSize()?.width || 0) <= 900) await page.getByRole('button', { name: '開啟選單' }).click();
  await page.locator('.app-sidebar button:not(.sidebar-star)').filter({ hasText: /^課程管理$/ }).click();
  const cases = page.getByRole('button', { name: '查看 專業護膚課程 待人工處理' });
  await expect(cases).toHaveAccessibleName('查看 專業護膚課程 待人工處理 1 筆');
  await cases.click();
  await expect(page.getByRole('heading', { name: '人工處理案件' })).toBeFocused();
  await page.getByRole('button', { name: /返回課程列表/ }).click();
  const exceptions = page.getByRole('button', { name: '查看 專業護膚課程 通知異常' });
  await expect(exceptions).toHaveAccessibleName('查看 專業護膚課程 通知異常 2 筆');
  const filteredRequest = page.waitForRequest('**/rest/v1/rpc/get_admin_course_notifications');
  await exceptions.click();
  expect((await filteredRequest).postDataJSON()).toMatchObject({ p_only_exceptions: true });
  const exceptionFilter = page.getByRole('checkbox', { name: '只顯示通知異常' });
  await expect(exceptionFilter).toBeChecked();
  await exceptionFilter.uncheck();
  await expect(exceptionFilter).not.toBeChecked();
  await page.getByRole('tab', { name: '報名摘要' }).click();
  const rosterTab = page.getByRole('tab', { name: '報名摘要' });
  await expect(rosterTab).toHaveAttribute('aria-selected', 'true');
  const summary = page.getByRole('tabpanel', { name: '報名摘要' });
  await expect(summary.getByText('NT$ 3,800', { exact: true })).toBeVisible();
  await expect(summary.getByRole('row', { name: /王小美/ })).toBeVisible();
  await page.getByRole('tab', { name: '通知與發送紀錄' }).click();
  await expect(page.getByRole('tabpanel', { name: '報名摘要' })).not.toBeVisible();
  await expect(page.getByRole('checkbox', { name: /取消的人/ })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /王小美.*寄給 師資甲/ })).toBeVisible();
  await page.getByRole('button', { name: '全選有效報名' }).click();
  await page.getByLabel('補充說明（選填）').fill('請提早登入');
  await page.getByRole('tab', { name: '通知與發送紀錄' }).press('ArrowLeft');
  await expect(page.getByText('NT$ 3,800', { exact: true })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: '通知與發送紀錄' })).not.toBeVisible();
  await page.getByRole('tab', { name: '通知與發送紀錄' }).click();
  await expect(page.getByLabel('補充說明（選填）')).toHaveValue('請提早登入');
  await page.getByRole('button', { name: '排入通知' }).click();
  await expect(page.getByText('已排入 1 位收件人的通知。')).toBeVisible();
  await expect(page.getByText('待發送', { exact: true })).toBeVisible();
  state = 'sent';
  await page.getByRole('button', { name: '重新整理發送紀錄' }).click();
  await expect(page.getByText('服務商已接受', { exact: true })).toBeVisible();
  await rosterTab.click();
  await expect(page.getByText('NT$ 3,800', { exact: true })).toBeVisible();
});

test('會員中心可直接從我的課程開啟 Zoom 並查看報名', async ({ page }) => {
  await mockMember(page, 'instructor');
  await page.route('**/rest/v1/rpc/get_my_course_orders', route => {
    expect(route.request().postDataJSON()).toEqual({ p_course_id: null });
    return route.fulfill({ json: { courses: [{
      ...course, zoom_url: 'https://zoom.us/j/123',
      orders: [{ id: orderId, status: 'paid', total_twd: 1200, registrations: [
        { id: 'self', name: '會員甲', kind: 'instructor_self', status: 'active' },
        { id: 'guest', name: '王小美', kind: 'delegated', status: 'active' },
      ] }],
    }] } });
  });
  await page.goto('/account');
  await page.getByRole('tab', { name: '我的課程' }).click();
  const panel = page.getByRole('tabpanel', { name: '我的課程' });
  await expect(panel.getByText('王小美', { exact: false })).toBeVisible();
  await expect(panel.getByRole('link', { name: '開啟 Zoom 會議' })).toHaveAttribute('href', 'https://zoom.us/j/123');
  await expect(panel.getByRole('link', { name: '查看報名與付款詳情' })).toHaveAttribute('href', `/courses/${courseId}/register`);
  await page.getByRole('tab', { name: '我的訂單' }).click();
  await expect(page.getByRole('heading', { name: '我的訂單' })).toBeVisible();
});

test('會員中心沒有課程報名紀錄時隱藏我的課程', async ({ page }) => {
  await mockMember(page, 'instructor');
  await page.route('**/rest/v1/rpc/get_my_course_orders', route => route.fulfill({ json: { courses: [] } }));
  const history = page.waitForResponse('**/rest/v1/rpc/get_my_course_orders');
  await page.goto('/account?tab=courses');
  await history;
  await expect(page.getByRole('tab', { name: '我的訂單' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: '我的課程' })).toHaveCount(0);
});

test('會員中心只有待付款及已取消紀錄時仍顯示我的課程', async ({ page }) => {
  await mockMember(page, 'instructor');
  await page.route('**/rest/v1/rpc/get_my_course_orders', route => route.fulfill({ json: { courses: [{
    ...course, zoom_url: null,
    orders: [
      { id: 'pending-order', status: 'pending', total_twd: 1200, registrations: [
        { id: 'pending', name: '待付款參加者', kind: 'delegated', status: 'pending' },
      ] },
      { id: 'cancelled-order', status: 'paid', total_twd: 1200, registrations: [
        { id: 'cancelled', name: '取消的參加者', kind: 'delegated', status: 'cancelled' },
      ] },
    ],
  }] } }));
  await page.goto('/account?tab=courses');
  const panel = page.getByRole('tabpanel', { name: '我的課程' });
  await expect(panel.getByRole('listitem').filter({ hasText: /待付款參加者.*待付款/ })).toBeVisible();
  await expect(panel.getByRole('listitem').filter({ hasText: /取消的參加者.*已取消/ })).toBeVisible();
  await expect(panel.getByRole('link', { name: '開啟 Zoom 會議' })).toHaveCount(0);
});

for (const status of ['none', 'pending', 'cancelled'] as const) {
  test(`專業課程列表依報名紀錄顯示會員入口 (${status})`, async ({ page }) => {
    await mockMember(page, 'instructor');
    const courses = status === 'none' ? [] : [{
      ...course,
      orders: [{
        id: orderId, status: status === 'pending' ? 'pending' : 'paid', total_twd: 1200,
        registrations: [{ id: 'attendee', name: '王小美', kind: 'delegated', status }],
      }],
    }];
    await page.route('**/rest/v1/rpc/get_my_course_orders', route => route.fulfill({ json: { courses } }));
    const history = page.waitForResponse('**/rest/v1/rpc/get_my_course_orders');
    await page.goto('/courses');
    await history;
    await expect(page.getByRole('heading', { name: course.name })).toBeVisible();
    const shortcut = page.getByRole('link', { name: '查看我的課程' });
    if (status === 'none') {
      await expect(shortcut).toHaveCount(0);
    } else {
      await shortcut.click();
      await expect(page.getByRole('tabpanel', { name: '我的課程' }).getByText(/王小美/)).toBeVisible();
    }
  });
}

for (const method of ['free', 'atm'] as const) {
  test(`課程一步報名 ${method}`, async ({ page }) => {
    const free = method === 'free';
    await mockMember(page, free ? 'instructor' : 'pro', true);
    const due = '2035-11-11T01:50:00Z';
    const order = {
      id: orderId, course_name: course.name, payment_due_at: due,
      status: free ? 'free' : 'pending', total_twd: free ? 0 : 1200,
      registrations: [{
        id: 'self', name: '會員甲', kind: free ? 'instructor_self' : 'pro_self',
        status: free ? 'active' : 'pending',
      }],
    };
    let created = false;
    let starts = 0;
    await page.route('**/rest/v1/rpc/get_my_course_orders', route => route.fulfill({
      json: { orders: created ? [order] : [] },
    }));
    await page.route('**/rest/v1/rpc/create_course_registration', route => {
      created = true;
      return route.fulfill({ json: order });
    });
    await page.route('**/api/courses/payment/start', route => {
      starts += 1;
      expect(route.request().postDataJSON()).toEqual({ orderId, paymentMethod: 'atm' });
      return route.fulfill({ json: { paymentMethod: 'atm', atmAccount: '12345678901234', atmDueAt: due } });
    });
    await page.reload();
    if (free) {
      await page.getByLabel('我本人也要報名（免費）').check();
      await expect(page.getByRole('group', { name: '付款方式' })).toHaveCount(0);
      await page.getByRole('button', { name: '確認報名' }).click();
      await expect(page.getByText('會員甲 · 報名成立')).toBeVisible();
    } else {
      await page.getByRole('group', { name: '付款方式' }).getByRole('button', { name: /虛擬帳號匯款/ }).click();
      await page.getByRole('button', { name: '取得虛擬帳號' }).click();
      await expect(page.getByLabel('匯款資訊')).toContainText('12345678901234');
      await expect(page.getByText('會員甲 · 待付款')).toBeVisible();
    }
    expect(starts).toBe(free ? 0 : 1);
  });
}

test('LINE 課程登入回來後會回到原報名頁', async ({ page }) => {
  const id = 'course-line-member';
  const slug = 'line-gold-care';
  await page.route('https://**/*', route => route.abort());
  await mockEcladoApis(page, {
    authUser: {
      id, email: 'course-line@example.test', user_metadata: { name: 'LINE 會員' },
      app_metadata: { provider: 'email' }, aud: 'authenticated', role: 'authenticated',
      created_at: '2026-05-01T00:00:00.000Z',
    },
    profiles: [{ id, name: 'LINE 會員', role: 'pro' }],
  });
  await page.route('**/rest/v1/rpc/get_published_courses', route => route.fulfill({ json: [{...course,slug}] }));
  await page.route('**/rest/v1/rpc/resolve_course_slug', route => route.fulfill({json:courseId}));
  await page.route('**/rest/v1/rpc/get_my_course_orders', route => route.fulfill({ json: { orders: [] } }));
  await page.addInitScript(path => {
    if (window.location.pathname !== '/line-callback') return;
    sessionStorage.setItem('eclado_line_login_pending', '1');
    sessionStorage.setItem('eclado_course_line_return', path);
  }, `/courses/${slug}/register`);
  await page.goto('/line-callback#access_token=mock-access-token&refresh_token=mock-refresh-token&expires_in=3600&token_type=bearer&type=magiclink');
  await expect(page).toHaveURL(`/courses/${slug}/register`);
  await expect(page.getByRole('button', { name: '前往付款', exact: true })).toBeVisible();
});

test('課程列表優先顯示可報名課程並收錄已結束課程', async ({ page }) => {
  await mockMember(page, 'instructor');
  const past = { ...course, id: orderId, name: '過往課程', starts_at: '2020-01-01T00:00:00Z', ends_at: '2020-01-01T02:00:00Z' };
  await page.route('**/rest/v1/rpc/get_published_courses', route => route.fulfill({ json: [past, course] }));
  await page.goto('/courses');
  await expect(page.locator('#education-courses section > h2')).toHaveText(['可報名課程', '歷年課程']);
  await expect(page.getByRole('region', { name: '可報名課程' }).getByRole('link', { name: /專業護膚課程/ })).toBeVisible();
  await expect(page.getByRole('region', { name: '歷年課程' }).getByRole('link', { name: /過往課程/ })).toBeVisible();
});

test('已結束課程只向有該堂報名紀錄的會員顯示紀錄入口', async ({ page }) => {
  await mockMember(page, 'instructor');
  const endedCourse = { ...course, starts_at: '2020-01-01T00:00:00Z', ends_at: '2020-01-01T02:00:00Z' };
  const orders = [{
    id: orderId, course_name: course.name, status: 'paid', total_twd: 1200,
    registrations: [{ id: 'historical-seat', name: '歷史參加者', kind: 'delegated', status: 'cancelled' }],
  }];
  let bookedCourseId = orderId;
  await page.route('**/rest/v1/rpc/get_published_courses', route => route.fulfill({ json: [endedCourse] }));
  await page.route('**/rest/v1/rpc/get_my_course_orders', route => route.fulfill({
    json: route.request().postDataJSON().p_course_id
      ? { orders, ends_at: endedCourse.ends_at, zoom_url: null }
      : { courses: [{ ...endedCourse, id: bookedCourseId, orders }] },
  }));

  const history = page.waitForResponse('**/rest/v1/rpc/get_my_course_orders');
  await page.goto(`/courses/${courseId}`);
  await history;
  await expect(page.getByText('課程已結束', { exact: true })).toBeVisible();
  const recordLink = page.getByRole('link', { name: '查看報名紀錄' });
  await expect(recordLink).toHaveCount(0);

  bookedCourseId = courseId;
  await page.reload();
  await recordLink.click();
  await expect(page.getByText('課程已結束', { exact: true })).toBeVisible();
  await expect(page.getByText('歷史參加者 · 已取消')).toBeVisible();
  await expect(page.locator('.course-registration-form')).toHaveCount(0);
});
