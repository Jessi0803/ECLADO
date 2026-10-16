import {test,expect} from '@playwright/test';
import {mockEcladoApis,adminProfileRows} from './support/eclado-mocks';
const user={id:'wallet-teacher',email:'wallet@example.test',user_metadata:{name:'老師'},app_metadata:{provider:'email'},aud:'authenticated',role:'authenticated',created_at:'2026-05-01'};
test('雙錢包訂單從會員中心恢復及重新載入時保留返饋金與銀行應付額', async ({ page }) => {
  await mockEcladoApis(page, {
    authUser: user, profiles: [{...adminProfileRows[0],id:user.id,email:user.email,role:'instructor'}],
    paymentQueryStatus: 'pending',
    orders: [{
      id: 'ECL-CREDIT-RETURN-001', user_id: user.id, member: 'E2E 會員',
      items: [{ name: '積雪草泥膜', qty: 8, price: 756 }],
      subtotal: 6048, discount: 0, shipping: 120, total: 6168,
      shopping_credit_amount: 300, reward_credit_amount: 200, payment_amount: 5668,
      status: 'awaiting_confirm', payment_method: 'atm',
      payment_due_at: '2099-01-01T00:00:00.000Z', created_at: '2026-10-13T00:00:00.000Z',
    }],
  });
  await page.goto('/');
  // Reproduce a payment record written by the old client that lost its tender fields.
  await page.evaluate(() => sessionStorage.setItem('eclado_pending_payment', JSON.stringify({
    version: 2, orderNo: 'ECL-CREDIT-RETURN-001', accessType: 'member', amount: 6168,
    method: 'atm', summary: { subtotal: 6048, discount: 0, shipping: 120, total: 6168, items: [] },
  })));
  await page.goto('/account');
  await expect(page.getByText('訂單總額 NT$ 6,168')).toBeVisible();
  await expect(page.getByText('購物金折抵 −NT$ 300')).toBeVisible();
  await expect(page.getByText('尚需付款 NT$ 5,668')).toBeVisible();
  await expect(page.getByText('返饋金折抵 −NT$ 200')).toBeVisible();
  await page.getByRole('button', { name: '查看付款資訊' }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByText('購物金支付', { exact: true })).toBeVisible();
  await expect(page.getByText('−NT$ 300', { exact: true })).toBeVisible();
  await expect(page.getByText('NT$ 5,668', { exact: true }).first()).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('eclado_pending_payment') || 'null'));
  expect(saved).toMatchObject({
    amount: 5668, summary: { total: 6168, shoppingCreditAmount: 300, rewardCreditAmount: 200, paymentTotal: 5668 },
  });
  await page.reload();
  await expect(page.getByText('購物金支付', { exact: true })).toBeVisible();
  await expect(page.getByText('NT$ 5,668', { exact: true }).first()).toBeVisible();
});
