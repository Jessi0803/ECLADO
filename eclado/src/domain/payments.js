export const SINOPAC_PAYMENT_API = 'https://pay.ecladotaiwan.com';
export const SINOPAC_NOTIFY_API = 'https://www.ecladotaiwan.com/api/sinopac/notify';
export const PAYMENT_REQUEST_TIMEOUT_MS = 15000;

export const PAYMENT_METHODS = {
  atm: {
    label: '虛擬帳號匯款',
    payType: 'A',
    pendingStatus: 'awaiting_confirm',
    description: '由永豐產生虛擬帳號，付款後由系統通知店家。',
  },
  card: {
    label: '信用卡',
    payType: 'C',
    pendingStatus: 'unpaid',
    description: '完成授權後即進入付款流程。',
  },
  apple: {
    label: 'Apple Pay',
    payType: 'M',
    choosePay: 'A',
    pendingStatus: 'unpaid',
    description: '以 Apple Pay 完成付款。',
  },
  google: {
    label: 'Google Pay',
    payType: 'M',
    choosePay: 'G',
    pendingStatus: 'unpaid',
    description: '以 Google Pay 完成付款。',
  },
};

export const ORDER_STATUS_LABELS = {
  awaiting_confirm: '轉帳待確認',
  unpaid: '未付款',
  paid: '已付款',
  preparing: '備貨中',
  shipped: '已出貨',
  delivered: '已到貨',
  returned: '退貨',
  cancelled: '已取消',
};

export function getOrderStatusLabel(status) {
  return ORDER_STATUS_LABELS[status] || status || '處理中';
}

export function formatDateCompact(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export function formatTimeCompact(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}${m}`;
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function safeTrim(value) {
  return String(value || '').trim();
}

export function extractPaymentLink(response) {
  if (!response || typeof response !== 'object') return '';
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

export function getPaymentToken(response) {
  if (!response || typeof response !== 'object') return '';
  const candidates = [
    response.PayToken,
    response?.CardParam?.PayToken,
    response?.MobileParam?.PayToken,
    response?.WalletParam?.PayToken,
    response?.ATMParam?.PayToken,
  ];
  return candidates.find(token => typeof token === 'string' && token.trim()) || '';
}

export function buildPaymentNotes(methodLabel, response) {
  const payToken = getPaymentToken(response);
  const lines = [
    `付款方式：${methodLabel}`,
    response?.Status ? `永豐狀態：${response.Status}` : '',
    response?.Description ? `永豐說明：${response.Description}` : '',
    response?.TSNo ? `交易編號：${response.TSNo}` : '',
    payToken ? `pay_token:${payToken}` : '',
    response?.ATMParam?.AtmPayNo ? `虛擬帳號：${response.ATMParam.AtmPayNo}` : '',
    response?.ATMParam?.WebAtmURL ? `WebATM：${response.ATMParam.WebAtmURL}` : '',
    response?.QRCodeURL ? `QR Code：${response.QRCodeURL}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

export function getSinopacPaymentError(response) {
  if (!response || typeof response !== 'object') return '';
  const status = String(response.Status || '').trim().toUpperCase();
  const description = String(response.Description || '').trim();
  if (status && status !== 'S') return description || `永豐狀態：${status}`;
  if (/^E\d{4}/i.test(description)) return description;
  return '';
}

export function getPaymentResultStatus(response) {
  const order = Array.isArray(response?.OrderList) ? response.OrderList[0] : response;
  const payStatus = String(order?.PayStatus || '').trim().toUpperCase();
  const payFlag = String(order?.PayFlag || '').trim().toUpperCase();
  if (/^1[A-Z](300|400)$/.test(payStatus) || /^1[A-Z](300|400)$/.test(payFlag)) return 'paid';
  if (['1C200', '1A200', '1M200', '0'].includes(payStatus) || ['N', '0'].includes(payFlag)) return 'pending';
  if (payStatus || payFlag) return 'failed';
  return 'pending';
}
