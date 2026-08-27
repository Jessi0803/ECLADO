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
  must(process.env.PAYMENT_NOTIFY_SECRET, 'PAYMENT_NOTIFY_SECRET');
  must(process.env.GUEST_LOOKUP_SECRET, 'GUEST_LOOKUP_SECRET');
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

function summarizePaymentWebhook(body) {
  const normalized = normalizeRequestBody(body);
  return {
    keys: Object.keys(normalized).sort(),
    orderNo: String(pickFirst(normalized, ['OrderNo', 'orderNo']) || '').trim() || undefined,
    payType: String(pickFirst(normalized, ['PayType', 'payType']) || '').trim() || undefined,
    payStatus: String(pickFirst(normalized, ['PayStatus', 'payStatus']) || '').trim() || undefined,
    hasPayToken: Boolean(pickFirst(normalized, ['PayToken', 'payToken', 'TOKEN'])),
  };
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

async function updateSupabaseOrder(orderNo, patch, auditSource = 'payment-api') {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderNo)}`, {
    method: 'PATCH',
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/json',
      'X-ECLADO-Audit-Source': auditSource,
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
      'X-ECLADO-Audit-Source': 'payment-api',
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

async function getSupabaseOrderPaymentState(orderNo) {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  const params = new URLSearchParams({
    id: `eq.${orderNo}`,
    select: 'id,user_id,member,email,phone,public_lookup_code,status,total,subtotal,discount,promotion_name,items,payment_due_at,date,created_at,updated_at,tracking,shipping_carrier,shipped_at',
    limit: '1',
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/orders?${params}`, {
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase order lookup failed: ${response.status} ${text}`);
  const rows = text ? JSON.parse(text) : [];
  if (!Array.isArray(rows) || !rows[0]?.id) throw new Error(`Order not found: ${orderNo}`);
  return rows[0];
}

function normalizeLookupCode(value) {
  const compact = String(value || '').toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 10);
  return compact.length === 10 ? `${compact.slice(0, 5)}-${compact.slice(5)}` : '';
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('886') && digits.length >= 11) return `0${digits.slice(3)}`;
  return digits;
}

function safeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createGuestAccessToken(orderNo, ttlMs = 30 * 60 * 1000) {
  const secret = must(process.env.GUEST_LOOKUP_SECRET, 'GUEST_LOOKUP_SECRET');
  const payload = Buffer.from(JSON.stringify({
    orderNo: String(orderNo),
    exp: Date.now() + ttlMs,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyGuestAccessToken(token, orderNo) {
  const secret = must(process.env.GUEST_LOOKUP_SECRET, 'GUEST_LOOKUP_SECRET');
  const [payload, suppliedSignature] = String(token || '').split('.');
  if (!payload || !suppliedSignature) return false;
  const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (!safeStringEqual(suppliedSignature, expectedSignature)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return String(parsed.orderNo || '') === String(orderNo || '')
      && Number(parsed.exp) > Date.now();
  } catch {
    return false;
  }
}

async function getSupabaseGuestOrderByLookup(lookupCode) {
  const params = new URLSearchParams({
    public_lookup_code: `eq.${lookupCode}`,
    select: 'id,user_id,member,email,phone,public_lookup_code,status,total,subtotal,discount,promotion_name,items,payment_due_at,date,created_at,updated_at,tracking,shipping_carrier,shipped_at',
    limit: '1',
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/orders?${params}`, {
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Guest order lookup failed: ${response.status} ${text}`);
  const rows = text ? JSON.parse(text) : [];
  return Array.isArray(rows) ? rows[0] || null : null;
}

function toPublicOrderPaymentState(order) {
  if (!order) return null;
  const total = Number(order.total) || 0;
  const subtotal = Number(order.subtotal) || 0;
  const discount = Number(order.discount) || 0;
  return {
    id: order.id,
    status: order.status,
    total,
    subtotal,
    discount,
    shipping: Math.max(0, total - subtotal + discount),
    promotion_name: order.promotion_name || null,
    items: Array.isArray(order.items) ? order.items : [],
    payment_due_at: order.payment_due_at,
    date: order.date || null,
    created_at: order.created_at || null,
    updated_at: order.updated_at || null,
    tracking: order.tracking || null,
    shipping_carrier: order.shipping_carrier || null,
    shipped_at: order.shipped_at || null,
  };
}

function toPublicGuestPaymentInstruction(instruction, paymentState) {
  if (!instruction) return null;
  const result = {
    order_id: instruction.order_id,
    payment_method: instruction.payment_method,
    provider_status: instruction.provider_status,
    provider_description: instruction.provider_description,
    payment_due_at: instruction.payment_due_at,
    gateway_created_at: instruction.gateway_created_at,
    order_email_sent_at: instruction.order_email_sent_at,
  };
  if (paymentState === 'pending') {
    result.atm_bank_code = instruction.atm_bank_code;
    result.atm_account = instruction.atm_account;
    result.payment_url = instruction.payment_url;
    result.provider_transaction_no = instruction.provider_transaction_no;
  }
  return result;
}

function getBearerToken(req) {
  const header = String(req.get('Authorization') || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

async function getSupabaseAuthUser(req) {
  const accessToken = getBearerToken(req);
  if (!accessToken) throw new Error('Member authentication is required');
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Member authentication failed: ${response.status}`);
  const user = text ? JSON.parse(text) : null;
  if (!user?.id) throw new Error('Member authentication failed');
  return user;
}

