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
const qpayApiUrl = process.env.PAYMENT_INTEGRATION_API_URL
  || 'https://pay.ecladotaiwan.com/api/sinopac/create-payment';

test.describe('永豐 QPay integration', () => {
  test.skip(
    !paymentEnabled,
    'Set RUN_PAYMENT_INTEGRATION=1 to run the QPay integration tests.',
  );

  test('虛擬帳號可以建立付款單並回傳 807 與虛擬帳號', async ({ request }) => {
    const credential = getControlledOrderCredential('ATM');
    if (!credential) {
      test.skip(true, 'Set PAYMENT_INTEGRATION_ATM_ORDER_NO and PAYMENT_INTEGRATION_ATM_TOKEN to a fresh controlled order.');
      return;
    }
    const payload = buildPayload('A', credential);
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
  });

  test('信用卡可以建立付款單並產生付款連結', async ({ request }) => {
    const credential = getControlledOrderCredential('CARD');
    if (!credential) {
      test.skip(true, 'Set PAYMENT_INTEGRATION_CARD_ORDER_NO and PAYMENT_INTEGRATION_CARD_TOKEN to a fresh controlled order.');
      return;
    }
    const payload = buildPayload('C', credential);
    const payment = await createPayment(request, payload);
    const response = payment.response;

    expect(payment.ok ?? true).toBeTruthy();
    expect(response.Status).toBe('S');
    expect(response.Description).toBeTruthy();
    expect(response.ATMParam?.AtmPayNo).toBeFalsy();
    expect(extractPaymentLink(response)).toBeTruthy();
    expect(payload.payType).toBe('C');
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

function buildPayload(payType: 'A' | 'C', credential: ControlledOrderCredential) {
  return {
    orderNo: credential.orderNo,
    paymentToken: credential.paymentToken,
    payType,
  };
}

type ControlledOrderCredential = {
  orderNo: string;
  paymentToken: string;
};

function getControlledOrderCredential(kind: 'ATM' | 'CARD'): ControlledOrderCredential | null {
  const orderNo = String(process.env[`PAYMENT_INTEGRATION_${kind}_ORDER_NO`] || '').trim();
  const paymentToken = String(process.env[`PAYMENT_INTEGRATION_${kind}_TOKEN`] || '').trim();
  if (!orderNo || !paymentToken) return null;
  if (!/^ECL[-A-Z0-9]+$/i.test(orderNo)) {
    throw new Error(`${kind} integration order must be a real ECLADO order number`);
  }
  if (paymentToken.length < 32) {
    throw new Error(`${kind} integration payment token is unexpectedly short`);
  }
  return { orderNo, paymentToken };
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
