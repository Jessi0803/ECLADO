const crypto = require('crypto');
const { buildBrandedEmailHtml } = require('../_email-template.js');

const DEFAULT_SUPABASE_URL = 'https://ilvdvlkdpntwmaijncaz.supabase.co';
const DEFAULT_QPAY_API_BASE = 'https://apisbx.sinopac.com/funBIZ-Sbx/QPay.WebAPI/api/';

const INVENTORY_ACTIVE_STATUSES = new Set(['paid', 'preparing', 'ready_for_pickup', 'picked_up', 'shipped', 'delivered']);

function parseBody(body) {
  if (!body) return {};
  if (typeof body === 'object') return body;
  if (typeof body !== 'string') return {};

  try {
    return JSON.parse(body);
  } catch {
    const params = new URLSearchParams(body);
    return Object.fromEntries(params.entries());
  }
}

function pickPayload(raw) {
  const body = parseBody(raw);
  const nested = body.response || body.Response || body.data || body.Data || {};
  return { ...body, ...(typeof nested === 'object' && nested ? nested : {}) };
}

function pickQuery(query) {
  return query && typeof query === 'object' ? query : {};
}

function payloadValue(payload, key) {
  if (!payload || typeof payload !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(payload, key)) return payload[key];

  const wanted = String(key).toLowerCase();
  const actualKey = Object.keys(payload).find(candidate => candidate.toLowerCase() === wanted);
  return actualKey ? payload[actualKey] : undefined;
}

