require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;
const baseUrl = process.env.SINOPAC_API_BASE_URL || 'https://apisbx.sinopac.com/funBIZ-Sbx/QPay.WebAPI/api';
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

function must(value, name) {
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function validateRequiredRuntimeEnv() {
  must(process.env.ORDER_CLEANUP_KEY, 'ORDER_CLEANUP_KEY');
}

function hasValidCleanupKey(suppliedKey) {
  const expectedKey = process.env.ORDER_CLEANUP_KEY || '';
  if (!expectedKey || !suppliedKey) return false;
  const expected = Buffer.from(expectedKey);
  const supplied = Buffer.from(String(suppliedKey));
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input), 'utf8').digest('hex').toUpperCase();
}

function xorHex(a, b) {
  const aa = Buffer.from(String(a).replace(/-/g, '').slice(0, 16), 'hex');
  const bb = Buffer.from(String(b).replace(/-/g, '').slice(0, 16), 'hex');
  if (aa.length !== bb.length) throw new Error('hash length mismatch');
  const out = Buffer.alloc(aa.length);
  for (let i = 0; i < aa.length; i += 1) out[i] = aa[i] ^ bb[i];
  return out.toString('hex').toUpperCase();
}

function getAesKey() {
  const a1 = must(process.env.SINOPAC_A1, 'SINOPAC_A1');
  const a2 = must(process.env.SINOPAC_A2, 'SINOPAC_A2');
  const b1 = must(process.env.SINOPAC_B1, 'SINOPAC_B1');
  const b2 = must(process.env.SINOPAC_B2, 'SINOPAC_B2');
  return xorHex(a1, a2) + xorHex(b1, b2);
}

function getIv(nonce) {
  return sha256Hex(nonce).slice(-16);
}

function encryptMessage(aesKey, plainText, nonce) {
  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    Buffer.from(aesKey, 'ascii'),
    Buffer.from(getIv(nonce), 'ascii')
  );
  return cipher.update(plainText, 'utf8', 'hex').toUpperCase() + cipher.final('hex').toUpperCase();
}

function decryptMessage(aesKey, cipherHex, nonce) {
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(aesKey, 'ascii'),
    Buffer.from(getIv(nonce), 'ascii')
  );
  return decipher.update(cipherHex, 'hex', 'utf8') + decipher.final('utf8');
}

