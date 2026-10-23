const crypto = require('node:crypto');
const CODES = require('./sinopac-status-codes.json');
const SOURCES = new Set(['create', 'retry', 'query', 'notify', 'return', 'assisted_create']);
function messageCode(value) {
  return /^(?:E|S|M)\d{4}(?=$|[^A-Za-z0-9])/i.exec(String(value || '').trim())?.[0]?.toUpperCase() || null;
}
function token(value, expression) {
  return typeof value === 'string' && expression.test(value) ? value : null;
}
function extractDiagnostic(context, response, error) {
  if (!context || !/^ECL-[A-Za-z0-9-]{1,90}$/.test(context.orderId)
      || !/^ECL-[A-Za-z0-9-]{1,90}$/.test(context.providerOrderNo) || !SOURCES.has(context.source)) return null;
  const api = context.apiService;
  if (!['OrderCreate', 'OrderQuery', 'OrderPayQuery'].includes(api)) return null;
  let detail = null;
  if (api === 'OrderPayQuery') {
    // Only a cryptographically verified bank response bound to this provider
    // reference can supply card/transaction diagnostics. Never use callback body.
    if (!response?.TSResultContent || response.TSResultContent.OrderNo !== context.providerOrderNo) return null;
    detail = response.TSResultContent;
  }
  let order = null;
  if (api === 'OrderQuery' && Array.isArray(response?.OrderList)) {
    order = response.OrderList.find(row => row?.OrderNo === context.providerOrderNo);
    if (response.OrderList.length && !order) return null;
  }
  if (api === 'OrderQuery' && ['notify','return'].includes(context.source) && !order) return null;
  const info = error?.sinopacDiagnostic;
  const status = Number(info?.httpStatus);
  const failureKind = ['bank_http', 'network', 'timeout', 'response_integrity', 'configuration'].includes(info?.kind) ? info.kind : null;
  // Unexpected local failures are not bank failures and cannot attest to a bank result.
  if (error && !failureKind) return null;
  const apiCode = messageCode(response?.Description);
  const transactionCode = messageCode(detail?.Description || order?.Description);
  const row = {
    order_id: context.orderId, provider_order_no: context.providerOrderNo,
    attempt_no: Math.max(1, Math.min(9999, Number(/-R(\d+)$/.exec(context.providerOrderNo)?.[1]) || 1)),
    source: context.source, api_service: api,
    api_status: token(response?.Status, /^[SF]$/), api_message_code: apiCode,
    transaction_status: token(detail?.Status, /^[SF]$/),
    transaction_type: token(detail?.APType, /^(PayOut|CaptureOut|RegularOut|RegularEnd|VARefundOut|CardBindOut)$/),
    transaction_message_code: transactionCode,
    pay_status: token(order?.PayStatus, /^[A-Z0-9]{1,12}$/),
    auth_response_code: token(detail?.AuthResponseCode == null ? null : String(detail.AuthResponseCode).toUpperCase(), /^[A-Z0-9]{1,3}$/),
    http_status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    failure_kind: failureKind,
  };
  // No arbitrary Description, card data, tokens, URLs, error message or stack.
  row.diagnostic_key = crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex');
  return row;
}
function createDiagnosticWriter({ url, key, fetchImpl }) {
  return async function record(context, response, error) {
    try {
      const row = extractDiagnostic(context, response, error);
      if (!row || !url || !key) return;
      const result = await (fetchImpl || globalThis.fetch)(`${url}/rest/v1/order_payment_diagnostics?on_conflict=diagnostic_key`, {
        method: 'POST', signal: AbortSignal.timeout(2000),
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
          Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(row),
      });
      if (!result.ok) console.warn('[payment diagnostics] save unavailable');
    } catch { console.warn('[payment diagnostics] save unavailable'); }
  };
}
// Runtime imports the catalog too, so candidate packaging cannot omit it silently.
if (!CODES.messages.S0000) throw new Error('Missing SinoPac status catalog');
module.exports = { extractDiagnostic, createDiagnosticWriter, messageCode };