async function authorizeMemberOrderAccess(req, orderNo) {
  const user = await getSupabaseAuthUser(req);
  const order = await getSupabaseOrderPaymentState(orderNo);
  if (!order.user_id || String(order.user_id) !== String(user.id)) {
    throw new Error('Order does not belong to the signed-in member');
  }
  return order;
}

async function authorizePaymentRequest(req, orderNo, paymentToken) {
  if (paymentToken) {
    await authorizePaymentAccess(orderNo, paymentToken);
    return getSupabaseOrderPaymentState(orderNo);
  }
  const guestAccessToken = String(req.body?.guestAccessToken || '');
  if (guestAccessToken) {
    if (!verifyGuestAccessToken(guestAccessToken, orderNo)) {
      throw new Error('Guest payment access has expired');
    }
    const order = await getSupabaseOrderPaymentState(orderNo);
    if (order.user_id) throw new Error('Guest access is not valid for member orders');
    return order;
  }
  return authorizeMemberOrderAccess(req, orderNo);
}

function extractServerPaymentLink(response) {
  const candidates = [
    response?.PayURL,
    response?.RedirectURL,
    response?.PaymentURL,
    response?.CardParam?.CardPayURL,
    response?.CardParam?.CardURL,
    response?.MobileParam?.MobilePayURL,
    response?.MobileParam?.MobileURL,
    response?.WalletParam?.WalletPayURL,
    response?.WalletParam?.WalletURL,
    response?.WebAtmURL,
    response?.ATMParam?.WebAtmURL,
  ];
  return candidates.find(value => typeof value === 'string' && value.startsWith('http') && !value.includes('QRCode')) || null;
}

function paymentMethodFromRequest(input) {
  if (input?.payType === 'A') return 'atm';
  if (input?.payType === 'C') return 'card';
  if (input?.payType === 'M' && input?.choosePay === 'A') return 'apple';
  if (input?.payType === 'M' && input?.choosePay === 'G') return 'google';
  return String(input?.paymentMethod || input?.payType || '').toLowerCase();
}

