const crypto = require('node:crypto');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BROWSER_EVENTS = new Set(['submit_started', 'quote_requested', 'quote_received', 'order_requested',
  'order_received', 'payment_requested', 'payment_received', 'recovery_saved', 'checkout_ready',
  'checkout_error', 'error_shown', 'attempt_finished', 'page_hidden', 'network_offline', 'network_online', 'runtime_error']);
const ERROR_KINDS = new Set(['timeout', 'network', 'http', 'runtime', 'service', 'unknown']);
const SERVER_EVENTS = new Set(['payment_api_received', 'payment_claimed', 'gateway_requested',
  'gateway_succeeded', 'gateway_rejected', 'payment_saved', 'payment_api_error', 'payment_response_ready']);

function traceIds(value) {
  if (!value || !UUID.test(value.flowId) || !UUID.test(value.attemptId)) return null;
  return { flow_id: value.flowId.toLowerCase(), attempt_id: value.attemptId.toLowerCase() };
}

function safeOrderId(value) {
  return typeof value === 'string' && /^ECL-[A-Za-z0-9-]{1,90}$/.test(value) ? value : null;
}

function safeError(error) {
  const code = String(error?.code || '');
  const status = Number(error?.status);
  return {
    error_kind: error?.name === 'AbortError' || error?.name === 'TimeoutError' ? 'timeout'
      : /fetch|network|load failed/i.test(String(error?.message || '')) ? 'network'
        : status >= 400 && status <= 599 ? 'http' : 'service',
    error_code: /^(PGRST[0-9]{3}|[0-9]{5}|E[0-9]{4})$/.test(code) ? code : null,
    http_status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
  };
}

function validateBrowserBatch(body, now = Date.now()) {
  if (!body || JSON.stringify(body).length > 16000 || !Array.isArray(body.events)
      || body.events.length < 1 || body.events.length > 10) throw new Error('Invalid batch');
  return body.events.map(value => {
    const ids = traceIds({ flowId: value?.flow_id, attemptId: value?.attempt_id });
    const time = Date.parse(value?.occurred_at);
    if (!ids || !UUID.test(value?.event_id) || !BROWSER_EVENTS.has(value?.event_name)
        || !Number.isFinite(time) || time < now - 86400000 || time > now + 300000
        || (value.previous_attempt_id != null && !UUID.test(value.previous_attempt_id))) throw new Error('Invalid event');
    // Construct a new object; never persist arbitrary client metadata or source.
    return {
      event_id: value.event_id.toLowerCase(), ...ids,
      previous_attempt_id: value.previous_attempt_id?.toLowerCase() || null,
      order_id: safeOrderId(value.order_id), event_name: value.event_name,
      occurred_at: new Date(time).toISOString(),
      elapsed_ms: Number.isInteger(value.elapsed_ms) && value.elapsed_ms >= 0 && value.elapsed_ms <= 86400000 ? value.elapsed_ms : null,
      online: typeof value.online === 'boolean' ? value.online : null,
      visibility: ['visible', 'hidden', 'prerender'].includes(value.visibility) ? value.visibility : null,
      error_kind: ERROR_KINDS.has(value.error_kind) ? value.error_kind : null,
      error_code: /^(PGRST[0-9]{3}|[0-9]{5}|E[0-9]{4})$/.test(value.error_code) ? value.error_code : null,
      http_status: Number.isInteger(value.http_status) && value.http_status >= 100 && value.http_status <= 599 ? value.http_status : null,
      app_version: typeof value.app_version === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(value.app_version) ? value.app_version : null,
    };
  });
}

function createPaymentTrace(trace, orderId, { url, key, fetchImpl = fetch } = {}) {
  const ids = traceIds(trace);
  const rows = [];
  const started = Date.now();
  return {
    record(event, error) {
      if (!ids || !SERVER_EVENTS.has(event)) return;
      rows.push({ event_id: crypto.randomUUID(), ...ids, order_id: safeOrderId(orderId),
        source: 'payment_api', event_name: event, occurred_at: new Date().toISOString(),
        elapsed_ms: Math.min(Date.now() - started, 86400000), ...(error ? safeError(error) : {}) });
    },
    async flush() {
      if (!ids || !rows.length || !url || !key) return;
      const batch = rows.splice(0);
      try {
        const response = await fetchImpl(`${url}/rest/v1/checkout_events?on_conflict=event_id`, {
          method: 'POST', signal: AbortSignal.timeout(2000),
          headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
            Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify(batch),
        });
        if (!response.ok) console.warn('[checkout-events] write unavailable');
      } catch { console.warn('[checkout-events] write unavailable'); }
    },
  };
}

module.exports = { traceIds, safeOrderId, safeError, validateBrowserBatch, createPaymentTrace };