function firstText(payload, keys) {
  for (const key of keys) {
    const value = payloadValue(payload, key);
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

function getOrderId(payload) {
  return firstText(payload, [
    'orderNo', 'OrderNo', 'order_no',
    'orderId', 'OrderId', 'order_id',
    'MerchantOrderNo', 'merchantOrderNo',
    'MasterOrderNo', 'masterOrderNo',
    'MerchantTradeNo', 'merchantTradeNo',
    'Param1', 'param1',
  ]);
}

function getAmount(payload) {
  const raw = firstText(payload, ['amount', 'Amount', 'Amt', 'Total', 'total', 'PayAmount', 'payAmount']);
  if (!raw) return null;
  const amount = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

function getPayToken(payload) {
  return firstText(payload, ['PayToken', 'payToken', 'pay_token']);
}

function getShopNo(payload) {
  return firstText(payload, ['ShopNo', 'shopNo', 'shop_no']) || process.env.SINOPAC_SHOP_NO || '';
}

function summarizePaymentPayload(payload) {
  return {
    keys: payload && typeof payload === 'object'
      ? Object.keys(payload).filter(key => key !== '__tokenOrder').sort()
      : [],
    orderId: getOrderId(payload) || undefined,
    shopNo: getShopNo(payload) || undefined,
    payType: firstText(payload, ['PayType', 'payType']) || undefined,
    payStatus: firstText(payload, ['PayStatus', 'payStatus']) || undefined,
    hasPayToken: Boolean(getPayToken(payload)),
  };
}

function amountsMatch(orderTotal, notifiedAmount) {
  if (notifiedAmount === null) return true;
  const total = Number(orderTotal);
  if (!Number.isFinite(total)) return false;
  return total === notifiedAmount || Math.round(total * 100) === notifiedAmount;
}

function isFailedPayment(payload) {
  const status = firstText(payload, ['Status', 'status']).toUpperCase();
  const payStatus = firstText(payload, ['PayStatus', 'payStatus', 'pay_status']).toUpperCase();
  const result = firstText(payload, ['Result', 'result', 'TradeStatus', 'tradeStatus']).toUpperCase();
  const failureValues = new Set(['F', 'FAIL', 'FAILED', 'ERROR', 'CANCEL', 'CANCELLED', 'N', 'NO', '0']);
  return [status, payStatus, result].some(value => failureValues.has(value));
}

function getHeader(req, name) {
  if (typeof req?.get === 'function') return req.get(name) || '';
  const headers = req?.headers || {};
  const wanted = String(name).toLowerCase();
  const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === wanted);
  const value = key ? headers[key] : '';
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function hasValidPaymentNotifySecret(req) {
  const expected = String(process.env.PAYMENT_NOTIFY_SECRET || '');
  const received = String(getHeader(req, 'x-eclado-payment-secret') || '');
  if (!expected || !received) return false;

  const expectedBuffer = Buffer.from(expected, 'utf8');
  const receivedBuffer = Buffer.from(received, 'utf8');
  return expectedBuffer.length === receivedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

async function supabaseRequest(path, options = {}) {
  const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!serviceKey) throw new Error('SUPABASE_SERVICE_KEY not set');

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'X-ECLADO-Audit-Source': 'sinopac-notify',
    ...(options.headers || {}),
  };

  if (options.returnRepresentation) headers.Prefer = 'return=representation';

  const { returnRepresentation, ...fetchOptions } = options;
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...fetchOptions,
    headers,
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = body?.message || body?.error || text || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return body;
}

async function claimPaymentNotification(orderId) {
  return supabaseRequest('rpc/claim_order_payment_notification', {
    method: 'POST',
    body: JSON.stringify({ p_order_id: orderId }),
  });
}

async function completePaymentNotification(orderId, result) {
  return supabaseRequest('rpc/complete_order_payment_notification', {
    method: 'POST',
    body: JSON.stringify({
      p_order_id: orderId,
      p_sent: result.sent === true,
      p_channel: result.channel || null,
      p_error: result.sent ? null : String(result.reason || 'notification delivery failed').slice(0, 1000),
    }),
  });
}

async function readJsonResponse(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function findOrderByPayToken(payToken) {
  if (!payToken) return null;
  const query = [
    `note=ilike.${encodeURIComponent(`*pay_token:${payToken}*`)}`,
    'select=id,status,total,user_id,member,email',
    'limit=1',
  ].join('&');
  const orders = await supabaseRequest(`orders?${query}`, { method: 'GET' });
  return orders?.[0] || null;
}

function getQpayHashKeys() {
  const raw = process.env.SINOPAC_QPAY_HASH_KEYS || process.env.SINOPAC_HASH_KEYS || '';
  return raw.split(',').map(key => key.trim().toLowerCase()).filter(Boolean);
}

function xorBuffers(a, b) {
  return Buffer.from(a.map((value, index) => value ^ b[index]));
}

function getAesKey() {
  const keys = getQpayHashKeys();
  if (keys.length < 4) return '';

  const parts = keys.slice(0, 4).map(key => Buffer.from(key.replace(/-/g, '').slice(0, 16), 'hex'));
  if (parts.some(part => part.length !== 8)) return '';

  return Buffer.concat([
    xorBuffers(parts[0], parts[1]),
    xorBuffers(parts[2], parts[3]),
  ]).toString('hex').toUpperCase();
}

function hasOrderPayQueryConfig() {
  return Boolean(
    process.env.SINOPAC_PAYMENT_QUERY_URL
    || process.env.SINOPAC_ORDER_PAY_QUERY_URL
    || (
      (process.env.SINOPAC_QPAY_X_KEY_ID || process.env.SINOPAC_QPAY_APIM_AUTH || process.env.SINOPAC_APIM_AUTH)
      && getAesKey()
    ),
  );
}

function signString(record) {
  return Object.keys(record)
    .filter(key => {
      const value = record[key];
      return value !== undefined
        && value !== null
        && typeof value !== 'object'
        && String(value).trim();
    })
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(key => `${key}=${record[key]}`)
    .join('&');
}

function generateQpaySign(record, aesKey, nonce) {
  return crypto
    .createHash('sha256')
    .update(`${signString(record)}${nonce}${aesKey}`, 'utf8')
    .digest('hex')
    .toUpperCase();
}

function qpayIv(nonce) {
  return crypto.createHash('sha256').update(nonce).digest('hex').toUpperCase().slice(-16);
}

function encryptQpayMessage(aesKey, nonce, data) {
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(aesKey, 'ascii'), Buffer.from(qpayIv(nonce), 'ascii'));
  return Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]).toString('hex').toUpperCase();
}

function decryptQpayMessage(aesKey, nonce, message) {
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(aesKey, 'ascii'), Buffer.from(qpayIv(nonce), 'ascii'));
  return Buffer.concat([decipher.update(Buffer.from(message, 'hex')), decipher.final()]).toString('utf8');
}

function normalizeOrderPayQueryResult(body) {
  const root = body?.response || body?.Response || body?.data || body?.Data || body;
  if (!root || typeof root !== 'object') return null;

  const content = root.TSResultContent || root.tsResultContent || root.result || root.Result || root;
  if (!content || typeof content !== 'object') return null;

  return {
    ...content,
    PayToken: content.PayToken || root.PayToken,
    __orderPayQuery: root,
  };
}

async function queryOrderPayViaProxy(shopNo, payToken) {
  const url = process.env.SINOPAC_PAYMENT_QUERY_URL || process.env.SINOPAC_ORDER_PAY_QUERY_URL;
  if (!url) return null;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ShopNo: shopNo, PayToken: payToken }),
  });
  const body = await readJsonResponse(response).catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    throw new Error(body?.error || body?.message || `OrderPayQuery proxy HTTP ${response.status}`);
  }
  return normalizeOrderPayQueryResult(body);
}

