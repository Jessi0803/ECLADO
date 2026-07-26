import {
  PAYMENT_REQUEST_TIMEOUT_MS,
  SINOPAC_PAYMENT_API,
} from '../domain/payments.js';

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
    return data.response || {};
  } finally {
    clearTimeout(timeout);
  }
}
