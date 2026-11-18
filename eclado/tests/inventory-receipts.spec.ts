import { expect, test } from '@playwright/test';
import { mockEcladoApis } from './support/eclado-mocks';

test('入庫單可建單、預覽、確認及從歷史查看成本', async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
  await mockEcladoApis(page, {
    adminAccess: true,
    signInUser: {
      id: 'receipt-admin', email: 'receipt-admin@example.test', user_metadata: { name: '管理員' },
      app_metadata: { provider: 'email' }, aud: 'authenticated', role: 'authenticated',
      created_at: '2026-05-01T00:00:00.000Z',
    },
  });
  const product = {
    variant_id: '101', sku: 'FOAM-200', product_name: '泡泡潔顏', variant_name: '200ml',
    unit_weight_g: 250, unit_cost_usd: 3.25,
  };
  let previewId: string;
  let postCalls = 0;
  const saved = {
    receipt_no: '7', received_on: '2026-11-10', version: 1, exchange_rate: 32,
    payment_fee_twd: 10, customs_twd: 20, freight_twd: 30, total_twd: 268, posted_at: null,
    items: [{ ...product, quantity: 2, goods_twd: 208, payment_fee_twd: 10, customs_twd: 20,
      freight_twd: 30, total_twd: 268, unit_cost_twd: 134 }],
  };
  const posted = { ...saved, posted_at: '2026-11-10T03:00:00Z' };
  await page.route('**/rest/v1/rpc/get_inventory_receipts', route => route.fulfill({
    json: route.request().postDataJSON().p_receipt_id ? { ...posted, id: previewId }
      : postCalls ? [{ ...posted, id: previewId }] : [],
  }));
  await page.route('**/rest/v1/rpc/search_inventory_receipt_variants', route => {
    expect(['', 'FOAM']).toContain(route.request().postDataJSON().p_query);
    return route.fulfill({ json: [product, { ...product, variant_id: '102', sku: 'FOAM-500', variant_name: '500ml' }] });
  });
  await page.route('**/rest/v1/rpc/save_inventory_receipt', route => {
    const args = route.request().postDataJSON();
    previewId = args.p_id;
    expect(args).toMatchObject({
      p_version: 0, p_received_on: '2026-11-10', p_exchange_rate: '32',
      p_payment_fee_twd: '10', p_customs_twd: '20', p_freight_twd: '30',
      p_items: [{ variant_id: '101', quantity: '2', unit_weight_g: 250, unit_cost_usd: 3.25 }],
    });
    return route.fulfill({ json: { ...saved, id: previewId } });
  });
  await page.route('**/rest/v1/rpc/post_inventory_receipt', route => {
    postCalls += 1;
    expect(route.request().postDataJSON()).toEqual({ p_id: previewId, p_version: 1 });
    return route.fulfill({ json: { ...posted, id: previewId } });
  });

  await page.goto('/admin');
  await page.locator('input[type="email"]').fill('receipt-admin@example.test');
  await page.locator('input[type="password"]').fill('local-test-password');
  await page.getByRole('button', { name: '進入後台' }).click();
  if ((page.viewportSize()?.width || 0) <= 900) {
    await page.getByRole('button', { name: '開啟選單' }).click();
  }
  await page.locator('.app-sidebar button:not(.sidebar-star)').filter({ hasText: /^入庫單管理$/ }).click();
  await page.getByRole('button', { name: '新增入庫單' }).click();
  await page.getByRole('button', { name: /選擇商品/ }).click();
  const picker = page.getByRole('dialog', { name: '選擇入庫商品' });
  await picker.getByLabel('搜尋商品規格').fill('FOAM');
  await picker.getByRole('checkbox', { name: /FOAM-200/ }).check();
  await picker.getByRole('checkbox', { name: /FOAM-500/ }).check();
  await picker.getByRole('button', { name: '已選', exact: true }).click();
  await expect(picker.getByRole('checkbox', { name: /FOAM-200/ })).toBeChecked();
  await picker.getByRole('button', { name: '加入 2 項商品' }).click();
  await expect(page.getByLabel('FOAM-500 入庫數量')).toHaveValue('1');
  await page.getByRole('button', { name: '移除 FOAM-500' }).click();
  await page.getByLabel('入庫日期').fill('2026-11-10');
  await page.getByLabel('付款匯率（TWD／USD）').fill('32');
  await page.getByLabel('支付手續費（TWD）').fill('10');
  await page.getByLabel('關稅（TWD）').fill('20');
  await page.getByLabel('運費（TWD）').fill('30');
  await page.getByLabel('FOAM-200 入庫數量').fill('2');
  await expect(page.getByLabel('FOAM-200 每件重量（g）')).toHaveValue('250');
  await page.getByRole('button', { name: '儲存草稿並預覽' }).click();
  await expect(page.getByRole('heading', { name: '入庫成本預覽' })).toBeVisible();
  await expect(page.getByText('134.00', { exact: true })).toBeVisible();
  expect(postCalls).toBe(0);
  await page.getByRole('button', { name: '確認入庫' }).click();
  await expect(page.getByRole('status').filter({ hasText: '已確認入庫並保存成本明細' })).toBeVisible();
  await page.getByRole('button', { name: '返回入庫單' }).click();
  await page.getByRole('button', { name: '查看 #7' }).click();
  await expect(page.getByRole('heading', { name: '入庫成本明細' })).toBeVisible();
  await expect(page.getByText('134.00', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '確認入庫' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '刪除草稿' })).toHaveCount(0);
  expect(postCalls).toBe(1);
});

