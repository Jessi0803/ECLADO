// Best-effort diagnostics: never await telemetry from checkout or store form data.
const QUEUE_KEY = 'eclado.checkout.events.v1';
const FLOW_KEY = 'eclado.checkout.flow.v1';
const MAX_AGE = 86400000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let queue = [];
let initialized = false;
let timer;
let sending = false;
let retryMs = 2000;
let notBefore = 0;
let active = null;
let lastFlow = null;

function persist() {
  try { sessionStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch { /* Memory queue still works. */ }
}

function schedule(delay = 500) {
  if (timer || !queue.length) return;
  timer = setTimeout(() => { timer = null; void flushCheckoutEvents(); }, Math.max(delay, notBefore - Date.now()));
}

export async function flushCheckoutEvents() {
  if (sending || !queue.length || navigator.onLine === false || Date.now() < notBefore) return;
  queue = queue.filter(event => Date.parse(event.occurred_at) > Date.now() - MAX_AGE).slice(-40);
  if (!queue.length) { persist(); return; }
  sending = true;
  const batch = queue.slice(0, 10);
  try {
    const response = await fetch('/api/checkout-events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: batch }), keepalive: true, signal: AbortSignal.timeout(3000),
    });
    if (response.ok || response.status === 400 || response.status === 415) {
      // Drop malformed batches; retry only transient failures. New events may
      // have arrived while the request was in flight, so remove by event ID.
      const ids = new Set(batch.map(event => event.event_id));
      queue = queue.filter(event => !ids.has(event.event_id));
      retryMs = 2000;
      notBefore = 0;
    } else {
      retryMs = Math.min(retryMs * 2, 60000);
      if (response.status === 429) {
        notBefore = Date.now() + Math.min(900, Math.max(1, Number(response.headers.get('Retry-After')) || 900)) * 1000;
      }
    }
  } catch { retryMs = Math.min(retryMs * 2, 60000); }
  finally { sending = false; persist(); schedule(retryMs); }
}

function initialize() {
  if (initialized) return;
  initialized = true;
  try {
    const saved = JSON.parse(sessionStorage.getItem(QUEUE_KEY) || '[]');
    if (Array.isArray(saved)) queue = saved.filter(event => event && UUID.test(event.event_id)
      && Date.parse(event.occurred_at) > Date.now() - MAX_AGE).slice(-40);
  } catch { /* Storage can be blocked or corrupted. */ }
  window.addEventListener('online', () => { active?.record('network_online'); schedule(0); });
  window.addEventListener('offline', () => active?.record('network_offline'));
  window.addEventListener('pagehide', () => { active?.record('page_hidden'); void flushCheckoutEvents(); });
  // No raw exception, rejection reason, stack, script URL or full user agent.
  window.addEventListener('error', event => { if (event instanceof ErrorEvent) active?.record('runtime_error', { error_kind: 'runtime' }); });
  window.addEventListener('unhandledrejection', () => active?.record('runtime_error', { error_kind: 'runtime' }));
  schedule();
}

export function checkoutErrorDetails(error) {
  const status = Number(error?.status);
  const code = String(error?.code || '');
  return {
    error_kind: ['AbortError', 'TimeoutError'].includes(error?.name) ? 'timeout'
      : /fetch|network|load failed/i.test(String(error?.message || '')) ? 'network'
        : status >= 400 && status <= 599 ? 'http' : 'service',
    error_code: /^(PGRST[0-9]{3}|[0-9]{5}|E[0-9]{4})$/.test(code) ? code : null,
    http_status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
  };
}

export function beginCheckoutAttempt() {
  // Fail closed for telemetry only; even storage/crypto failures cannot block payment.
  try {
    initialize();
    let previous = lastFlow;
    try { previous = JSON.parse(sessionStorage.getItem(FLOW_KEY) || 'null') || lastFlow; } catch { /* Use memory when storage is unavailable. */ }
    const flowId = UUID.test(previous?.flowId) && Date.now() - previous.updatedAt < MAX_AGE ? previous.flowId : crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    const previousId = flowId === previous?.flowId && UUID.test(previous?.attemptId) ? previous.attemptId : null;
    lastFlow = { flowId, attemptId, updatedAt: Date.now() };
    try { sessionStorage.setItem(FLOW_KEY, JSON.stringify(lastFlow)); } catch { /* Optional. */ }
    const started = performance.now();
    let orderId = null;
    const attempt = {
      trace: { flowId, attemptId },
      setOrder(id) { orderId = /^ECL-[A-Za-z0-9-]{1,90}$/.test(id) ? id : null; },
      record(event, details = {}) {
        try {
          const version = String(import.meta.env.VITE_BUILD_ID || import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA || 'unversioned');
          queue.push({ event_id: crypto.randomUUID(), flow_id: flowId, attempt_id: attemptId,
            previous_attempt_id: previousId, order_id: orderId, event_name: event,
            occurred_at: new Date().toISOString(), elapsed_ms: Math.min(Math.round(performance.now() - started), MAX_AGE),
            online: navigator.onLine, visibility: document.visibilityState,
            app_version: /^[A-Za-z0-9._-]{1,64}$/.test(version) ? version : null,
            error_kind: details.error_kind, error_code: details.error_code, http_status: details.http_status });
          queue = queue.slice(-40);
          persist();
          schedule();
        } catch { /* Diagnostics must not change checkout behavior. */ }
      },
      finish() { attempt.record('attempt_finished'); if (active === attempt) active = null; },
    };
    active = attempt;
    attempt.record('submit_started');
    return attempt;
  } catch {
    return { trace: null, setOrder() {}, record() {}, finish() {} };
  }
}

// Import is safe during server-side tooling; queue recovery starts when the
// browser loads this module, including after reload without a new submission.
if (typeof window !== 'undefined') {
  try { initialize(); } catch { /* Browser restrictions must not affect rendering. */ }
}
