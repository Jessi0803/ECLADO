import {
  PAYMENT_REQUEST_TIMEOUT_MS,
  SINOPAC_PAYMENT_API,
} from '../domain/payments.js';
import { supabase } from './supabase.js';

async function memberAuthorizationHeaders() {
  const { data } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token || '';
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

export async function createSinopacPayment(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAYMENT_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${SINOPAC_PAYMENT_API}/api/sinopac/create-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `金流建立失敗（HTTP ${response.status}）`);
    }
    const deadline = data.request?.ATMParam
      ? {
          expireDate: data.request.ATMParam.ExpireDate || '',
          expireTime: data.request.ATMParam.ExpireTime || '',
        }
      : null;
    return {
      response: data.response || {},
      paymentDeadline: deadline,
      order: data.order || null,
      recoveryStored: data.recoveryStored === true,
      guestLookupCode: data.guestLookupCode || '',
      orderEmailSent: data.orderEmailSent === true,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function querySinopacPayment({ orderNo, paymentToken, guestAccessToken }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAYMENT_REQUEST_TIMEOUT_MS);
  try {
    const authHeaders = await memberAuthorizationHeaders();
    const response = await fetch(`${SINOPAC_PAYMENT_API}/api/sinopac/query-payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        orderNo,
        paymentToken: paymentToken || undefined,
        guestAccessToken: guestAccessToken || undefined,
      }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `付款查詢失敗（HTTP ${response.status}）`);
    }
    return {
      response: data.response || {},
      order: data.order || null,
      paymentState: data.paymentState || '',
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function lookupGuestOrder({ lookupCode, phone }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAYMENT_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${SINOPAC_PAYMENT_API}/api/orders/guest-lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lookupCode, phone }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `訪客訂單查詢失敗（HTTP ${response.status}）`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getMemberPaymentInstructions(orderNo) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAYMENT_REQUEST_TIMEOUT_MS);
  try {
    const authHeaders = await memberAuthorizationHeaders();
    if (!authHeaders.Authorization) throw new Error('請先登入會員');
    const response = await fetch(`${SINOPAC_PAYMENT_API}/api/orders/payment-instructions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ orderNo }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `付款資訊讀取失敗（HTTP ${response.status}）`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}
