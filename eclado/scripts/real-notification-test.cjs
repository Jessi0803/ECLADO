const { existsSync, readFileSync } = require('fs');

const remindUnpaidOrders = require('../api/remind-unpaid-orders.js');
const sinopacNotify = require('../api/sinopac/notify.js');

const env = {
  ...loadEnvFile('.env.staging'),
  ...loadEnvFile('.env.notification-test'),
  ...process.env,
};

const config = {
  dbMode: env.NOTIFY_TEST_DB_MODE || 'mock',
  supabaseUrl: normalizeSupabaseUrl(env.NOTIFY_TEST_SUPABASE_URL || env.STAGING_SUPABASE_URL || env.SUPABASE_URL || ''),
  supabaseServiceKey: env.NOTIFY_TEST_SUPABASE_SERVICE_ROLE_KEY
    || env.STAGING_SUPABASE_SERVICE_ROLE_KEY
    || env.SUPABASE_SERVICE_ROLE_KEY
    || env.SUPABASE_SERVICE_KEY
    || '',
  email: env.NOTIFY_TEST_EMAIL || 'k0919933386@gmail.com',
  member: env.NOTIFY_TEST_MEMBER || 'Jessie',
  userId: env.NOTIFY_TEST_USER_ID || '53181d26-ace2-44bc-8ac5-150a6b49a791',
  lineUserId: env.NOTIFY_TEST_LINE_USER_ID || 'U6f71cfa36c3fb2188f54396a5cb58882',
  amount: Number(env.NOTIFY_TEST_AMOUNT || 1),
  lineToken: env.LINE_CHANNEL_ACCESS_TOKEN || '',
  resendApiKey: env.RESEND_API_KEY || '',
  from: env.ORDER_EMAIL_FROM || 'ECLADO <service@ecladotaiwan.com>',
};

const useSupabase = config.dbMode === 'supabase';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };
let cleanupOrderIds = [];

main().catch(error => {
  console.error(`failed: ${error.message || String(error)}`);
  process.exitCode = 1;
}).finally(async () => {
  if (useSupabase && cleanupOrderIds.length) {
    try {
      await cleanupDbOrders(cleanupOrderIds);
      console.log('db_cleanup=done');
    } catch (error) {
      console.error(`db_cleanup=failed:${error.message || String(error)}`);
      process.exitCode = 1;
    }
  }
  global.fetch = originalFetch;
  process.env = originalEnv;
});