function signableString(obj) {
  return Object.entries(obj)
    .filter(([_, value]) => value !== null && value !== undefined && value !== '' && typeof value !== 'object' && !Array.isArray(value))
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function generateSign(obj, aesKey, nonce) {
  return sha256Hex(signableString(obj) + nonce + aesKey);
}

function pickFirst(body, keys) {
  for (const key of keys) {
    const value = body?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return '';
}

function normalizeRequestBody(body) {
  if (!body || typeof body !== 'object') return {};
  const nested = body.data && typeof body.data === 'object' ? body.data : body.payload && typeof body.payload === 'object' ? body.payload : body;
  return nested;
}

function isPaidLike(value) {
  const v = String(value || '').trim().toUpperCase();
  return ['Y', 'S', 'PAID', 'SUCCESS', 'OK', '1', '1C300', '1M400'].includes(v) || /^1[A-Z](300|400)$/.test(v);
}

function isPendingLike(value) {
  const v = String(value || '').trim().toUpperCase();
  return ['N', 'P', 'PENDING', 'WAIT', 'W'].includes(v);
}

function getSinopacPaymentError(response) {
  if (!response || typeof response !== 'object') return '';
  const status = String(response.Status || '').trim().toUpperCase();
  const description = String(response.Description || '').trim();
  if (status && status !== 'S') return description || ('Sinopac status: ' + status);
  if (/^E\d{4}/i.test(description)) return description;
  return '';
}

async function sinopacPost(path, body) {
  const xKey = must(process.env.SINOPAC_X_KEY, 'SINOPAC_X_KEY');
  const response = await fetch(`${baseUrl}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-KeyID': xKey,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Sinopac ${path} failed: ${response.status} ${text}`);
  }
  return JSON.parse(text);
}

async function getNonce() {
  const shopNo = must(process.env.SINOPAC_SHOP_NO, 'SINOPAC_SHOP_NO');
  const res = await sinopacPost('Nonce', { ShopNo: shopNo });
  if (!res.Nonce) throw new Error('Nonce not returned from Sinopac');
  return res.Nonce;
}

async function callOrderApi(apiService, inner) {
  const shopNo = must(process.env.SINOPAC_SHOP_NO, 'SINOPAC_SHOP_NO');
  const aesKey = getAesKey();
  const nonce = await getNonce();

  const outerReq = {
    Version: '1.0.0',
    ShopNo: shopNo,
    APIService: apiService,
    Nonce: nonce,
    Message: encryptMessage(aesKey, JSON.stringify(inner), nonce),
    Sign: generateSign(inner, aesKey, nonce),
  };

  const outerRes = await sinopacPost('Order', outerReq);
  const decoded = JSON.parse(decryptMessage(aesKey, outerRes.Message, outerRes.Nonce));
  const verify = generateSign(decoded, aesKey, outerRes.Nonce);

  if (verify !== String(outerRes.Sign || '').toUpperCase()) {
    throw new Error('Sinopac response sign mismatch');
  }

  return { request: outerReq, response: outerRes, data: decoded };
}

function buildCreateBody(input) {
  const shopNo = must(process.env.SINOPAC_SHOP_NO, 'SINOPAC_SHOP_NO');
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('amount is required');
  if (!input.orderNo) throw new Error('orderNo is required');

  const payType = input.payType || 'A';
  const publicUrl = process.env.PAYMENT_PUBLIC_URL || 'https://pay.ecladotaiwan.com';

  const body = {
    ShopNo: shopNo,
    OrderNo: String(input.orderNo),
    Amount: Math.round(amount * 100),
    CurrencyID: 'TWD',
    PrdtName: input.prdtName || 'ECLADO訂單',
    PayType: payType,
    ReturnURL: input.returnUrl || `${publicUrl}/return`,
    // 統一由 Vultr 接收所有付款方式的非同步通知（信用卡/ATM/Apple）。
    // 忽略前端傳入的 backendUrl，確保正式環境只走已加入 IP 白名單的本機固定 IP。
    BackendURL: `${publicUrl}/api/sinopac/notify`,
    QRCodeStatus: input.qrCodeStatus || 'Y',
    QRCodeSize: Number(input.qrCodeSize || 350),
  };

  if (input.memo) body.Memo = input.memo;

  if (payType === 'A') {
    body.ATMParam = {
      ExpireDate: input.expireDate,
      ExpireTime: input.expireTime,
    };
  }

  if (payType === 'C' || payType === 'P') {
    body.CardParam = {
      AutoBilling: input.autoBilling === false ? 'N' : 'Y',
    };
  }

  if (payType === 'M') {
    body.MobileParam = {
      ExpMinutes: Number(input.expMinutes || 10),
    };
    if (input.choosePay) body.MobileParam.ChoosePay = input.choosePay;
  }

  if (payType === 'W') {
    body.WalletParam = {
      PayTypeSub: input.payTypeSub || 'Line',
    };
  }

  return body;
}

function buildQueryBody(input) {
  const shopNo = must(process.env.SINOPAC_SHOP_NO, 'SINOPAC_SHOP_NO');
  const body = { ShopNo: shopNo };

  if (input.orderNo) body.OrderNo = String(input.orderNo);
  if (input.payType) body.PayType = String(input.payType);
  if (input.orderDateTimeS) body.OrderDateTimeS = String(input.orderDateTimeS);
  if (input.orderDateTimeE) body.OrderDateTimeE = String(input.orderDateTimeE);
  if (input.payDateTimeS) body.PayDateTimeS = String(input.payDateTimeS);
  if (input.payDateTimeE) body.PayDateTimeE = String(input.payDateTimeE);
  if (input.payFlag) body.PayFlag = String(input.payFlag);

  return body;
}

async function updateSupabaseOrder(orderNo, patch) {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderNo)}`, {
    method: 'PATCH',
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase update failed: ${response.status} ${text}`);
  }
  const data = text ? JSON.parse(text) : [];
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`Order not found: ${orderNo}`);
  }
  return data;
}

