import { expect, test } from '@playwright/test';
import { mockEcladoApis } from './support/eclado-mocks';

test('營業分析提供成本待確認及估列核准，側欄只有一個入口', async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
  await mockEcladoApis(page, {
    adminAccess: true,
    backofficeAccess: { role: 'admin', permissions: ['analytics.read', 'procurement.manage'] },
    signInUser: {
      id: 'cost-admin', email: 'cost-admin@example.test', user_metadata: { name: '測試管理員' },
      app_metadata: { provider: 'email' }, aud: 'authenticated', role: 'authenticated',
      created_at: '2026-05-01T00:00:00.000Z',
    },
  });
  const costQueries: { p_from: string; p_to: string }[] = [];
  await page.route('**/rest/v1/rpc/get_admin_analytics', route => {
    const { p_start_date, p_end_date } = route.request().postDataJSON();
    return route.fulfill({ json: { startDate: p_start_date, endDate: p_end_date, daily: [], productSales: [], memberRevenue: [] } });
  });
  let approved = false;
  await page.route('**/rest/v1/rpc/approve_product_cost_estimate', route => {
    expect(route.request().postDataJSON()).toEqual({
      p_entry_id: '5', p_unit_cost_twd: '130', p_evidence: '',
    });
    approved = true;
    return route.fulfill({ json: null });
  });
  await page.route('**/rest/v1/rpc/get_product_cost_summary', route => {
    const request = route.request().postDataJSON();
    costQueries.push(request);
    expect(request.p_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(request.p_to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    return route.fulfill({ json: {
      started_at: '2026-11-10T01:00:00Z', processed_through: '2026-11-10T06:00:00Z',
      shipment_cost: approved ? 830 : 570, return_cost: 130, estimated_cost: approved ? 260 : 0,
      pending_quantity: approved ? 0 : 2, pending_orders: approved ? 0 : 1,
      shortage_quantity: approved ? 0 : 2, unknown_quantity: 0,
      pending_items: approved ? [] : [{ order_id: 'DEMO-SHIPMENT', line_index: 0, kind: 'shipment',
        variant_id: 101, reason: 'layer_shortage', quantity: 2, entry_id: '5', can_estimate: true,
        suggested_unit_cost_twd: 130, reference_receipt_no: '4', reference_received_on: '2026-10-09' }],
      approved_items: approved ? [{ order_id: 'DEMO-SHIPMENT', line_index: 0, quantity: 2,
        entry_id: '5', unit_cost_twd: 130, evidence: '', reference_receipt_no: '4',
        approved_at: '2026-11-10T06:00:00Z' }] : [],
    } });
  });
  await page.goto('/admin');
  await page.locator('input[type="email"]').fill('cost-admin@example.test');
  await page.locator('input[type="password"]').fill('local-test-password');
  await page.getByRole('button', { name: '進入後台' }).click();
  if ((page.viewportSize()?.width || 0) <= 900) await page.getByRole('button', { name: '開啟選單' }).click();
  await expect(page.locator('.app-sidebar button:not(.sidebar-star)').filter({ hasText: /^營運成本$/ })).toHaveCount(0);
  await page.locator('.app-sidebar button:not(.sidebar-star)').filter({ hasText: /^營業分析$/ }).click();
  await expect(page.getByRole('heading', { name: '營業分析' })).toBeVisible();
  const report = page.getByRole('region', { name: '已售產品成本' });
  await expect(report.getByText('淨額（已知小計）')).toBeVisible();
  const sectionHeadings = page.getByRole('heading', { level: 2 }).filter({
    hasText: /^(營業額趨勢|已售產品成本|商品銷售排行)$/,
  });
  await expect(sectionHeadings).toHaveText(['營業額趨勢', '已售產品成本', '商品銷售排行']);
  await expect(report.getByText(/440\.00/)).toBeVisible();
  await expect(report.getByText('1 張訂單、2 件成本待確認，其中 2 件成本層不足。')).toBeVisible();
  await page.getByLabel('開始日期').fill('2026-10-09');
  await page.getByLabel('結束日期').fill('2026-10-12');
  await page.getByRole('button', { name: '查詢', exact: true }).click();
  await expect.poll(() => costQueries.at(-1)).toEqual({ p_from: '2026-10-09', p_to: '2026-10-12' });
  await expect(report.getByText(/440\.00/)).toBeVisible();
  await report.getByText('查看成本待確認明細（最多 50 筆）').click();
  const pending = report.getByRole('row').filter({ hasText: 'DEMO-SHIPMENT' });
  await expect(pending).toContainText('成本層不足');
  await pending.getByRole('button', { name: '核准估列' }).click();
  await expect(report.getByLabel('台幣單位成本')).toHaveValue('130');
  await expect(report.getByLabel('核准依據（選填）')).toHaveValue('');
  await report.getByRole('button', { name: '確認核准估列' }).click();
  await expect(report.getByText(/700\.00/)).toBeVisible();
  await report.getByText('已採用估列（最多 50 筆）').click();
  await expect(report.getByRole('row').filter({ hasText: 'DEMO-SHIPMENT' })).toContainText('260.00');
});
