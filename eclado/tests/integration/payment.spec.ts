import { expect, test, type APIRequestContext } from '@playwright/test';

type QPayResponse = {
  Status?: string;
  Description?: string;
  TSNo?: string;
  ATMParam?: {
    AtmPayNo?: string;
    WebAtmURL?: string;
  };
  PayURL?: string;
  RedirectURL?: string;
  PaymentURL?: string;
  CardParam?: {
    CardPayURL?: string;
    CardURL?: string;
  };
  MobileParam?: {
    MobilePayURL?: string;
    MobileURL?: string;
  };
  WalletParam?: {
    WalletPayURL?: string;
    WalletURL?: string;
  };
  WebAtmURL?: string;
  QRCodeURL?: string;
};

const paymentEnabled = process.env.RUN_PAYMENT_INTEGRATION === '1';
const qpayApiUrl = 'https://pay.ecladotaiwan.com/api/sinopac/create-payment';

test.describe('永豐 QPay integration', () => {
  test.skip(
    !paymentEnabled,
    'Set RUN_PAYMENT_INTEGRATION=1 to run the QPay integration tests.',
  );

  test('虛擬帳號可以建立付款單並回傳 807 與虛擬帳號', async ({ request }) => {
    const payload = buildPayload('A');
    const payment = await createPayment(request, payload);
    const response = payment.response;

    expect(payment.ok ?? true).toBeTruthy();
    expect(response.Status).toBe('S');
    expect(response.Description).toBeTruthy();
    expect(response.ATMParam?.AtmPayNo).toBeTruthy();

    const atmNo = String(response.ATMParam?.AtmPayNo || '');
    expect(atmNo).toMatch(/^\d{10,}$/);
    expect(extractPaymentLink(response)).toBeTruthy();
    expect(payload.payType).toBe('A');
    expect(payload.backendUrl).toBe('https://www.ecladotaiwan.com/api/sinopac/notify');
    expect(payload.returnUrl).toContain('https://pay.ecladotaiwan.com/return?orderNo=');
  });

  test('信用卡可以建立付款單並產生付款連結', async ({ request }) => {
    const payload = buildPayload('C');
    const payment = await createPayment(request, payload);
    const response = payment.response;

    expect(payment.ok ?? true).toBeTruthy();
    expect(response.Status).toBe('S');
    expect(response.Description).toBeTruthy();
    expect(response.ATMParam?.AtmPayNo).toBeFalsy();
    expect(extractPaymentLink(response)).toBeTruthy();
    expect(payload.payType).toBe('C');
    expect(payload.backendUrl).toBe('https://www.ecladotaiwan.com/api/sinopac/notify');
    expect(payload.returnUrl).toContain('https://pay.ecladotaiwan.com/return?orderNo=');
  });
});

async function createPayment(
  request: APIRequestContext,
  payload: Record<string, unknown>,
) {
  const response = await request.post(qpayApiUrl, {
    data: payload,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  expect(response.ok(), `QPay API failed with HTTP ${response.status()}`).toBeTruthy();

  const body = await response.json();
  expect(body, 'QPay API should return JSON').toBeTruthy();
  expect(typeof body).toBe('object');

  const normalized = normalizePaymentResponse(body);

  return normalized as {
    ok?: boolean;
    response: QPayResponse;
  };
}

function buildPayload(payType: 'A' | 'C') {
  const orderNo = `PW${Date.now()}`;
  const amount = 100;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  return {
    orderNo,
    amount,
    prdtName: 'ECLADO QPay 測試商品',
    payType,
    expireDate: formatDateCompact(expiresAt),
    expireTime: formatTimeCompact(expiresAt),
    returnUrl: `https://pay.ecladotaiwan.com/return?orderNo=${encodeURIComponent(orderNo)}`,
    backendUrl: 'https://www.ecladotaiwan.com/api/sinopac/notify',
    qrCodeStatus: 'Y',
    memo: 'PW',
  };
}

function extractPaymentLink(response: QPayResponse) {
  const candidates = [
    response.PayURL,
    response.RedirectURL,
    response.PaymentURL,
    response?.CardParam?.CardPayURL,
    response?.CardParam?.CardURL,
    response?.MobileParam?.MobilePayURL,
    response?.MobileParam?.MobileURL,
    response?.WalletParam?.WalletPayURL,
    response?.WalletParam?.WalletURL,
    response.WebAtmURL,
    response?.ATMParam?.WebAtmURL,
  ];

  return candidates.find(url => typeof url === 'string' && url.startsWith('http') && !url.includes('QRCode')) || '';
}

function normalizePaymentResponse(body: unknown) {
  if (!body || typeof body !== 'object') {
    return { ok: false, response: {} as QPayResponse };
  }

  const record = body as Record<string, unknown>;
  const response = (record.response && typeof record.response === 'object')
    ? record.response
    : body;

  return {
    ok: record.ok,
    response: response as QPayResponse,
  };
}

function formatDateCompact(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function formatTimeCompact(date: Date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}${m}`;
}
