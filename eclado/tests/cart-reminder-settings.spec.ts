import { expect, test, type Page } from '@playwright/test';
import config from '../src/config/cartReminder.json';
import { mockEcladoApis } from './support/eclado-mocks';

async function openSettings(page:Page, permissions=['notifications.send'], hooks={}) {
  await mockEcladoApis(page,{authUser:{id:'cart-notice-admin',email:'admin@example.com',user_metadata:{name:'提醒設定管理員'},app_metadata:{provider:'email'},aud:'authenticated',role:'authenticated',created_at:'2026-05-01T00:00:00Z'},
    adminAccess:true,backofficeAccess:{role:'admin',permissions},...hooks});
  await page.goto('/admin');
  if ((page.viewportSize()?.width || 0)<=900) await page.getByRole('button',{name:'開啟選單'}).click();
  await page.locator('.app-sidebar button:not(.sidebar-star)').filter({hasText:'系統設定'}).first().click();
}

test('系統設定預設公版，可預覽、修改內容及儲存啟用狀態',async({page})=>{
  let saved:any;
  await openSettings(page,undefined,{onCartReminderSettingsSave:(body:any)=>{saved=body;}});
  const form=page.getByRole('form',{name:'購物車未結帳提醒'});
  const content=form.getByRole('textbox',{name:'購物車提醒通知內容'});
  await expect(content).toHaveValue(config.defaultContent);
  await expect(form.getByRole('switch')).not.toBeChecked();
  await form.getByText('預覽通知內容',{exact:true}).click();
  await expect(form.getByTestId('cart-reminder-preview')).toContainText(config.cartUrl);
  await expect(form.getByTestId('cart-reminder-preview')).not.toContainText(config.placeholder);
  const custom='您的商品還在購物車，歡迎回來選購。\n[購物車連結]';
  await content.fill(custom);
  await form.getByRole('switch').check();
  await form.getByRole('button',{name:'儲存購物車提醒設定'}).click();
  await expect(form.getByRole('status')).toHaveText('購物車未結帳提醒設定已儲存。');
  expect(saved).toEqual({p_enabled:true,p_content:custom,p_expected_version:0});
  await form.getByRole('button',{name:'恢復公版內容'}).click();
  await expect(content).toHaveValue(config.defaultContent);
});

test('缺少購物車連結不儲存；並行儲存衝突保留輸入',async({page})=>{
  let count=0;
  await openSettings(page,undefined,{onCartReminderSettingsSave:()=>count++});
  const form=page.getByRole('form',{name:'購物車未結帳提醒'});
  const content=form.getByRole('textbox');
  await content.fill('沒有返回連結');
  await form.getByRole('button',{name:'儲存購物車提醒設定'}).click();
  await expect(form.getByRole('alert')).toContainText('須保留');expect(count).toBe(0);
  await content.fill('尚未儲存的提醒 [購物車連結]');
  await page.route('**/rest/v1/rpc/save_cart_reminder_settings',route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:'設定已被其他管理員修改'})}));
  await form.getByRole('button',{name:'儲存購物車提醒設定'}).click();
  await expect(form.getByRole('alert')).toContainText('其他管理員');
  await expect(content).toHaveValue('尚未儲存的提醒 [購物車連結]');
});

test('只有會員定價權限不顯示通知設定',async({page})=>{
  await openSettings(page,['member_pricing.manage']);
  await expect(page.getByRole('heading',{name:'會員定價',exact:true})).toBeVisible();
  await expect(page.getByRole('form',{name:'購物車未結帳提醒'})).toHaveCount(0);
});