async function queryOrderPayDirect(shopNo, payToken) {
  const aesKey = getAesKey();
  const xKeyId = process.env.SINOPAC_QPAY_X_KEY_ID || process.env.SINOPAC_QPAY_APIM_AUTH || process.env.SINOPAC_APIM_AUTH || '';
  if (!shopNo || !payToken || !aesKey || !xKeyId) return null;

  const apiBase = (process.env.SINOPAC_QPAY_API_BASE || DEFAULT_QPAY_API_BASE).replace(/\/?$/, '/');
  const headers = { 'Content-Type': 'application/json', 'X-KeyID': xKeyId };

  const nonceResponse = await fetch(`${apiBase}Nonce`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ShopNo: shopNo }),
  });
  const nonceBody = await readJsonResponse(nonceResponse).catch(() => ({}));
  if (!nonceResponse.ok || !nonceBody?.Nonce) {
    throw new Error(nonceBody?.Description || nonceBody?.error || `QPay Nonce HTTP ${nonceResponse.status}`);
  }

  const request = { ShopNo: shopNo, PayToken: payToken };
  const nonce = nonceBody.Nonce;
  const message = {
    Version: '1.0.0',
    ShopNo: shopNo,
    APIService: 'OrderPayQuery',
    Nonce: nonce,
    Message: encryptQpayMessage(aesKey, nonce, JSON.stringify(request)),
    Sign: generateQpaySign(request, aesKey, nonce),
  };

  const response = await fetch(`${apiBase}Order`, {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
  });
  const body = await readJsonResponse(response).catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.Description || body?.error || `QPay OrderPayQuery HTTP ${response.status}`);
  }
  if (!body?.Message || !body?.Nonce) {
    throw new Error('QPay OrderPayQuery response missing encrypted message');
  }

  const decoded = JSON.parse(decryptQpayMessage(aesKey, body.Nonce, body.Message));
  const expectedSign = generateQpaySign(decoded, aesKey, body.Nonce);
  if (body.Sign && expectedSign !== body.Sign) {
    throw new Error('QPay OrderPayQuery response sign validate failed');
  }

  return normalizeOrderPayQueryResult(decoded);
}

async function queryOrderPay(shopNo, payToken) {
  if (!shopNo || !payToken) return null;

  const attempts = [
    () => queryOrderPayViaProxy(shopNo, payToken),
    () => queryOrderPayDirect(shopNo, payToken),
  ];

  for (const attempt of attempts) {
    const result = await attempt();
    if (result) return result;
  }
  return null;
}

function buildPaymentMessage(order) {
  return [
    '您的訂單已付款完成。',
    '',
    `訂單編號：${order.id}`,
    Number.isFinite(Number(order.total)) ? `付款金額：NT$ ${Number(order.total).toLocaleString('zh-TW')}` : null,
    '',
    '我們會盡快安排備貨與出貨，感謝您的支持。',
  ].filter(line => line !== null).join('\n');
}

function buildPaymentEmail(order) {
  return [
    `${order.member || '您好'}，您的訂單已付款完成。`,
    '',
    `訂單編號：${order.id}`,
    Number.isFinite(Number(order.total)) ? `付款金額：NT$ ${Number(order.total).toLocaleString('zh-TW')}` : null,
    '',
    '我們會盡快安排備貨與出貨，感謝您的支持。',
    '',
    'ECLADO Taiwan',
  ].filter(line => line !== null).join('\n');
}

async function sendPaymentEmailNotice(order, fallbackEmail = '') {
  const email = order?.email || fallbackEmail;
  if (!email) return { sent: false, reason: 'order has no email' };

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: 'RESEND_API_KEY not set' };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.ORDER_EMAIL_FROM || 'ECLADO <service@ecladotaiwan.com>',
      to: [email],
      subject: `ECLADO 訂單已付款完成｜${order.id}`,
      text: buildPaymentEmail(order),
      html: buildBrandedEmailHtml(buildPaymentEmail(order)),
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return { sent: false, reason: body?.message || body?.error || `Resend HTTP ${response.status}` };
  }

  return { sent: true };
}

