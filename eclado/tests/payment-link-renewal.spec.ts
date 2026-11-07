import { expect, test } from '@playwright/test';
import { mockEcladoApis } from './support/eclado-mocks';

test('到期的行動支付連結可在原訂單繼續付款，文案說明訂單仍保留', async ({ page }, testInfo) => {
  let orderWrites = 0;
  let paymentCreates = 0;
  let retryBody: Record<string, unknown> | undefined;
  await mockEcladoApis(page, {
    onOrderPricingRequest: () => { orderWrites++; },
    onPaymentRequest: () => { paymentCreates++; },
  });
  const due = new Date(Date.now() + 48 * 3600000).toISOString();
  await page.addInitScript(({ due }) => {
    sessionStorage.setItem('eclado_pending_payment', JSON.stringify({
      orderNo:'ECL-LINK-RENEWAL', paymentToken:'fake-payment-token', method:'apple', methodLabel:'Apple Pay',
      paymentLink:'https://sandbox.sinopac.test/old', amount:900,
      paymentDueAt:due, linkExpiresAt:new Date(Date.now() - 60000).toISOString(),
      summary:{subtotal:1000,discount:0,shipping:0,total:1000,finalSubtotal:1000,shoppingCreditAmount:100,paymentTotal:900,items:[]},
    }));
  }, { due });
  await page.route('https://pay.ecladotaiwan.com/api/sinopac/query-payment', route => route.fulfill({json:{
    ok:true, paymentState:'link_expired', order:{id:'ECL-LINK-RENEWAL', status:'unpaid',total:1000,
      shopping_credit_amount:100,payment_amount:900,payment_due_at:due},
    response:{Status:'S',OrderList:[{OrderNo:'ECL-LINK-RENEWAL',PayStatus:'1M250'}]},
  }}));
  await page.route('https://pay.ecladotaiwan.com/api/sinopac/retry-payment', route => {
    retryBody = route.request().postDataJSON();
    return route.fulfill({json:{ok:true,paymentLink:'https://sandbox.sinopac.test/renewed',
      resultAccessToken:'fake-new-access',linkExpiresAt:new Date(Date.now()+600000).toISOString(),
      response:{Status:'S'},order:{id:'ECL-LINK-RENEWAL',payment_due_at:due,payment_amount:900}}});
  });
  await page.route('https://sandbox.sinopac.test/renewed', route => route.fulfill({
    contentType:'text/html; charset=utf-8',body:'<h1>模擬付款頁</h1>',
  }));
  await page.goto('/checkout');
  await expect(page.getByRole('heading', {name:'付款連結已到期'})).toBeVisible();
  await expect(page.getByText(/訂單仍為你保留至原付款期限/)).toBeVisible();
  await expect(page.getByText('訂單保留至',{exact:true})).toBeVisible();
  await expect(page.getByText(/undefined/)).toHaveCount(0);
  await expect(page.getByRole('button', {name:'複製付款連結'})).toHaveCount(0);
  await page.screenshot({path:`/tmp/eclado-link-renewal-${testInfo.project.name}.png`,fullPage:true});
  await page.getByRole('button', {name:'繼續付款',exact:true}).click();
  await expect(page.getByRole('heading', {name:'模擬付款頁'})).toBeVisible();
  expect(retryBody).toMatchObject({orderNo:'ECL-LINK-RENEWAL',paymentToken:'fake-payment-token'});
  expect(orderWrites).toBe(0);
  expect(paymentCreates).toBe(0);
});

