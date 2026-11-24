// A capability for one submission, scoped to the current identity. No form data.
const PREFIX = 'eclado_order_request_v1:';
const memory = new Map();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const owner = id => id || 'guest';

export function getCheckoutRequest(userId) {
  const identity = owner(userId);
  try {
    const saved = JSON.parse(sessionStorage.getItem(PREFIX + identity) || 'null');
    if (saved?.owner === identity && uuid.test(saved.key) && /^[0-9a-f]{64}$/.test(saved.secret)) {
      memory.set(identity, saved);
      return saved;
    }
  } catch { /* Keep an in-flight capability in memory if storage stops working. */ }
  return memory.get(identity) || null;
}

export function prepareCheckoutRequest(userId) {
  const identity = owner(userId);
  const request = getCheckoutRequest(userId) || {
    owner: identity,
    key: crypto.randomUUID(),
    secret: Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join(''),
  };
  // Never send a new order if its recovery capability cannot survive a reload.
  try {
    const value = JSON.stringify(request);
    sessionStorage.setItem(PREFIX + identity, value);
    if (sessionStorage.getItem(PREFIX + identity) !== value) throw new Error();
  } catch {
    throw new Error('瀏覽器無法保存訂單恢復資訊，請開啟儲存空間後再試。');
  }
  memory.set(identity, request);
  return request;
}

export function clearCheckoutRequest(userId) {
  const identity = owner(userId);
  try { sessionStorage.removeItem(PREFIX + identity); } catch { return; }
  memory.delete(identity);
}

export function isDefiniteOrderRejection(error) {
  // SQL exceptions roll back the transaction; transport/proxy errors do not
  // prove that an order was not committed.
  return !['42501', '55000'].includes(error?.code)
    && (/^[0-9A-Z]{5}$/.test(error?.code || '') || error?.code === 'PGRST202');
}