test('叫貨單可開啟分批入庫草稿並取消未到商品', async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
  await mockEcladoApis(page, {
    adminAccess: true,
    signInUser: {
      id: 'receipt-admin', email: 'receipt-admin@example.test', user_metadata: { name: '管理員' },
      app_metadata: { provider: 'email' }, aud: 'authenticated', role: 'authenticated',
      created_at: '2026-05-01T00:00:00.000Z',
    },
  });
  const poNumber = 'PO-PARTIAL-TEST';
  const items = [
    { variant_id: '101', sku: 'FOAM-200', product_name: '泡泡潔顏', variant_name: '200ml',
      ordered_quantity: 5, received_quantity: 2, quantity: 3, unit_weight_g: 250, unit_cost_usd: 3.25 },
    { variant_id: '102', sku: 'LOTION-500', product_name: '身體乳', variant_name: '500ml',
      ordered_quantity: 2, received_quantity: 0, quantity: 2, unit_weight_g: null, unit_cost_usd: 5 },
  ];
  const draft = {
    id: 'linked-draft', receipt_no: '8', version: 1, preview_ready: false, posted_at: null,
    purchase_order_no: poNumber, received_on: '2026-11-10', exchange_rate: null, payment_fee_twd: 0,
    customs_twd: 0, freight_twd: 0, source_items: items, items,
  };
  await page.route('**/rest/v1/rpc/get_procurement_management_data', route => route.fulfill({
    json: { orders: [{ id: 50, po_number: poNumber, status: 'shipping', created_at: '2026-11-10T03:00:00Z',
      supplier_name: '測試供應商', exchange_rate: 32, items: [] }] },
  }));
  let complete = false;
  await page.route('**/rest/v1/rpc/get_purchase_receiving_progress', route => route.fulfill({
    json: { complete, items: items.map(item => ({
      ...item, received_quantity: complete ? item.ordered_quantity : item.received_quantity,
      remaining_quantity: complete ? 0 : item.quantity,
    })) },
  }));
  await page.route('**/rest/v1/rpc/open_purchase_inventory_receipt', route => {
    expect(route.request().postDataJSON()).toEqual({ p_purchase_order_id: '50' });
    return route.fulfill({ json: draft });
  });
  await page.route('**/rest/v1/rpc/delete_inventory_receipt_draft', route => {
    expect(route.request().postDataJSON()).toEqual({ p_id: draft.id, p_version: 2 });
    return route.fulfill({ status: 204 });
  });
  await page.route('**/rest/v1/rpc/get_inventory_receipts', route => route.fulfill({ json: [] }));
  await page.route('**/rest/v1/rpc/save_inventory_receipt', route => {
    const args = route.request().postDataJSON();
    expect(args.p_id).toBe(draft.id);
    expect(args.p_items).toEqual([{ variant_id: '101', quantity: '2', unit_cost_usd: 3.25, unit_weight_g: 250 }]);
    return route.fulfill({ json: {
      ...draft, version: 2, preview_ready: true, exchange_rate: 32, total_twd: 208,
      items: [{ ...items[0], quantity: 2, goods_twd: 208, payment_fee_twd: 0, customs_twd: 0,
        freight_twd: 0, total_twd: 208, unit_cost_twd: 104 }],
    } });
  });

  await page.goto('/admin');
  await page.locator('input[type="email"]').fill('receipt-admin@example.test');
  await page.locator('input[type="password"]').fill('local-test-password');
  await page.getByRole('button', { name: '進入後台' }).click();
  if ((page.viewportSize()?.width || 0) <= 900) await page.getByRole('button', { name: '開啟選單' }).click();
  await page.locator('.app-sidebar button:not(.sidebar-star)').filter({ hasText: /^叫貨管理$/ }).click();
  await page.getByRole('row').filter({ hasText: poNumber }).getByRole('button', { name: '查看' }).click();
  const progress = page.locator('details.procurement-receiving-progress');
  const summary = progress.locator('summary');
  await expect(progress.getByRole('table')).toBeHidden();
  await summary.click();
  const foam = progress.getByRole('row').filter({ hasText: 'FOAM-200' });
  await expect(foam.locator('td').nth(1)).toHaveText('5 件');
  await expect(foam.locator('td').nth(2)).toHaveText('2 件');
  await expect(foam.locator('td').nth(3)).toHaveText('3 件');
  await page.getByRole('button', { name: '建立入庫草稿' }).click();
  await expect(page.getByText('來源叫貨單 ' + poNumber)).toBeVisible();
  await expect(page.getByText('叫貨 5 · 已入庫 2 · 剩餘 3')).toBeVisible();
  await expect(page.getByLabel('FOAM-200 入庫數量')).toHaveValue('3');
  await expect(page.getByLabel('付款匯率（TWD／USD）')).toHaveValue('');
  await page.getByLabel('FOAM-200 入庫數量').fill('2');
  await page.getByRole('button', { name: '本次未到 LOTION-500' }).click();
  await expect(page.getByLabel('LOTION-500 入庫數量')).toHaveCount(0);
  await page.getByLabel('付款匯率（TWD／USD）').fill('32');
  await page.getByRole('button', { name: '儲存草稿並預覽' }).click();
  await expect(page.getByRole('heading', { name: '入庫成本預覽' })).toBeVisible();
  await expect(page.getByText('104.00', { exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '刪除草稿' }).click();
  await expect(page.getByRole('heading', { name: '入庫成本預覽' })).toBeVisible();
  page.once('dialog', async dialog => {
    expect(dialog.message()).toContain('入庫單 #8');
    await dialog.accept();
  });
  await page.getByRole('button', { name: '刪除草稿' }).click();
  await expect(page.getByRole('status').filter({ hasText: '已刪除入庫單草稿' })).toBeVisible();
  await expect(page.getByText('目前沒有入庫單。')).toBeVisible();
  complete = true;
  if ((page.viewportSize()?.width || 0) <= 900) await page.getByRole('button', { name: '開啟選單' }).click();
  await page.locator('.app-sidebar button:not(.sidebar-star)').filter({ hasText: /^叫貨管理$/ }).click();
  await page.getByRole('row').filter({ hasText: poNumber }).getByRole('button', { name: '查看' }).click();
  await expect(progress.getByText('已全部入庫')).toBeVisible();
  await expect(progress.getByRole('table')).toBeHidden();
  await summary.click();
  await expect(foam.locator('td').nth(3)).toHaveText('0 件');
  await expect(page.getByRole('button', { name: '建立入庫草稿' })).toBeDisabled();
});