async function main() {
  assertConfig();

  process.env.SUPABASE_URL = useSupabase ? config.supabaseUrl : '';
  process.env.SUPABASE_SERVICE_ROLE_KEY = useSupabase ? config.supabaseServiceKey : '';
  process.env.SUPABASE_SERVICE_KEY = useSupabase ? '' : 'real-notification-test-mock';
  process.env.LINE_CHANNEL_ACCESS_TOKEN = config.lineToken;
  process.env.RESEND_API_KEY = config.resendApiKey;
  process.env.ORDER_EMAIL_FROM = config.from;
  process.env.ORDER_PAYMENT_REMIND_MINUTES = '1';

  const runId = Date.now();
  const lineOrderId = `ECL-LINE-JESSIE-${runId}`;
  const emailOrderId = `ECL-EMAIL-JESSIE-${runId}`;
  const orders = new Map([
    [lineOrderId, makeOrder(lineOrderId, config.userId)],
    [emailOrderId, makeOrder(emailOrderId, null)],
  ]);

  if (useSupabase) {
    cleanupOrderIds = [lineOrderId, emailOrderId];
    await insertDbOrders([lineOrderId, emailOrderId]);
  }

  global.fetch = async (url, options = {}) => {
    const href = String(url);

    for (const [orderId, order] of orders) {
      if (href.includes(`/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=`) && options.method === 'GET') {
        return useSupabase ? originalFetch(url, options) : jsonResponse(200, [order]);
      }

      if (href.includes(`/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`) && options.method === 'PATCH') {
        const body = JSON.parse(options.body || '{}');
        if (body.status === 'paid') {
          const paidOrder = { ...order, status: 'paid' };
          orders.set(orderId, paidOrder);
          if (useSupabase) await originalFetch(url, options);
          return jsonResponse(200, [paidOrder]);
        }
        if (useSupabase) await originalFetch(url, options);
        return jsonResponse(200, []);
      }
    }

    if (href.includes('/rest/v1/orders?') && options.method === 'GET') {
      return jsonResponse(200, Array.from(orders.values()));
    }

    if (href.includes(`/rest/v1/profiles?id=eq.${encodeURIComponent(config.userId)}`)) {
      return jsonResponse(200, [{ line_user_id: config.lineUserId, email: config.email }]);
    }

    if (href === 'https://api.line.me/v2/bot/message/push' || href.startsWith('https://api.resend.com/')) {
      return originalFetch(url, options);
    }

    throw new Error(`Unexpected fetch: ${options.method || 'GET'} ${href}`);
  };

  console.log(`line_order=${lineOrderId}`);
  console.log(`email_order=${emailOrderId}`);

  const remind = await runReminder();
  const lineReminder = findResult(remind, lineOrderId);
  const emailReminder = findResult(remind, emailOrderId);
  console.log(`line_reminder=${JSON.stringify(pickNotifyResult(lineReminder))}`);
  console.log(`email_reminder=${JSON.stringify(pickNotifyResult(emailReminder))}`);

  const linePayment = await runPayment(lineOrderId);
  const emailPayment = await runPayment(emailOrderId);
  console.log(`line_payment=${JSON.stringify(pickPaymentResult(linePayment))}`);
  console.log(`email_payment=${JSON.stringify(pickPaymentResult(emailPayment))}`);

  const reminderEmail = await findResendEmail(emailOrderId, '付款提醒');
  const paymentEmail = await findResendEmail(emailOrderId, '訂單已付款完成');
  console.log(`reminder_email_status=${reminderEmail ? `${reminderEmail.id}:${reminderEmail.last_event || 'unknown'}` : 'not_found'}`);
  console.log(`payment_email_status=${paymentEmail ? `${paymentEmail.id}:${paymentEmail.last_event || 'unknown'}` : 'not_found'}`);

  const passed = lineReminder?.lineSent === true
    && lineReminder?.emailSent === false
    && emailReminder?.lineSent === false
    && emailReminder?.emailSent === true
    && linePayment.jsonBody?.lineSent === true
    && linePayment.jsonBody?.emailSent === false
    && emailPayment.jsonBody?.lineSent === false
    && emailPayment.jsonBody?.emailSent === true
    && reminderEmail
    && paymentEmail;

  console.log(`overall=${passed ? 'passed' : 'failed'}`);
  if (!passed) process.exitCode = 1;

  if (!passed) return;
}

function assertConfig() {
  const missing = [];
  if (!config.lineToken) missing.push('LINE_CHANNEL_ACCESS_TOKEN');
  if (!config.resendApiKey) missing.push('RESEND_API_KEY');
  if (!config.email) missing.push('NOTIFY_TEST_EMAIL');
  if (!config.lineUserId) missing.push('NOTIFY_TEST_LINE_USER_ID');
  if (useSupabase && !config.supabaseUrl) missing.push('NOTIFY_TEST_SUPABASE_URL or STAGING_SUPABASE_URL');
  if (useSupabase && !config.supabaseServiceKey) missing.push('NOTIFY_TEST_SUPABASE_SERVICE_ROLE_KEY or STAGING_SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) {
    throw new Error(`Missing env: ${missing.join(', ')}. Put them in .env.notification-test or export them before running.`);
  }
  if (useSupabase) assertTestSupabaseUrl(config.supabaseUrl);
}