async function callSupabaseRpc(name, body) {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase ${name} failed: ${response.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function claimSupabaseOrder(orderNo, paymentToken) {
  const order = await callSupabaseRpc('claim_order_payment', {
    p_order_id: orderNo,
    p_payment_token: paymentToken,
  });
  if (!order?.id) throw new Error(`Order not found: ${orderNo}`);
  if (!Number.isFinite(Number(order.total)) || Number(order.total) <= 0) {
    throw new Error(`Order total is invalid: ${orderNo}`);
  }
  return order;
}

async function authorizePaymentAccess(orderNo, paymentToken) {
  if (!orderNo || !paymentToken) throw new Error('orderNo and paymentToken are required');
  const authorized = await callSupabaseRpc('authorize_order_payment_access', {
    p_order_id: orderNo,
    p_payment_token: paymentToken,
  });
  if (authorized !== true) throw new Error('Invalid payment authorization');
}

async function buildAuthoritativeCreateBody(input) {
  if (!input?.orderNo) throw new Error('orderNo is required');
  if (!input?.paymentToken) throw new Error('paymentToken is required');
  const order = await claimSupabaseOrder(String(input.orderNo), String(input.paymentToken));
  const productName = Array.isArray(order.items) && order.items.length
    ? `${order.items[0].name || order.items[0].nameZh || 'ECLADO訂單'}${order.items.length > 1 ? ` 等 ${order.items.length} 項商品` : ''}`
    : 'ECLADO訂單';
  const deadline = formatSinopacDeadline(order.payment_due_at);
  if (!deadline) throw new Error('Order payment deadline is missing or invalid');
  return buildCreateBody({
    ...input,
    amount: Number(order.total),
    prdtName: productName,
    expireDate: deadline.expireDate,
    expireTime: deadline.expireTime,
  });
}

function formatSinopacDeadline(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = type => parts.find(item => item.type === type)?.value || '';
  return {
    expireDate: `${part('year')}${part('month')}${part('day')}`,
    expireTime: `${part('hour')}${part('minute')}`,
  };
}

// 訂單在 Vultr 標記已付款後，轉發給 Vercel 端發送 LINE／Email 付款完成通知。
// 只帶 OrderNo + Status，不帶 PayToken，Vercel 端不會再去打豐收款 API（正式環境免白名單）。
const NOTIFY_FORWARD_URL = process.env.PAYMENT_NOTIFY_FORWARD_URL || 'https://www.ecladotaiwan.com/api/sinopac/notify';

async function forwardPaidNotification(orderNo) {
  if (!orderNo || !NOTIFY_FORWARD_URL) return;
  try {
    await fetch(NOTIFY_FORWARD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ OrderNo: String(orderNo), Status: 'S' }),
    });
  } catch (error) {
    console.error('[notify forward] failed', error.message);
  }
}

async function expireOverdueOrders() {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const cutoff = new Date(Date.now()).toISOString();
  const params = new URLSearchParams({
    status: 'in.(awaiting_confirm,unpaid)',
    payment_due_at: `lte.${cutoff}`,
    select: 'id,status,created_at,payment_due_at',
  });

  const listResponse = await fetch(`${supabaseUrl}/rest/v1/orders?${params.toString()}`, {
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
    },
  });
  const listText = await listResponse.text();
  if (!listResponse.ok) {
    throw new Error(`Supabase overdue lookup failed: ${listResponse.status} ${listText}`);
  }

  const orders = listText ? JSON.parse(listText) : [];
  if (!Array.isArray(orders) || orders.length === 0) {
    return { cutoff, expired: [] };
  }

  const ids = orders.map(order => order.id).filter(Boolean);
  const updateParams = new URLSearchParams({
    id: `in.(${ids.join(',')})`,
    status: 'in.(awaiting_confirm,unpaid)',
    payment_due_at: `lte.${cutoff}`,
  });
  const patchResponse = await fetch(`${supabaseUrl}/rest/v1/orders?${updateParams.toString()}`, {
    method: 'PATCH',
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  const patchText = await patchResponse.text();
  if (!patchResponse.ok) {
    throw new Error(`Supabase overdue update failed: ${patchResponse.status} ${patchText}`);
  }

  return { cutoff, expired: patchText ? JSON.parse(patchText) : [] };
}

async function queryOrderByOrderNo(orderNo) {
  const result = await callOrderApi('OrderQuery', { ShopNo: must(process.env.SINOPAC_SHOP_NO, 'SINOPAC_SHOP_NO'), OrderNo: orderNo });
  return result.data;
}

async function queryPayByToken(payToken) {
  const result = await callOrderApi('OrderPayQuery', {
    ShopNo: must(process.env.SINOPAC_SHOP_NO, 'SINOPAC_SHOP_NO'),
    PayToken: payToken,
  });
  return result.data;
}

async function resolvePaymentStateFromWebhook(body) {
  const payToken = pickFirst(body, ['PayToken', 'payToken', 'TOKEN']);
  const orderNoFromBody = pickFirst(body, ['OrderNo', 'orderNo']);
  const payStatusFromBody = pickFirst(body, ['PayStatus', 'payStatus']);
  const payFlagFromBody = pickFirst(body, ['PayFlag', 'payFlag']);
  const tsNoFromBody = pickFirst(body, ['TSNo', 'tsNo']);
  const payTypeFromBody = pickFirst(body, ['PayType', 'payType']);
  const descriptionFromBody = pickFirst(body, ['Description', 'description']);

  let queryOrderNo = String(orderNoFromBody || '').trim();
  let orderQuery = null;
  let payQuery = null;

  if (payToken) {
    payQuery = await queryPayByToken(String(payToken).trim());
    queryOrderNo = queryOrderNo || String(payQuery?.TSResultContent?.OrderNo || '').trim();
  }

  if (queryOrderNo) {
    orderQuery = await queryOrderByOrderNo(queryOrderNo);
  }

  const orderInfo = Array.isArray(orderQuery?.OrderList) ? orderQuery.OrderList[0] : null;
  const payResult = payQuery?.TSResultContent || {};
  const payResultStatus = String(payResult.Status || '').trim().toUpperCase();
  const apType = String(payResult.APType || '').trim();
  const payStatus = String(orderInfo?.PayStatus || payStatusFromBody || '').trim().toUpperCase();
  const payFlag = String(orderInfo?.PayFlag || payFlagFromBody || '').trim().toUpperCase();
  const payType = String(orderInfo?.PayType || payResult.PayType || payTypeFromBody || '').trim().toUpperCase();
  const tsNo = String(orderInfo?.TSNo || payResult.TSNo || tsNoFromBody || '').trim();
  const description = String(orderInfo?.Description || payQuery?.Description || descriptionFromBody || '').trim();

  // 信用卡/行動支付走 OrderPayQuery：APType=PayOut(付款成功)/CaptureOut(已請款) 且交易 Status=S 即視為已付款
  const paidByPayResult = payResultStatus === 'S' && ['PayOut', 'CaptureOut'].includes(apType);
  const paid = isPaidLike(payStatus) || isPaidLike(payFlag) || paidByPayResult;
  const pending = !paid && (isPendingLike(payStatus) || isPendingLike(payFlag));

  return {
    orderNo: queryOrderNo,
    tsNo,
    payType,
    payStatus,
    payFlag,
    description,
    paid,
    pending,
    raw: {
      body,
      orderQuery,
      payQuery,
    },
  };
}

app.use(helmet());
app.use(cors({
  origin: [
    'https://www.ecladotaiwan.com',
    'https://ecladotaiwan.com',
  ],
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'eclado-payment-api',
    time: new Date().toISOString(),
  });
});

