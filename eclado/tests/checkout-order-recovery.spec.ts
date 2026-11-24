import { expect, test } from '@playwright/test';
import { mockEcladoApis } from './support/eclado-mocks';

for (const failure of ['missing-migration', 'blocked-storage', 'request-not-received', 'recovery-unavailable'] as const) {
  test(`建單恢復防護：${failure}`, async ({ page }) => {
    const orders: any[] = [], bank: any[] = [], calls: any[] = [];
    await page.context().route('**/*', route => ['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)
      ? route.continue() : route.abort('blockedbyclient'));
    await mockEcladoApis(page, { promotions: [], onOrderInsert: order => orders.push(order), onPaymentRequest: body => bank.push(body) });
    await page.addInitScript(blocked => {
      localStorage.setItem('eclado_cart_v1', JSON.stringify([{ id: 2, qty: 1 }]));
      if (blocked) {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key.startsWith('eclado_order_request_v1:')) throw new DOMException('Blocked', 'SecurityError');
          return original.call(this, key, value);
        };
      }
    }, failure === 'blocked-storage');
    await page.route('**/rest/v1/rpc/create_order_with_pricing', async route => {
      calls.push(route.request().postDataJSON());
      if (failure === 'missing-migration') return route.fulfill({ status:404, json:{ code:'PGRST202', message:'Missing protected creator' } });
      if (calls.length === 1) return route.abort('failed');
      return route.fallback();
    });
    await page.route('**/rest/v1/rpc/recover_checkout_order', route => failure === 'recovery-unavailable'
      ? route.fulfill({ status:503, json:{ message:'Unavailable' } }) : route.fulfill({ json:null }));
    await page.goto('/checkout');
    await page.locator('#checkout-name').fill('恢復防護測試');
    await page.locator('#checkout-phone').fill('0912345678');
    await page.locator('#checkout-email').fill('recovery@example.test');
    await page.getByPlaceholder('縣市').fill('台北市');
    await page.getByPlaceholder('區域').fill('大安區');
    await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('隔離測試路1號');
    await page.getByRole('button', { name:'繼續確認付款', exact:true }).click();
    const submit = page.getByRole('button', { name:'確認訂單', exact:true });
    await submit.click();
    await expect(page.getByText(failure === 'blocked-storage'
      ? '瀏覽器無法保存訂單恢復資訊，請開啟儲存空間後再試。'
      : '目前無法繼續付款，請稍後再試，或聯繫客服協助。', { exact:true })).toBeVisible();
    expect(orders).toHaveLength(0); expect(bank).toHaveLength(0);
    if (failure === 'blocked-storage') { expect(calls).toHaveLength(0); return; }
    expect(calls).toHaveLength(1);
    expect(calls[0].p_request_key).toBeTruthy();
    if (failure === 'missing-migration') return; // No fallback to the unsafe overload.
    await expect(submit).toBeDisabled();
    const recover = page.getByRole('button', { name:'重新確認訂單狀態', exact:true });
    await recover.click();
    if (failure === 'recovery-unavailable') {
      await expect(recover).toBeEnabled();
      await expect(submit).toBeDisabled();
      expect(calls).toHaveLength(1); expect(orders).toHaveLength(0); expect(bank).toHaveLength(0);
    } else {
      await expect(submit).toBeEnabled();
      await submit.click();
      await expect(page.getByRole('heading', { name:'請完成付款' })).toBeVisible();
      expect(calls).toHaveLength(2);
      expect(calls[1].p_request_key).toBe(calls[0].p_request_key);
      expect(calls[1].p_request_secret).toBe(calls[0].p_request_secret);
      expect(orders).toHaveLength(1); expect(bank).toHaveLength(1);
    }
  });
}

for (const state of ['paid', 'cancelled', 'gateway-created'] as const) {
  test(`查回原訂單為 ${state} 時不重新建立金流`, async ({ page }) => {
    const created: any[] = [], queried: any[] = [];
    await mockEcladoApis(page, { promotions: [], onPaymentRequest: body => created.push(body) });
    await page.context().route('**/*', route => ['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)
      ? route.continue() : route.abort('blockedbyclient'));
    await page.addInitScript(() => sessionStorage.setItem('eclado_order_request_v1:guest', JSON.stringify({
      owner:'guest', key:'11111111-1111-4111-8111-111111111111', secret:'a'.repeat(64),
    })));
    await page.route('**/rest/v1/rpc/recover_checkout_order', route => route.fulfill({ json:{
      order_id:'ECL-RECOVERED', payment_token:'mock-only', payment_method:'card', total:4100, payment_amount:4100,
      subtotal:3980, shipping:120, discount:0, items:[{product_id:2,qty:1,unit_price:3980,line_total:3980}],
      payment_due_at:'2099-01-01T00:00:00Z', recovered_order_state:state === 'gateway-created' ? 'unpaid' : state,
      gateway_created:state === 'gateway-created',
    } }));
    await page.route('**/api/sinopac/query-payment', route => {
      queried.push(route.request().postDataJSON());
      return route.fulfill({json:{ok:true,paymentState:'pending',response:{Status:'S',PayURL:'https://bank.example.test/original'}}});
    });
    await page.goto('/checkout');
    await expect(page.getByRole('heading', { name: state === 'paid' ? '付款成功' : state === 'cancelled' ? '訂單已取消' : '請完成付款', exact:true })).toBeVisible();
    expect(created).toHaveLength(0);
    expect(queried).toHaveLength(state === 'gateway-created' ? 1 : 0);
  });
}