async function saveOrderPaymentInstruction(order, input, gatewayResponse) {
  const record = {
    order_id: order.id,
    payment_method: paymentMethodFromRequest(input) || 'unknown',
    provider_transaction_no: gatewayResponse?.TSNo || null,
    provider_status: gatewayResponse?.Status || null,
    provider_description: gatewayResponse?.Description || null,
    atm_bank_code: gatewayResponse?.ATMParam?.AtmPayNo ? '807' : null,
    atm_account: gatewayResponse?.ATMParam?.AtmPayNo || null,
    payment_url: extractServerPaymentLink(gatewayResponse),
    payment_due_at: order.payment_due_at,
    gateway_created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const response = await fetch(`${supabaseUrl}/rest/v1/order_payment_instructions?on_conflict=order_id`, {
    method: 'POST',
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(record),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Payment instruction save failed: ${response.status} ${text}`);
  const rows = text ? JSON.parse(text) : [];
  return Array.isArray(rows) ? rows[0] : null;
}

async function getOrderPaymentInstruction(orderNo) {
  const params = new URLSearchParams({
    order_id: `eq.${orderNo}`,
    select: 'order_id,payment_method,provider_transaction_no,provider_status,provider_description,atm_bank_code,atm_account,payment_url,payment_due_at,gateway_created_at,order_email_sent_at',
    limit: '1',
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/order_payment_instructions?${params}`, {
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Payment instruction lookup failed: ${response.status} ${text}`);
  const rows = text ? JSON.parse(text) : [];
  if (!Array.isArray(rows) || !rows[0]?.order_id) throw new Error(`Payment instruction not found: ${orderNo}`);
  return rows[0];
}

async function getOptionalOrderPaymentInstruction(orderNo) {
  try {
    return await getOrderPaymentInstruction(orderNo);
  } catch (error) {
    if (String(error?.message || '').startsWith('Payment instruction not found:')) return null;
    throw error;
  }
}

async function updateOrderEmailDelivery(orderNo, { sent, error = '' }) {
  const response = await fetch(`${supabaseUrl}/rest/v1/order_payment_instructions?order_id=eq.${encodeURIComponent(orderNo)}`, {
    method: 'PATCH',
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      order_email_sent_at: sent ? new Date().toISOString() : null,
      order_email_error: sent ? null : String(error || 'Unknown email error').slice(0, 1000),
      updated_at: new Date().toISOString(),
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Order email delivery state failed: ${response.status} ${text}`);
  }
}

async function sendGuestOrderCreatedEmail(order) {
  if (order.user_id || !order.email) return { sent: false, skipped: true };
  const secret = must(process.env.PAYMENT_NOTIFY_SECRET, 'PAYMENT_NOTIFY_SECRET');
  const emailUrl = process.env.ORDER_EMAIL_URL || 'https://ecladotaiwan.com/api/order-email';
  const lookupCode = normalizeLookupCode(order.public_lookup_code);
  // Avoid `code`, which Supabase auth treats as an OAuth/PKCE callback query.
  const lookupUrl = `https://ecladotaiwan.com/order-lookup?lookup=${encodeURIComponent(lookupCode)}`;
  try {
    const response = await fetch(emailUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ECLADO-Payment-Secret': secret,
      },
      body: JSON.stringify({
        type: 'order_placed',
        email: order.email,
        orderId: order.id,
        memberName: order.member,
        total: Number(order.total) || 0,
        lookupCode,
        lookupUrl,
        paymentDueAt: order.payment_due_at,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Order email HTTP ${response.status}`);
    await updateOrderEmailDelivery(order.id, { sent: true });
    return { sent: true };
  } catch (error) {
    try {
      await updateOrderEmailDelivery(order.id, { sent: false, error: error.message });
    } catch (stateError) {
      console.error('[order email] delivery state failed', stateError.message);
    }
    console.error('[order email] failed', error.message);
    return { sent: false, error: error.message };
  }
}

function getRateLimitKeyHash(req, scope) {
  const secret = must(process.env.GUEST_LOOKUP_SECRET, 'GUEST_LOOKUP_SECRET');
  const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').trim();
  return crypto.createHmac('sha256', secret).update(`${scope}:${ip}`, 'utf8').digest('hex');
}

async function enforceSharedRateLimit(req, res, scope, limit, windowSeconds = 900) {
  try {
    const allowed = await callSupabaseRpc('consume_service_rate_limit', {
      p_scope: scope,
      p_key_hash: getRateLimitKeyHash(req, scope),
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (allowed === true) return true;
    res.set('Retry-After', String(windowSeconds));
    res.status(429).json({ ok: false, error: '操作次數過多，請稍後再試。' });
    return false;
  } catch (error) {
    console.error(`[rate limit] ${scope} failed`, error.message);
    res.status(503).json({ ok: false, error: '安全檢查暫時無法使用，請稍後再試。' });
    return false;
  }
}

function resolvePaymentQueryState(order, gatewayResponse) {
  const gatewayOrder = Array.isArray(gatewayResponse?.OrderList)
    ? gatewayResponse.OrderList[0]
    : gatewayResponse;
  if (isPaidLike(gatewayOrder?.PayStatus) || isPaidLike(gatewayOrder?.PayFlag)) return 'paid';
  if (['paid', 'preparing', 'shipped', 'delivered'].includes(String(order?.status || ''))) return 'paid';

  const dueTime = new Date(order?.payment_due_at || '').getTime();
  if (Number.isFinite(dueTime) && dueTime <= Date.now()) return 'expired';
  if (order?.status === 'cancelled') return 'cancelled';
  if (!['awaiting_confirm', 'unpaid'].includes(String(order?.status || ''))) return 'failed';

  const payStatus = String(gatewayOrder?.PayStatus || '').trim().toUpperCase();
  const payFlag = String(gatewayOrder?.PayFlag || '').trim().toUpperCase();
  if ((payStatus && !isPendingLike(payStatus) && !['1C200', '1A200', '1M200', '0'].includes(payStatus))
    || (payFlag && !isPendingLike(payFlag) && !['N', '0'].includes(payFlag))) {
    return 'failed';
  }
  return 'pending';
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
const NOTIFY_FORWARD_URL = process.env.PAYMENT_NOTIFY_FORWARD_URL || 'https://ecladotaiwan.com/api/sinopac/notify';

async function forwardPaidNotification(orderNo) {
  if (!orderNo || !NOTIFY_FORWARD_URL) return { sent: false, reason: 'notification target unavailable' };
  try {
    const secret = must(process.env.PAYMENT_NOTIFY_SECRET, 'PAYMENT_NOTIFY_SECRET');
    const response = await fetch(NOTIFY_FORWARD_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ECLADO-Payment-Secret': secret,
      },
      body: JSON.stringify({ OrderNo: String(orderNo), Status: 'S' }),
    });

    if (!response.ok) {
      const text = (await response.text()).slice(0, 500);
      throw new Error(`Vercel notify HTTP ${response.status}${text ? ` ${text}` : ''}`);
    }

    return { sent: true };
  } catch (error) {
    console.error('[notify forward] failed', error.message);
    return { sent: false, reason: error.message };
  }
}

async function retryPendingPaymentNotifications({ limit = 50 } = {}) {
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const now = new Date().toISOString();
  const params = new URLSearchParams({
    status: 'in.(paid,preparing,shipped,delivered)',
    payment_notification_sent_at: 'is.null',
    or: `(payment_notification_next_retry_at.is.null,payment_notification_next_retry_at.lte.${now})`,
    select: 'id,payment_notification_attempts,payment_notification_last_attempt_at',
    order: 'payment_notification_last_attempt_at.asc.nullsfirst',
    limit: String(safeLimit),
  });
  const response = await fetch(`${supabaseUrl}/rest/v1/orders?${params}`, {
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      'X-ECLADO-Audit-Source': 'payment-notification-retry',
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase payment notification lookup failed: ${response.status} ${text}`);
  }
  const orders = text ? JSON.parse(text) : [];
  const results = [];
  for (const order of Array.isArray(orders) ? orders : []) {
    const forwarded = await forwardPaidNotification(order.id);
    results.push({ orderNo: order.id, sent: forwarded.sent, reason: forwarded.reason });
  }
  return { checked: results.length, sent: results.filter(result => result.sent).length, results };
}

function canAcknowledgePaymentWebhook(payment, forwarded, stored) {
  return !payment?.paid || forwarded?.sent === true || stored === true;
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
      'X-ECLADO-Audit-Source': 'vultr-expire-overdue',
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
      'X-ECLADO-Audit-Source': 'vultr-expire-overdue',
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
app.set('trust proxy', 'loopback');
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
          await updateSupabaseOrder(resolvedOrderNo, { status: 'paid' }, 'payment-return');
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
    if (!await enforceSharedRateLimit(req, res, 'payment:create', 20)) return;
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
    let order = null;
    let recoveryStored = false;
    let orderEmailSent = false;
    try {
      order = await getSupabaseOrderPaymentState(orderNo);
      await saveOrderPaymentInstruction(order, req.body || {}, result.data);
      recoveryStored = true;
      const emailResult = await sendGuestOrderCreatedEmail(order);
      orderEmailSent = emailResult.sent === true;
    } catch (lookupError) {
      console.error('[create-payment] payment recovery save failed', lookupError.message);
    }
    res.json({
      ok: true,
      request: inner,
      response: result.data,
      order: toPublicOrderPaymentState(order),
      recoveryStored,
      guestLookupCode: order && !order.user_id ? normalizeLookupCode(order.public_lookup_code) : '',
      orderEmailSent,
    });
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
    if (!await enforceSharedRateLimit(req, res, 'payment:query', 60)) return;
    const orderNo = String(req.body?.orderNo || '').trim();
    const paymentToken = String(req.body?.paymentToken || '').trim();
    if (!orderNo) throw new Error('orderNo is required');
    const order = await authorizePaymentRequest(req, orderNo, paymentToken);
    const inner = buildQueryBody(req.body || {});
    const result = await callOrderApi('OrderQuery', inner);
    const paymentState = resolvePaymentQueryState(order, result.data);
    res.json({ ok: true, request: inner, response: result.data, order: toPublicOrderPaymentState(order), paymentState });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/orders/payment-instructions', async (req, res) => {
  try {
    const orderNo = String(req.body?.orderNo || '').trim();
    if (!orderNo) throw new Error('orderNo is required');
    const order = await authorizeMemberOrderAccess(req, orderNo);
    const instruction = await getOrderPaymentInstruction(orderNo);
    const paymentState = resolvePaymentQueryState(order, {});
    res.json({
      ok: true,
      order: toPublicOrderPaymentState(order),
      instruction,
      paymentState,
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.post('/api/orders/guest-lookup', async (req, res) => {
  try {
    if (!await enforceSharedRateLimit(req, res, 'order:guest-lookup', 5)) return;
    const lookupCode = normalizeLookupCode(req.body?.lookupCode);
    const phone = normalizePhone(req.body?.phone);
    if (!lookupCode || phone.length < 9) throw new Error('Invalid guest lookup');
    const order = await getSupabaseGuestOrderByLookup(lookupCode);
    if (!order || order.user_id || !safeStringEqual(normalizePhone(order.phone), phone)) {
      throw new Error('Invalid guest lookup');
    }
    const instruction = await getOptionalOrderPaymentInstruction(order.id);
    const paymentState = resolvePaymentQueryState(order, {});
    res.json({
      ok: true,
      order: toPublicOrderPaymentState(order),
      instruction: toPublicGuestPaymentInstruction(instruction, paymentState),
      paymentState,
      guestAccessToken: createGuestAccessToken(order.id),
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: '查詢資料不正確，請確認查詢碼與手機號碼。' });
  }
});

app.post('/api/orders/guest-details', async (req, res) => {
  try {
    const orderNo = String(req.body?.orderNo || '').trim();
    const guestAccessToken = String(req.body?.guestAccessToken || '').trim();
    if (!orderNo || !verifyGuestAccessToken(guestAccessToken, orderNo)) {
      throw new Error('Guest order access has expired');
    }
    const order = await getSupabaseOrderPaymentState(orderNo);
    if (order.user_id) throw new Error('Guest access is not valid for member orders');
    const instruction = await getOptionalOrderPaymentInstruction(order.id);
    const paymentState = resolvePaymentQueryState(order, {});
    res.json({
      ok: true,
      order: toPublicOrderPaymentState(order),
      instruction: toPublicGuestPaymentInstruction(instruction, paymentState),
      paymentState,
      guestAccessToken,
    });
  } catch (error) {
    res.status(401).json({ ok: false, error: '訪客訂單查詢授權已過期，請重新輸入查詢碼與手機號碼。' });
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

app.post('/api/orders/retry-payment-notifications', async (req, res) => {
  try {
    if (!process.env.ORDER_CLEANUP_KEY) {
      return res.status(500).json({ ok: false, error: 'Server cleanup authorization is not configured' });
    }
    if (!hasValidCleanupKey(req.get('X-Cleanup-Key'))) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const result = await retryPendingPaymentNotifications({ limit: req.body?.limit });
    console.log(`[payment notification retry] sent ${result.sent}/${result.checked}`);
    const failed = result.checked - result.sent;
    return res.status(failed > 0 ? 503 : 200).json({ ok: failed === 0, failed, ...result });
  } catch (error) {
    console.error('[payment notification retry] failed', error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/sinopac/notify', async (req, res) => {
  try {
    const body = normalizeRequestBody(req.body);
    console.log('[sinopac notify] received', summarizePaymentWebhook(body));

    const payment = await resolvePaymentStateFromWebhook(body);
    const orderNo = payment.orderNo;

    if (!orderNo) {
      console.warn('[sinopac notify] unresolved order', summarizePaymentWebhook(body));
      return res.status(400).json({ Status: 'F', message: 'order unresolved' });
    }

    const nextStatus = payment.paid ? 'paid' : 'awaiting_confirm';
    let forwarded = { sent: false, reason: 'payment not completed' };

    if (payment.paid) {
      // 先轉發給 Vercel 標記已付款並寄送 LINE／Email（此時訂單尚未 paid，才不會被當成已處理跳過），
      // 再由 Vultr 補寫一次作為保險。
      forwarded = await forwardPaidNotification(orderNo);
    }

    let stored = false;
    try {
      await updateSupabaseOrder(orderNo, { status: nextStatus }, 'sinopac-webhook');
      stored = true;
    } catch (e) {
      console.error('[sinopac notify] supabase write failed', e.message);
    }

    // 已付款事件若既沒有被 Vercel 接手，也沒有寫入 Supabase，就不能回覆成功，
    // 否則銀行可能停止重送而留下永久漏單。
    if (!canAcknowledgePaymentWebhook(payment, forwarded, stored)) {
      return res.status(503).json({ Status: 'F', OrderNo: orderNo, message: 'payment persistence unavailable' });
    }
    console.log(`[sinopac notify] order ${orderNo} -> ${nextStatus}`);

    return res.json({
      Status: 'S',
      OrderNo: orderNo,
      updated: nextStatus,
      notificationForwarded: payment.paid ? forwarded.sent : undefined,
    });
  } catch (error) {
    console.error('[sinopac notify] update failed', error.message);
    return res.status(503).json({ Status: 'F', error: 'payment notification processing failed' });
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
  summarizePaymentWebhook,
  isPaidLike,
  isPendingLike,
  getSinopacPaymentError,
  buildCreateBody,
  buildAuthoritativeCreateBody,
  formatSinopacDeadline,
  buildQueryBody,
  buildPaymentResultUrl,
  resolvePaymentQueryState,
  extractServerPaymentLink,
  paymentMethodFromRequest,
  normalizeLookupCode,
  normalizePhone,
  createGuestAccessToken,
  verifyGuestAccessToken,
  sendGuestOrderCreatedEmail,
  forwardPaidNotification,
  retryPendingPaymentNotifications,
  canAcknowledgePaymentWebhook,
};