function makeOrder(id, userId) {
  return {
    id,
    status: 'awaiting_confirm',
    created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    total: config.amount,
    user_id: userId,
    member: config.member,
    email: config.email,
    payment_reminded_at: null,
  };
}

function makeDbOrder(id) {
  const order = makeOrder(id, null);
  return {
    ...order,
    type: 'consumer',
    items: [{ id: 'NOTIFY-TEST', name: '通知測試商品', qty: 1, price: config.amount }],
    subtotal: config.amount,
    discount: 0,
    date: new Date().toISOString().slice(0, 10),
    address: '通知測試地址',
    phone: '0900000000',
    note: 'Created by npm run test:notify:real:db',
  };
}

async function insertDbOrders(orderIds) {
  await supabaseRequest('orders', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(orderIds.map(makeDbOrder)),
  });
  console.log(`db_inserted=${orderIds.join(',')}`);
}

async function cleanupDbOrders(orderIds) {
  const ids = orderIds.map(id => `"${id}"`).join(',');
  await supabaseRequest(`orders?id=in.(${encodeURIComponent(ids)})`, { method: 'DELETE' });
}

async function supabaseRequest(path, options = {}) {
  let response;
  try {
    response = await originalFetch(`${config.supabaseUrl}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: config.supabaseServiceKey,
        Authorization: `Bearer ${config.supabaseServiceKey}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    const host = config.supabaseUrl ? new URL(config.supabaseUrl).hostname : 'unknown-host';
    throw new Error(`Supabase connection failed (${host}): ${error.message || String(error)}`);
  }
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text}`);
  return body;
}

async function runReminder() {
  const res = createRes();
  await remindUnpaidOrders({ method: 'POST', headers: { 'x-vercel-cron': '1' }, body: {} }, res);
  if (res.statusCode !== 200) throw new Error(`Reminder failed: ${res.statusCode} ${JSON.stringify(res.jsonBody)}`);
  return res.jsonBody;
}

async function runPayment(orderId) {
  const res = createRes();
  await sinopacNotify({ method: 'POST', query: {}, body: { OrderNo: orderId, Status: 'S', Amount: config.amount } }, res);
  if (res.statusCode !== 200) throw new Error(`Payment failed: ${res.statusCode} ${JSON.stringify(res.jsonBody)}`);
  return res;
}

function findResult(body, orderId) {
  return (body?.results || []).find(result => result.id === orderId);
}

function pickNotifyResult(result) {
  return {
    lineSent: result?.lineSent,
    lineReason: result?.lineReason,
    emailSent: result?.emailSent,
    emailReason: result?.emailReason,
    marked: result?.marked,
  };
}

function pickPaymentResult(res) {
  return {
    lineSent: res.jsonBody?.lineSent,
    lineReason: res.jsonBody?.lineReason,
    emailSent: res.jsonBody?.emailSent,
    emailReason: res.jsonBody?.emailReason,
  };
}

async function findResendEmail(orderId, subjectPart, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(2500);
    const response = await originalFetch('https://api.resend.com/emails?limit=30', {
      headers: { Authorization: `Bearer ${config.resendApiKey}` },
    });
    if (!response.ok) throw new Error(`Resend list failed: ${response.status} ${await response.text()}`);
    const body = await response.json();
    const found = (body.data || []).find(email =>
      Array.isArray(email.to)
      && email.to.some(address => String(address).toLowerCase() === config.email.toLowerCase())
      && String(email.subject || '').includes(subjectPart)
      && String(email.subject || '').includes(orderId)
    );
    if (found) return found;
  }
  return null;
}

function createRes() {
  return {
    statusCode: 200,
    jsonBody: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.jsonBody = body;
      return this;
    },
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const values = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeSupabaseUrl(url) {
  return String(url).trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
}

function assertTestSupabaseUrl(url) {
  const host = new URL(url).hostname;
  if (host.includes('ilvdvlkdpntwmaijncaz')) {
    throw new Error('Refusing to write notification test orders to the production Supabase project.');
  }
}
