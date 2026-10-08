import { expect, test, type Page } from '@playwright/test';
import { mockEcladoApis, adminProductRows, adminProfileRows } from './support/eclado-mocks';

const user = { id:'admin-pricing', email:'ecladotaiwan@gmail.com', user_metadata:{ name:'管理員' }, app_metadata:{provider:'email'}, aud:'authenticated', role:'authenticated', created_at:'2026-05-01T00:00:00Z' };
const defaults = { instructor:0.7, distributor:0.65, staff:0.5 };
async function setup(page: Page, permission = true) {
  await mockEcladoApis(page, { authUser:user, profiles:adminProfileRows, products:adminProductRows, backofficeAccess:{ role:permission ? 'admin' : 'catalog_editor', permissions:['catalog.read','catalog.write', ...(permission ? ['orders.read','member_pricing.manage'] : [])] } });
  await page.route('**/rest/v1/rpc/get_admin_member_pricing', route => route.fulfill({ json:{ multipliers:defaults } }));
  await page.route('**/rest/v1/rpc/get_admin_catalog', route => route.fulfill({ json:{
    member_pricing_version:1, pricing_defaults:defaults,
    products:adminProductRows.map(product => ({ ...product, instructor_price_multiplier:0.88, distributor_price_multiplier:null, staff_price_multiplier:1, pricing_defaults:defaults })),
    variants:[], images:[],
  } }));
}
async function open(page: Page, name: string) {
  if ((page.viewportSize()?.width || 0) <= 900) await page.getByRole('button', { name:'開啟選單' }).click();
  await page.locator('.app-sidebar button:not(.sidebar-star)').filter({ hasText:name }).first().click();
}

test('全域設定確認後送出三身份倍率與原版本，不修改會員身份', async ({ page }) => {
  await setup(page);
  let payload: any;
  await page.route('**/rest/v1/rpc/save_member_pricing', async route => {
    payload = route.request().postDataJSON();
    await route.fulfill({ json:{ multipliers:payload.p_multipliers } });
  });
  await page.goto('/admin'); await open(page, '系統設定');
  await expect(page.getByLabel('師資預設折數')).toHaveValue('7');
  await page.getByLabel('師資預設折數').fill('8.8');
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('7 折 → 8.8 折'); await dialog.accept(); });
  await page.getByRole('button', { name:'儲存全域折數' }).click();
  await expect(page.getByRole('status')).toHaveText('會員全域折數已儲存。');
  expect(payload).toEqual({ p_multipliers:{ ...defaults, instructor:0.88 }, p_expected_multipliers:defaults });
});

test('取消確認不寫入、版本衝突保留輸入並要求重新載入', async ({ page }) => {
  await setup(page);
  let writes = 0;
  await page.route('**/rest/v1/rpc/save_member_pricing', async route => { writes++; await route.fulfill({ status:400, json:{ code:'40001', message:'Pricing settings changed; reload before saving' } }); });
  await page.goto('/admin'); await open(page, '系統設定');
  await page.getByLabel('內部人員預設折數').fill('6');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name:'儲存全域折數' }).click();
  expect(writes).toBe(0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name:'儲存全域折數' }).click();
  await expect(page.getByRole('alert')).toContainText('重新載入');
  await expect(page.getByLabel('內部人員預設折數')).toHaveValue('6');
  expect(writes).toBe(1);
});

test('商品編輯移除舊勾選，三身份個別折數與全域提示共用所有規格', async ({ page }) => {
  await setup(page);
  await page.goto('/admin'); await open(page, '商品 & 庫存');
  await page.getByRole('button', { name:'編輯', exact:true }).first().click();
  const panel = page.getByRole('dialog', { name:'編輯商品' });
  await expect(panel.getByLabel('師資／經銷商套用身分倍率')).toHaveCount(0);
  await expect(panel.getByLabel('師資商品折數')).toHaveValue('8.8');
  await expect(panel.getByLabel('經銷商商品折數')).toHaveValue('');
  await expect(panel.getByLabel('內部人員商品折數')).toHaveValue('10');
  await expect(panel.getByLabel('經銷商商品折數')).toHaveAttribute('placeholder', '沿用全域 6.5 折');
});

test('商品小編沒有全域設定入口', async ({ page }) => {
  await setup(page, false); await page.goto('/admin');
  await expect(page.locator('.app-sidebar').getByText('系統設定', { exact:true })).toHaveCount(0);
});

test('師資商品卡及規格切換使用商品88折，而非全域70折', async ({ page }) => {
  const profile = { ...adminProfileRows[0], id:user.id, email:user.email, role:'instructor' };
  const product = { ...adminProductRows[0], instructor_price_multiplier:0.88, distributor_price_multiplier:null, staff_price_multiplier:null, pricing_defaults:defaults };
  await mockEcladoApis(page, { authUser:user, profiles:[profile], products:[product], productVariants:[
    { id:101,product_id:product.id,sku:'A',size:'100ml',price:2000,pro_price:1000,stock:10,is_default:true,sort_order:0,active:true },
    { id:102,product_id:product.id,sku:'B',size:'200ml',price:4000,pro_price:2000,stock:10,is_default:false,sort_order:1,active:true },
  ] });
  await page.goto('/shop');
  await expect(page.getByText('師資價・專業價8.8折').first()).toBeVisible();
  await expect(page.getByText('NT$ 880', { exact:true }).first()).toBeVisible();
  await page.getByText(product.name_zh).first().click();
  await page.getByRole('button', { name:/200ml/ }).click();
  await expect(page.getByText('NT$ 1,760', { exact:true }).first()).toBeVisible();
});

test('SQL未部署：全域設定失敗時不允許以預設假值儲存', async ({ page }) => {
  await setup(page);
  await page.route('**/rest/v1/rpc/get_admin_member_pricing', route => route.fulfill({status:404,json:{code:'PGRST202',message:'RPC not found'}}));
  await page.goto('/admin'); await open(page,'系統設定');
  await expect(page.getByRole('alert')).toContainText('supabase-member-pricing.sql');
  await expect(page.getByRole('button',{name:'儲存全域折數'})).toBeDisabled();
});
