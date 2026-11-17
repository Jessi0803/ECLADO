const { isAmbiguousGatewayFailure } = require('./assisted-orders');
const PROVIDER_ORDER = /^CRS[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const methods = {
  atm: { payType: 'A', capture: '1A400', field: 'ATMParam', link: 'WebAtmURL' },
  card: { payType: 'C', capture: '1C400', field: 'CardParam', link: 'CardPayURL' },
  apple: { payType: 'M', choosePay: 'A', capture: '1M400', field: 'MobileParam', link: 'MobilePayURL' },
  google: { payType: 'M', choosePay: 'G', capture: '1M400', field: 'MobileParam', link: 'MobilePayURL' },
};

function mountCoursePaymentRoutes(app, deps) {
  const {
    storefrontOrigin = 'https://ecladotaiwan.com',
    rpc, authenticate, rateLimit, buildCreateBody, callOrderApi, requireCreatedPayment,
    resolvePayment, requireBankPaymentAmount, requirePaymentOrderHints, formatSinopacDeadline,
  } = deps;

  async function reconcile(payment) {
    if (!PROVIDER_ORDER.test(payment.orderNo)) throw new Error('Not a course payment');
    const target = await rpc('get_course_payment_target', { p_provider_order_no: payment.orderNo });
    if (!target) throw new Error('Unknown course payment');
    const method = methods[target.payment_method];
    if (!method || payment.payType !== method.payType) throw new Error('Course payment type mismatch');
    const detail = payment.raw?.payQuery?.TSResultContent;
    const capture = payment.payStatus === method.capture || payment.payFlag === method.capture
      || (detail?.Status === 'S' && (method.payType === 'C' && detail.APType === 'CaptureOut'
        || method.payType === 'M' && ['PayOut', 'CaptureOut'].includes(detail.APType)));
    if (!capture) return { target };
    requireBankPaymentAmount({ ...payment, paid: true }, target);
    const summary = await rpc('confirm_course_payment', {
      p_provider_order_no: payment.orderNo,
      p_amount_cents: Number(payment.raw.orderQuery.OrderList[0].Amount),
      p_transaction_no: payment.tsNo,
    });
    return { target, summary };
  }

  for (const action of ['start', 'status']) {
    app.post(`/api/courses/payment/${action}`, async (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (!UUID.test(req.body?.orderId || '')) return res.status(400).json({ error: '課程訂單編號有誤' });
      const requested = req.body?.paymentMethod ?? 'card';
      if (action === 'start' && (typeof requested !== 'string' || !Object.hasOwn(methods, requested))) {
        return res.status(400).json({ error: '請選擇有效的付款方式' });
      }
      try {
        if (!await rateLimit(req, res, `course-payment:${action}`, action === 'start' ? 20 : 45)) return;
        const user = await authenticate(req).catch(() => null);
        if (!user) return res.status(401).json({ error: '請先登入會員' });
        const claim = await rpc('claim_course_payment', {
          p_order_id: req.body.orderId, p_payer_id: user.id, p_create: action === 'start', p_method: action === 'start' ? requested : 'card',
        });
        if (!claim) return res.status(404).json({ error: '找不到此課程訂單' });

        if (claim.method_unavailable) {
          return res.status(409).json({ error: '虛擬帳號匯款單筆上限為 NT$ 30,000，請選擇其他付款方式。' });
        }
        if (action === 'status') {
          if (claim.provider_order_no && ['pending', 'expired'].includes(claim.summary.status)) {
            const payment = await resolvePayment({ OrderNo: claim.provider_order_no });
            const result = await reconcile(payment);
            return res.json({ order: result.summary || claim.summary });
          }
          return res.json({ order: claim.summary });
        }
        if (claim.payment_url) return res.json({
          paymentLink: claim.payment_url, paymentMethod: claim.payment_method,
          atmAccount: claim.summary.atm_account, atmDueAt: claim.summary.atm_due_at,
        });
        if (!claim.create_attempt) return res.status(409).json({ error: '目前無法開啟付款頁，請查看原訂單付款狀態' });

        const origin = process.env.PAYMENT_PUBLIC_URL || 'https://pay.ecladotaiwan.com';
        const method = methods[claim.payment_method];
        const deadline = method.payType === 'A' ? formatSinopacDeadline(claim.link_expires_at) : {};
        const inner = buildCreateBody({
          orderNo: claim.provider_order_no,
          amount: claim.summary.total_twd,
          payType: method.payType,
          choosePay: method.choosePay,
          ...deadline,
          expMinutes: claim.minutes,
          returnUrl: new URL('/courses/payment-return', origin).href,
        });
        inner.BackendURL = new URL('/api/courses/payment-notify', origin).href;
        inner.PrdtName = 'ECLADO專業課程';
        const { data } = await callOrderApi('OrderCreate', inner);
        if (data?.Status === 'F' && !isAmbiguousGatewayFailure(data)) {
          await rpc('fail_course_payment_creation', { p_provider_order_no: claim.provider_order_no });
          return res.status(409).json({ error: '銀行未建立付款單，請重新載入後再報名' });
        }
        requireCreatedPayment(data, inner);
        const paymentLink = new URL(data[method.field][method.link]);
        if (paymentLink.protocol !== 'https:' || paymentLink.username || paymentLink.password) {
          throw new Error('Invalid course payment link');
        }
        const atmAccount = method.payType === 'A' ? String(data.ATMParam.AtmPayNo) : null;
        await rpc('store_course_payment_link', {
          p_provider_order_no: claim.provider_order_no, p_payment_url: paymentLink.href, p_transaction_no: data.TSNo, p_atm_account: atmAccount,
        });
        return res.json({
          paymentLink: paymentLink.href, paymentMethod: claim.payment_method,
          atmAccount, atmDueAt: atmAccount ? claim.link_expires_at : null,
        });
      } catch {
        return res.status(503).json({ error: '暫時無法確認課程付款，請稍後查看原訂單' });
      }
    });
  }

  async function returnToCourse(req, res) {
    res.set('Cache-Control', 'no-store');
    const targetUrl = new URL('/courses', storefrontOrigin);
    try {
      const payment = await resolvePayment({ ...req.query, ...req.body }, { requirePayTokenOrder: true });
      requirePaymentOrderHints([req.query, req.body], payment.orderNo, payment.orderNo);
      const result = await reconcile(payment);
      targetUrl.pathname = `/courses/${result.target.course_id}/register`;
    } catch {
      // With no verified order mapping, return to the course list.
    }
    return res.redirect(303, targetUrl.href);
  }

  app.get('/courses/payment-return', returnToCourse);
  app.post('/courses/payment-return', returnToCourse);
  app.post('/api/courses/payment-notify', async (req, res) => {
    try {
      const body = req.body || {};
      if (!(body.PayToken || body.payToken || body.TOKEN) && !PROVIDER_ORDER.test(body.OrderNo || body.orderNo || '')) {
        return res.status(400).json({ Status: 'F' });
      }
      const payment = await resolvePayment(body);
      requirePaymentOrderHints([body], payment.orderNo, payment.orderNo);
      await reconcile(payment);
      return res.json({ Status: 'S', OrderNo: payment.orderNo });
    } catch {
      return res.status(503).json({ Status: 'F' });
    }
  });
}

module.exports = { mountCoursePaymentRoutes };
