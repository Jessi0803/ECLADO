import { expect, test, type Page } from '@playwright/test';
import { mockEcladoApis } from './support/eclado-mocks';
import { runRewardCheckoutDatabaseScenario } from './fixtures/instructor-reward-checkout-db.cjs';

test.skip(!process.env.PGLITE_MODULE, 'Requires an isolated SQL runtime; never use a live database');
let context: any, fixture: Promise<void>, closeFixture: () => void;
test.beforeAll(async () => {
  test.setTimeout(180000);
  const closed = new Promise<void>(resolve => { closeFixture = resolve; });
  await new Promise<void>((resolve, reject) => {
    fixture = runRewardCheckoutDatabaseScenario(async (ctx: any) => {
      await ctx.db.exec(ctx.read('supabase-checkout-order-idempotency.sql'));
      await ctx.db.exec('update public.student_pricing_feature_settings set enabled=true');
      await ctx.actor(ctx.student);
      const incomeItems = [{ product_id: 1, variant_id: 1, qty: 99 }];
      const income = await ctx.ordinaryCreate(incomeItems, await ctx.ordinaryQuote(incomeItems));
      await ctx.actor(ctx.admin);
      await ctx.db.query('select public.confirm_admin_instructor_reward_payment($1,true)', [income.order_id]);
      await ctx.status(income.order_id, 'delivered');
      await ctx.db.exec(ctx.fn('supabase-shopping-credit-foundation.sql', 'get_my_shopping_credit'));
      context = ctx;
      try { resolve(); await closed; } catch (error) { reject(error); throw error; }
    }).catch(reject);
  });
});
test.afterAll(async () => { closeFixture?.(); await fixture; });

async function fillCheckout(page: Page) {
  await page.locator('#checkout-name').fill('回應遺失測試');
  await page.locator('#checkout-phone').fill('0912345678');
  await page.locator('#checkout-email').fill('lost-response@example.test');
  await page.getByPlaceholder('縣市').fill('台北市');
  await page.getByPlaceholder('區域').fill('大安區');
  await page.getByPlaceholder('路/街/巷/弄/號/樓').fill('隔離測試路1號');
  await page.getByRole('button', { name: '繼續確認付款', exact: true }).click();
  await page.getByRole('button', { name: /^信用卡/ }).click();
}