function buildPaymentResultUrl(orderNo, result = 'pending') {
  const siteUrl = new URL('https://ecladotaiwan.com/payment-result');
  if (orderNo) siteUrl.searchParams.set('orderNo', String(orderNo));
  siteUrl.searchParams.set('result', ['paid', 'failed'].includes(result) ? result : 'pending');
  return siteUrl.toString();
}

async function redirectPaymentReturn(req, res) {
  const orderNo = req.query.orderNo || req.body?.OrderNo || req.body?.orderNo;
  const payToken = req.body?.PayToken || req.body?.payToken || req.query.payToken;
  let resolvedOrderNo = String(orderNo || '').trim();
  let result = 'pending';

  // 信用卡(含行動支付)的付款結果是經由 ReturnURL 同步回拋，
  // 這裡用 PayToken 向豐收款確認付款結果後更新訂單，再導回前台。
  if (payToken) {
    try {
      const payment = await resolvePaymentStateFromWebhook({ ...req.query, ...req.body });
      resolvedOrderNo = payment.orderNo || resolvedOrderNo;
      if (resolvedOrderNo && payment.paid) {
        // 先轉發給 Vercel（此時訂單尚未標記 paid）→ Vercel 標記已付款並寄 LINE／Email，
        // 再由 Vultr 補寫一次作為保險（Vercel 失敗時仍會標記）。
        await forwardPaidNotification(resolvedOrderNo);
        try {
          await updateSupabaseOrder(resolvedOrderNo, { status: 'paid' });
        } catch (e) {
          console.error('[return] supabase fallback failed', e.message);
        }
        console.log(`[return] order ${resolvedOrderNo} confirmed paid`);
        result = 'paid';
      } else {
        console.warn(`[return] order ${resolvedOrderNo || '?'} not marked paid (payStatus=${payment.payStatus}, payFlag=${payment.payFlag})`);
        result = payment.pending ? 'pending' : 'failed';
      }
    } catch (error) {
      console.error('[return] payment confirm failed', error);
    }
  }

  res.redirect(303, buildPaymentResultUrl(resolvedOrderNo, result));
}