test('銀行尚在確認時保留原訂單，連續點擊只確認一次', async ({ page }) => {
  await mockEcladoApis(page);
  let retryCalls = 0;
  await page.addInitScript(() => {
    sessionStorage.setItem('eclado_pending_payment', JSON.stringify({
      orderNo:'ECL-CONFIRMING',paymentToken:'fake-payment-token',method:'google',methodLabel:'Google Pay',
      amount:900,paymentLink:'https://sandbox.sinopac.test/old',paymentDueAt:'2099-01-01T00:00:00Z',
    }));
  });
  await page.route('https://pay.ecladotaiwan.com/api/sinopac/query-payment', route => route.fulfill({json:{
    ok:true,paymentState:'link_expired',response:{},order:{id:'ECL-CONFIRMING',status:'unpaid',total:900,payment_due_at:'2099-01-01T00:00:00Z'},
  }}));
  await page.route('https://pay.ecladotaiwan.com/api/sinopac/retry-payment', async route => {
    retryCalls++;
    await new Promise(resolve => setTimeout(resolve, 150));
    await route.fulfill({status:409,json:{ok:false,error:'正在確認付款狀態，請稍後再試；原訂單會為你保留。'}});
  });
  await page.goto('/checkout');
  const button = page.getByRole('button',{name:'繼續付款',exact:true});
  await expect(button).toBeVisible();
  await button.evaluate((element: HTMLButtonElement) => { element.click(); element.click(); });
  await expect(page.getByRole('alert')).toContainText('原訂單會為你保留');
  await expect(button).toBeEnabled();
  expect(retryCalls).toBe(1);
  await expect(page).toHaveURL(/\/checkout$/);
  const payment = await page.evaluate(() => JSON.parse(sessionStorage.getItem('eclado_pending_payment') || 'null'));
  expect(payment.orderNo).toBe('ECL-CONFIRMING');
});

test('建單連線中斷後查證並續付，全程沿用已建立的訂單', async ({ page }) => {
  let orderWrites = 0;
  let creates = 0;
  let originalOrderNo = '';
  let renewedOrderNo = '';
  await mockEcladoApis(page, {
    paymentError:'正在確認付款狀態，請稍後查看原訂單。',
    onOrderPricingRequest: () => { orderWrites++; },
    onPaymentRequest: request => { creates++; originalOrderNo = String(request.orderNo); },
  });
  await page.route('https://pay.ecladotaiwan.com/api/sinopac/query-payment', route => route.fulfill({json:{
    ok:true,paymentState:'link_expired',response:{Status:'S',OrderList:[{PayStatus:'1M250'}]},
    order:{id:originalOrderNo,status:'unpaid',payment_due_at:new Date(Date.now()+48*3600000).toISOString()},
  }}));
  await page.route('https://pay.ecladotaiwan.com/api/sinopac/retry-payment', route => {
    renewedOrderNo = route.request().postDataJSON().orderNo;
    return route.fulfill({json:{ok:true,paymentLink:'https://sandbox.sinopac.test/reconciled',resultAccessToken:'fake-new-token'}});
  });
  await page.route('https://sandbox.sinopac.test/reconciled', route => route.fulfill({
    contentType:'text/html; charset=utf-8',body:'<h1>模擬續付頁</h1>',
  }));
  await page.goto('/shop');
  await page.getByText('胜肽修護精華液').first().click();
  await page.getByRole('button',{name:/加入購物車/}).click();
  await page.locator('nav').getByRole('button',{name:/^購物車/}).click();
  await page.getByRole('dialog',{name:'購物車'}).getByRole('button',{name:/前往結帳/}).click();
  const guestCheckout = page.getByRole('button',{name:/訪客結帳/});
  if (await guestCheckout.isVisible()) await guestCheckout.click();
  await page.getByLabel('收件人姓名（請填寫證件上的姓名）').fill('續付測試');
  await page.getByLabel('手機號碼').fill('0912345678');
  await page.getByLabel('電子信箱').fill('renewal@example.test');
  await page.getByPlaceholder('縣市').fill('台北市');
  await page.getByPlaceholder('區域').fill('大安區');
  await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('測試路 1 號');
  await page.getByRole('button',{name:/繼續確認付款/}).click();
  await page.getByRole('button',{name:/Apple Pay/}).click();
  await page.getByRole('button',{name:/確認訂單/}).click();
  await expect(page.getByRole('heading',{name:'付款狀態待確認'})).toBeVisible();
  const stored = await page.evaluate(() => JSON.parse(sessionStorage.getItem('eclado_pending_payment') || 'null'));
  expect(stored.orderNo).toBe(originalOrderNo);
  await page.getByRole('button',{name:'重新查詢付款狀態'}).click();
  await expect(page.getByRole('heading',{name:'付款連結已到期'})).toBeVisible();
  await page.getByRole('button',{name:'繼續付款',exact:true}).click();
  await expect(page.getByRole('heading',{name:'模擬續付頁'})).toBeVisible();
  expect(renewedOrderNo).toBe(originalOrderNo);
  expect(orderWrites).toBe(1);
  expect(creates).toBe(1);
});