for (const identity of ['guest', 'member', 'wallet'] as const) for (const action of ['retry', 'reload'] as const) {
  test(`SQL commit 後丟棄回應：${identity} ${action} 仍只有原訂單`, async ({ page }) => {
    const { db, actor, one, teacher } = context;
    await db.exec("update public.student_pricing_feature_settings set enabled=false; update public.promotions set active=false; update public.product_variants set price=1000,pro_price=1000,stock=10000");
    const wallet = identity === 'wallet', member = identity !== 'guest';
    await db.query('update public.profiles set role=$1 where id=$2', [wallet ? 'instructor' : 'consumer', teacher]);
    if (wallet) await db.exec("update public.promotions set active=true where id in ('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003'); update public.product_variants set gift_stock=100,gift_enabled=true where id=1");
    await actor(member ? teacher : null);
    const financial = () => one(`select
      (select to_jsonb(a) from public.shopping_credit_accounts a where user_id=$1) shopping,
      (select to_jsonb(a) from public.instructor_reward_accounts a where user_id=$1) reward,
      (select count(*)::int from public.coupon_redemptions) coupons,
      (select count(*)::int from public.promotion_gift_reservations) gifts`, [teacher]);
    const baseline = Number((await one('select count(*) n from public.orders')).n);
    let loseFirstResponse = true;
    const committed: any[] = [], bankRequests: any[] = [];
    await page.context().route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
      ? route.continue() : route.abort('blockedbyclient'));
    const user = { id: teacher, email: 'lost-response@example.test', user_metadata: { name: '回應遺失測試' },
      app_metadata: { provider: 'email' }, aud: 'authenticated', role: 'authenticated', created_at: '2026-05-01' };
    await mockEcladoApis(page, {
      ...(member ? { authUser: user, profiles: [{ id: teacher, email: user.email, role: wallet ? 'instructor' : 'consumer' }], memberCartItems: [{ id: 1, variantId: '1', qty: 10 }] } : {}),
      products: [{ id: 1, name_zh: '隔離測試商品', price: 1000, pro_price: 1000, stock: 10000, active: true }],
      productVariants: [{ id: 1, product_id: 1, price: 1000, pro_price: 1000, stock: 10000, active: true, is_default: true, size: '100ml' }],
      promotions: [], onPaymentRequest: body => bankRequests.push(body),
    });
    if (identity === 'guest') await page.addInitScript(() => {
      if (!sessionStorage.getItem('r09-seeded')) {
        localStorage.setItem('eclado_cart_v1', JSON.stringify([{ id: 1, variantId: '1', qty: 10 }]));
        sessionStorage.setItem('r09-seeded', '1');
      }
    });
    await page.route('**/rest/v1/rpc/quote_order_pricing', async route => {
      const a = route.request().postDataJSON();
      const q = (await one('select public.quote_order_pricing($1::jsonb,$2,$3,$4) q', [JSON.stringify(a.p_items), a.p_fulfillment_method, a.p_coupon_code || '', a.p_guest_email || ''])).q;
      await route.fulfill({ json: q });
    });
    for (const kind of ['pricing', 'wallets']) await page.route(`**/rest/v1/rpc/create_order_with_${kind}`, async route => {
      const a = route.request().postDataJSON();
      const names = ['p_items','p_member','p_address','p_phone','p_email','p_note','p_payment_method','p_fulfillment_method','p_coupon_code','p_invoice_type','p_invoice_company_name','p_invoice_tax_id','p_shopping_credit_amount',
        ...(kind === 'wallets' ? ['p_reward_credit_amount'] : []), 'p_expected_quote','p_request_key','p_request_secret','p_expected_user_id'];
      const types: Record<string,string> = {p_items:'jsonb',p_expected_quote:'jsonb',p_shopping_credit_amount:'bigint',p_reward_credit_amount:'bigint',p_request_key:'uuid',p_expected_user_id:'uuid'};
      const values = names.map(n => types[n] === 'jsonb' ? JSON.stringify(a[n]) : a[n] ?? null);
      // Autocommit finishes before response abort; this is not a simulated DB success.
      const result = (await one(`select public.create_order_with_${kind}(${names.map((n,i) => `$${i+1}::${types[n] || 'text'}`).join(',')}) q`, values)).q;
      committed.push(result);
      if (loseFirstResponse) { loseFirstResponse = false; await route.abort('failed'); }
      else await route.fulfill({ json: result });
    });
    if (wallet) {
      for (const name of ['get_my_reward_credit','get_my_shopping_credit']) await page.route(`**/rest/v1/rpc/${name}`, async route => route.fulfill({json:(await one(`select public.${name}() q`)).q}));
      await page.route('**/rest/v1/rpc/quote_order_with_wallets', async route => {
        const a = route.request().postDataJSON();
        await route.fulfill({json:(await one('select public.quote_order_with_wallets($1::jsonb,$2,$3,$4,$5::bigint,$6::bigint) q',
          [JSON.stringify(a.p_items),a.p_fulfillment_method,a.p_coupon_code || '',a.p_guest_email || '',a.p_shopping_credit_amount,a.p_reward_credit_amount])).q});
      });
    }
    await page.route('**/rest/v1/rpc/recover_checkout_order', async route => {
      const a = route.request().postDataJSON();
      await route.fulfill({ json: (await one('select public.recover_checkout_order($1::uuid,$2::text) q', [a.p_request_key, a.p_request_secret])).q });
    });
    try {
      await page.goto('/checkout');
      await fillCheckout(page);
      if (wallet) {
        await page.getByPlaceholder('輸入優惠碼').fill('ONLY');
        await page.getByRole('button', { name: '套用', exact: true }).click();
        await expect(page.getByText(/已套用/)).toBeVisible();
        await page.getByRole('switch', { name: '使用購物金', exact: true }).click();
        await page.getByLabel('購物金使用金額').fill('100');
        await page.getByRole('switch', { name: '使用返饋金', exact: true }).click();
        await page.getByLabel('返饋金使用金額').fill('300');
      }
      await page.getByRole('button', { name: '確認訂單', exact: true }).click();
      await expect.poll(() => committed.length).toBe(1);
      expect(Number((await one('select count(*) n from public.orders')).n)).toBe(baseline + 1);
      expect(bankRequests).toHaveLength(0);
      const reserved = await financial();
      await expect(page.getByText('目前無法繼續付款，請稍後再試，或聯繫客服協助。', { exact: true })).toBeVisible();
      if (action === 'reload') {
        await page.reload();
        await expect.poll(async () => await page.getByRole('heading', { name: '請完成付款' }).isVisible()
          || await page.getByRole('button', { name: '繼續確認付款', exact: true }).and(page.locator(':enabled')).count() > 0).toBe(true);
        if (!await page.getByRole('heading', { name: '請完成付款' }).isVisible()) await fillCheckout(page);
      }
      if (!await page.getByRole('heading', { name: '請完成付款' }).isVisible()) {
        const recover = page.getByRole('button', { name: '重新確認訂單狀態', exact: true });
        if (await recover.isVisible()) await recover.click();
        else await page.getByRole('button', { name: '確認訂單', exact: true }).click();
      }
      await expect(page.getByRole('heading', { name: '請完成付款' })).toBeVisible();
      expect(Number((await one('select count(*) n from public.orders')).n)).toBe(baseline + 1);
      expect(new Set(committed.map(o => o.order_id)).size).toBe(1);
      expect(bankRequests).toHaveLength(1);
      expect(bankRequests[0].orderNo).toBe(committed[0].order_id);
      if (wallet) {
        expect(committed[0]).toMatchObject({shopping_credit_amount:100,reward_credit_amount:300});
        expect(bankRequests[0].amount).toBe(Number(committed[0].payment_amount));
        expect(await financial()).toEqual(reserved);
        expect(Number((await one('select count(*) n from public.coupon_redemptions where order_id=$1',[committed[0].order_id])).n)).toBe(1);
        expect(Number((await one('select count(*) n from public.promotion_gift_reservations where order_id=$1',[committed[0].order_id])).n)).toBeGreaterThan(0);
      }
    } finally {
      for (const id of new Set(committed.map(o => o.order_id))) await db.query("update public.orders set status='cancelled' where id=$1", [id]);
    }
  });
}