async function pushLinePaymentNotice(order) {
  if (!order?.user_id) return { sent: false, reason: 'order has no user_id', fallbackEmail: '' };

  const profiles = await supabaseRequest(
    `profiles?id=eq.${encodeURIComponent(order.user_id)}&select=line_user_id,email`,
    { method: 'GET' },
  );
  const lineUserId = profiles?.[0]?.line_user_id;
  if (!lineUserId) return { sent: false, reason: 'profile has no line_user_id', fallbackEmail: profiles?.[0]?.email || '' };

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { sent: false, reason: 'LINE_CHANNEL_ACCESS_TOKEN not set' };

  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [{ type: 'text', text: buildPaymentMessage(order) }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    return { sent: false, reason: error || `LINE HTTP ${response.status}` };
  }

  return { sent: true };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!hasValidPaymentNotifySecret(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const payload = { ...pickQuery(req.query), ...pickPayload(req.body) };
  let orderId = '';

  try {
    const payToken = getPayToken(payload);
    const shopNo = getShopNo(payload);
    if (payToken) {
      try {
        const orderPayResult = await queryOrderPay(shopNo, payToken);
        if (orderPayResult) {
          Object.assign(payload, orderPayResult);
        } else if (hasOrderPayQueryConfig()) {
          console.warn('[sinopac notify] OrderPayQuery skipped or unavailable', summarizePaymentPayload(payload));
        }
      } catch (error) {
        console.warn('[sinopac notify] OrderPayQuery failed; falling back to local token lookup', {
          ...summarizePaymentPayload(payload),
          error: error.message || String(error),
        });
      }
    }

    orderId = getOrderId(payload);
    if (!orderId) {
      const tokenOrder = await findOrderByPayToken(payToken);
      if (tokenOrder) {
        orderId = tokenOrder.id;
        payload.__tokenOrder = tokenOrder;
      } else {
        console.warn('[sinopac notify] missing order id', summarizePaymentPayload(payload));
        return res.status(400).json({ ok: false, error: 'orderNo required' });
      }
    }
    if (isFailedPayment(payload)) {
      return res.status(200).json({ ok: true, orderId, ignored: true, reason: 'payment not successful' });
    }

    let order = payload.__tokenOrder;
    if (!order) {
      const orders = await supabaseRequest(
        `orders?id=eq.${encodeURIComponent(orderId)}&select=id,status,total,user_id,member,email,payment_notification_sent_at,payment_notification_next_retry_at`,
        { method: 'GET' },
      );
      order = orders?.[0];
    }
    if (!order) return res.status(404).json({ ok: false, error: 'order not found', orderId });

    const notifiedAmount = getAmount(payload);
    if (!amountsMatch(order.total, notifiedAmount)) {
      console.warn('[sinopac notify] amount mismatch', {
        orderId,
        orderTotal: order.total,
        notifiedAmount,
        payload: summarizePaymentPayload(payload),
      });
      return res.status(400).json({ ok: false, error: 'amount mismatch', orderId });
    }

    if (order.payment_notification_sent_at) {
      return res.status(200).json({ ok: true, orderId, status: order.status, alreadyPaid: true, lineSent: false });
    }

    let paidOrder = order;
    if (!INVENTORY_ACTIVE_STATUSES.has(order.status)) {
      const updated = await supabaseRequest(`orders?id=eq.${encodeURIComponent(orderId)}`, {
        method: 'PATCH',
        returnRepresentation: true,
        body: JSON.stringify({ status: 'paid' }),
      });
      paidOrder = updated?.[0] || { ...order, status: 'paid' };
    }

    const claim = await claimPaymentNotification(orderId);
    if (!claim?.claimed) {
      return res.status(200).json({
        ok: true,
        orderId,
        status: paidOrder.status,
        notificationPending: true,
        retryAt: claim?.next_retry_at || order.payment_notification_next_retry_at || null,
      });
    }

    const line = await pushLinePaymentNotice(paidOrder);
    const email = line.sent ? { sent: false } : await sendPaymentEmailNotice(paidOrder, line.fallbackEmail);
    const delivery = line.sent
      ? { sent: true, channel: 'line' }
      : email.sent
        ? { sent: true, channel: 'email' }
        : { sent: false, reason: email.reason || line.reason || 'notification delivery failed' };
    await completePaymentNotification(orderId, delivery);

    if (!delivery.sent) {
      return res.status(503).json({
        ok: false,
        orderId,
        status: paidOrder.status,
        error: 'payment recorded but customer notification failed',
      });
    }

    return res.status(200).json({
      ok: true,
      orderId,
      status: 'paid',
      lineSent: line.sent,
      lineReason: line.sent ? undefined : line.reason,
      emailSent: email.sent,
      emailReason: email.sent || line.sent ? undefined : email.reason,
    });
  } catch (error) {
    console.error('[sinopac notify]', error.message || String(error));
    return res.status(500).json({ ok: false, error: error.message || String(error), orderId });
  }
};

// 內部函式匯出，僅供測試使用（Vercel 只會把預設匯出當 handler 呼叫，附加屬性不影響）。
module.exports.__test = {
  getAesKey,
  qpayIv,
  encryptQpayMessage,
  decryptQpayMessage,
  generateQpaySign,
  signString,
  isFailedPayment,
  getAmount,
  amountsMatch,
  getOrderId,
  getPayToken,
  summarizePaymentPayload,
  hasValidPaymentNotifySecret,
};
