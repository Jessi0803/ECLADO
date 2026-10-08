// Purpose-specific bearer links; never expose payment authorization credentials.
function isAmbiguousGatewayFailure(response) {
  // Duplicate/existing requests and processing/timeouts are not evidence that
  // the bank created nothing. Keep the original claim for reconciliation.
  return /duplicate|already|exist|timeout|timed? out|processing|重複|已存在|已受理|逾時|超時|處理中|稍後/i.test(String(response?.Description || ''));
}
function publicAssistedOrder(order) {
  return {
    id:order.id, member:order.member, address:order.address, phone:order.phone, email:order.email,
    status:order.status, subtotal:Number(order.subtotal), shipping:Number(order.total)-Number(order.subtotal),
    total:Number(order.total), payment_due_at:order.payment_due_at,
    fulfillment_method:order.fulfillment_method, invoice_type:order.invoice_type,
    invoice_company_name:order.invoice_type==='company' ? order.invoice_company_name : null,
    invoice_tax_id:order.invoice_type==='company' ? order.invoice_tax_id : null,
    public_lookup_code:order.user_id ? null : order.public_lookup_code,
    is_member:Boolean(order.user_id),
    items:(Array.isArray(order.items) ? order.items : []).map(item => ({
      name:item.name || item.nameZh, size:item.size, sku:item.sku, qty:Number(item.qty),
      unit_price:Number(item.unit_price), line_total:Number(item.unit_price)*Number(item.qty),
      fulfillment_type:item.fulfillment_type,
    })),
  };
}

function mountAssistedRoutes(app, dependencies) {
  const { rpc, getOrder, getInstruction, paymentRequest, buildCreate, callBank, gatewayError,
    saveInstruction, saveAttempt, sendEmail, rateLimit, publicInstruction, resultToken } = dependencies;
  async function read(req) {
    const orderNo = String(req.body?.orderNo || '');
    const credential = await rpc('authorize_assisted_link', {
      p_order_id:orderNo, p_link_token:String(req.body?.linkToken || ''),
    });
    return { orderNo, credential, order:await getOrder(orderNo) };
  }
  app.post('/api/orders/assisted-details', async (req,res) => {
    res.set('Cache-Control','no-store');
    try {
      if (!await rateLimit(req,res,'assisted:details',30)) return;
      const { order, credential } = await read(req);
      const instruction = await getInstruction(order.id);
      const state = ['paid','preparing','ready_for_pickup','picked_up','shipped','delivered'].includes(order.status) ? 'paid'
        : order.status==='cancelled' ? 'cancelled' : instruction?.payment_state || 'pending';
      res.json({ ok:true, order:publicAssistedOrder(order), paymentMethod:credential.payment_method,
        instruction:publicInstruction(instruction,state), resultAccessToken:resultToken(order.id) });
    } catch {
      res.status(403).json({ok:false,error:'連結無效或已到期，請使用會員中心／訪客訂單查詢。'});
    }
  });
  app.post('/api/orders/assisted-payment', async (req,res) => {
    res.set('Cache-Control','no-store');
    let credential; let orderNo; let gatewayStarted=false;
    try {
      if (!await rateLimit(req,res,'assisted:payment',10)) return;
      const context = await read(req);
      ({ credential,orderNo }=context);
      const order = context.order;
      if (!['unpaid','awaiting_confirm'].includes(order.status) || new Date(order.payment_due_at)<=new Date()) {
        return res.status(409).json({ok:false,error:'此訂單已付款、取消或到期，不能再建立付款。'});
      }
      const existing = await getInstruction(orderNo);
      if (existing) {
        if (existing.payment_state!=='pending') return res.status(409).json({ok:false,error:'付款已結束，請由原有訂單查詢入口確認或重新付款。'});
        return res.json({ok:true,recovered:true,instruction:publicInstruction(existing,'pending')});
      }
      const publicUrl=process.env.PAYMENT_PUBLIC_URL || 'https://pay.ecladotaiwan.com';
      const input={orderNo,paymentToken:credential.payment_token,...paymentRequest(credential.payment_method),
        returnUrl:`${publicUrl}/return?orderNo=${encodeURIComponent(orderNo)}`, qrCodeStatus:'Y',Param1:orderNo};
      // Database row lock admits only one claimant, including separate browsers.
      const inner=await buildCreate(input);
      gatewayStarted=true;
      const result=await callBank('OrderCreate',inner);
      if (!result.data || !String(result.data.Status || '').trim()) throw new Error('Incomplete bank response');
      const error=gatewayError(result.data);
      if (error) {
        if(isAmbiguousGatewayFailure(result.data)) throw new Error('Bank result unresolved');
        // Only a definite rejection releases the claim. A timeout/transport
        // exception deliberately leaves it locked: success may have occurred.
        await rpc('resolve_assisted_payment_claim',{p_order_id:orderNo,p_payment_token:credential.payment_token,p_outcome:'rejected'});
        return res.status(400).json({ok:false,error:'銀行未接受此付款單，原訂單保留，可再次重試。'});
      }
      await rpc('resolve_assisted_payment_claim',{p_order_id:orderNo,p_payment_token:credential.payment_token,p_outcome:'success'});
      await saveInstruction(order,input,result.data);
      await saveAttempt(order,input,result.data);
      const instruction=await getInstruction(orderNo);
      await sendEmail(order).catch(()=>null);
      res.json({ok:true,instruction:publicInstruction(instruction,'pending')});
    } catch (error) {
      // Never clear a possibly successful bank request on an exception.
      console.error('[assisted-payment]',gatewayStarted ? 'gateway result unresolved' : 'payment not created');
      res.status(409).json({ok:false,error:'原訂單已保留；付款可能正在處理或結果待確認。請重新讀取付款資訊，勿取消重建或重複開單；若仍無資訊，請聯繫管理員確認銀行結果。'});
    }
  });
}
module.exports={ mountAssistedRoutes, publicAssistedOrder, isAmbiguousGatewayFailure };