app.get('/return', redirectPaymentReturn);
app.post('/return', redirectPaymentReturn);

app.post('/api/sinopac/create-payment', async (req, res) => {
  const orderNo = String(req.body?.orderNo || '').trim();
  const paymentToken = String(req.body?.paymentToken || '').trim();
  let claimed = false;
  let gatewaySucceeded = false;
  try {
    const inner = await buildAuthoritativeCreateBody(req.body || {});
    claimed = true;
    const result = await callOrderApi('OrderCreate', inner);
    const sinopacError = getSinopacPaymentError(result.data);
    if (sinopacError) {
      await callSupabaseRpc('complete_order_payment_claim', {
        p_order_id: orderNo,
        p_payment_token: paymentToken,
        p_success: false,
      });
      claimed = false;
      return res.status(400).json({ ok: false, error: sinopacError, request: inner, response: result.data });
    }
    gatewaySucceeded = true;
    await callSupabaseRpc('complete_order_payment_claim', {
      p_order_id: orderNo,
      p_payment_token: paymentToken,
      p_success: true,
    });
    claimed = false;
    res.json({ ok: true, request: inner, response: result.data });
  } catch (error) {
    if (claimed && !gatewaySucceeded) {
      try {
        await callSupabaseRpc('complete_order_payment_claim', {
          p_order_id: orderNo,
          p_payment_token: paymentToken,
          p_success: false,
        });
      } catch (releaseError) {
        console.error('[create-payment] claim release failed', releaseError.message);
      }
    }
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/sinopac/query-payment', async (req, res) => {
  try {
    const orderNo = String(req.body?.orderNo || '').trim();
    const paymentToken = String(req.body?.paymentToken || '').trim();
    await authorizePaymentAccess(orderNo, paymentToken);
    const inner = buildQueryBody(req.body || {});
    const result = await callOrderApi('OrderQuery', inner);
    res.json({ ok: true, request: inner, response: result.data });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/orders/expire-overdue', async (req, res) => {
  try {
    if (!process.env.ORDER_CLEANUP_KEY) {
      return res.status(500).json({ ok: false, error: 'Server cleanup authorization is not configured' });
    }
    if (!hasValidCleanupKey(req.get('X-Cleanup-Key'))) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const result = await expireOverdueOrders();
    console.log(`[orders expire] cancelled ${result.expired.length} overdue orders`);
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error('[orders expire] failed', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/sinopac/notify', async (req, res) => {
  try {
    const body = normalizeRequestBody(req.body);
    console.log('[sinopac notify] received', JSON.stringify(body));

    const payment = await resolvePaymentStateFromWebhook(body);
    const orderNo = payment.orderNo;

    if (!orderNo) {
      console.warn('[sinopac notify] missing orderNo / PayToken, nothing to update');
      return res.json({ Status: 'S', message: 'received' });
    }

    const nextStatus = payment.paid ? 'paid' : 'awaiting_confirm';

    if (payment.paid) {
      // 先轉發給 Vercel 標記已付款並寄送 LINE／Email（此時訂單尚未 paid，才不會被當成已處理跳過），
      // 再由 Vultr 補寫一次作為保險。
      await forwardPaidNotification(orderNo);
    }

    try {
      await updateSupabaseOrder(orderNo, { status: nextStatus });
    } catch (e) {
      console.error('[sinopac notify] supabase write failed', e.message);
    }
    console.log(`[sinopac notify] order ${orderNo} -> ${nextStatus}`);

    res.json({ Status: 'S', OrderNo: orderNo, updated: nextStatus });
  } catch (error) {
    console.error('[sinopac notify] update failed', error);
    res.status(200).json({ Status: 'S', error: error.message });
  }
});

// 直接執行（pm2 / node server.js）時才啟動監聽；被 require 進測試時不啟動。
if (require.main === module) {
  validateRequiredRuntimeEnv();
  app.listen(port, '127.0.0.1', () => {
    console.log(`ECLADO payment API listening on 127.0.0.1:${port}`);
  });
}

// 匯出 app 與純函式供測試使用。
module.exports = {
  app,
  validateRequiredRuntimeEnv,
  hasValidCleanupKey,
  sha256Hex,
  xorHex,
  getAesKey,
  getIv,
  encryptMessage,
  decryptMessage,
  signableString,
  generateSign,
  pickFirst,
  normalizeRequestBody,
  isPaidLike,
  isPendingLike,
  getSinopacPaymentError,
  buildCreateBody,
  buildAuthoritativeCreateBody,
  formatSinopacDeadline,
  buildQueryBody,
  buildPaymentResultUrl,
};
