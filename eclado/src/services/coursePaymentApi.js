import { assertPaymentEnabled, PAYMENT_API_URL } from '../config/runtime.js';
import { PAYMENT_REQUEST_TIMEOUT_MS } from '../domain/payments.js';
import { supabase } from './supabase.js';

export async function coursePayment(action, orderId, paymentMethod) {
  assertPaymentEnabled();
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error('請先登入會員');
  const response = await fetch(`${PAYMENT_API_URL}/api/courses/payment/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ orderId, ...(action === 'start' && { paymentMethod }) }),
    signal: AbortSignal.timeout(PAYMENT_REQUEST_TIMEOUT_MS),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error || '無法取得課程付款資訊');
  return result;
}
