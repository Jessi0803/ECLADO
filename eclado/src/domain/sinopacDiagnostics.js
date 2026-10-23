import catalog from '../../payment-api/sinopac-status-codes.json';

export const sinopacMessage = code => code ? (catalog.messages[code] || '未收錄的永豐代碼，需向永豐確認說明') : '';
export const sinopacPayStatus = code => code ? (catalog.payStatuses[code] || '未收錄的交易狀態，需向永豐確認') : '';
export function describeSinopacDiagnostic(row) {
  const code = row.transaction_message_code || row.api_message_code;
  const suggestion = '保留原訂單，先核對永豐交易結果；結果未明前避免重複建單。';
  if (row.failure_kind === 'configuration') return { title:'付款服務設定不完整', tone:'error', advice:'請管理員檢查付款服務設定；此資訊不代表客人的信用卡遭拒。' };
  if (['network','timeout','response_integrity'].includes(row.failure_kind)) return {
    title:row.failure_kind === 'response_integrity' ? '銀行回覆無法驗證，結果待確認' : '未收到銀行完整回覆，結果待確認',
    tone:'warning', advice:suggestion,
  };
  if (row.http_status === 401) return { title:'永豐 API 認證未通過', tone:'error', advice:'請管理員核對 API KEY／認證憑證與串接設定；不能據此判定刷卡失敗。' };
  if (row.http_status === 499) return { title:'永豐 API 請求被拒絕', tone:'error', advice:'規格的 499 對應 IP 白名單錯誤，請管理員核對主機對外 IP 與永豐設定。' };
  if (row.http_status >= 400) return { title:'永豐 API 呼叫未完成', tone:'warning', advice:row.http_status === 429 ? '永豐回覆請求過於頻繁，請先確認交易結果並稍後再查。' : suggestion };
  if (['E0302','E0304','E2740'].includes(code)) return { title:code === 'E0302' ? '永豐已有相同訂單編號' : '銀行交易仍在確認中', tone:'warning', advice:suggestion };
  if (code === 'E0000') return { title:'安全簽章驗證異常', tone:'error', advice:'請管理員核對串接金鑰與簽章規則；這是串接驗證問題，不能歸因於客人卡片。' };
  if (['E2401','E2501','E3700','E3705'].includes(code)) return { title:'永豐 Token 驗證異常', tone:'error', advice:'核對永豐付款查詢／綁卡 Token 的來源與有效性；與本站登入或訂單存取憑證不同。' };
  if (['E2704','E2720'].includes(code)) return { title:'信用卡 3D 驗證失敗', tone:'error', advice:'請客人確認是否完成發卡銀行驗證；若持續失敗，請洽發卡行。無法僅憑此碼判定簡訊或密碼輸入有誤。' };
  if (code === 'M0001') return { title:'永豐系統維護中', tone:'warning', advice:suggestion };
  if (row.transaction_status === 'F') return {
    title:row.transaction_type === 'CardBindOut' ? '銀行回覆綁卡授權失敗' : '銀行回覆交易失敗', tone:'error',
    advice:'查看銀行代碼與信用卡回應碼；未有明確說明時，無法判定額度不足、卡片鎖定或其他發卡行原因。',
  };
  if (code?.startsWith('E') || row.api_status === 'F') return { title:'永豐回覆處理失敗', tone:'error', advice:'依下方銀行代碼查核；建單或查詢失敗不等於信用卡授權遭拒。' };
  if (catalog.payStatuses[row.pay_status]) return {
    title:`銀行交易狀態：${sinopacPayStatus(row.pay_status)}`,
    tone:/250$|350$|351$/.test(row.pay_status) ? 'warning' : /300$|400$|900$/.test(row.pay_status) ? 'success' : 'neutral',
    advice:'此為銀行狀態說明；訂單與收款狀態仍依既有付款核對流程處理。',
  };
  if (row.transaction_status === 'S') return { title:['PayOut','CaptureOut'].includes(row.transaction_type) ? '銀行回覆交易成功' : '銀行回覆此項作業成功', tone:'success', advice:'作業類型列於下方；綁卡成功或查詢成功不等於完成付款。' };
  if (row.api_service === 'OrderCreate' && row.api_status === 'S') return { title:'銀行付款單建立成功', tone:'neutral', advice:'已取得銀行付款單，不代表客人已完成付款。' };
  return { title:'銀行資訊不足，付款結果待確認', tone:'neutral', advice:'API 執行成功只代表查詢或串接完成，不能直接判定交易成功或失敗。' };
}

export function selectSinopacSummary(records) {
  const newestAttempt = Math.max(...records.map(row => Number(row.attempt_no) || 1));
  const current = records.filter(row => (Number(row.attempt_no) || 1) === newestAttempt);
  // A generic successful query must not conceal a specific verified decline.
  return current.find(row => row.transaction_status || row.failure_kind || row.api_status === 'F'
    || /250$|300$|350$|351$|400$|900$/.test(row.pay_status || '')
    || /^[EM]/.test(row.transaction_message_code || row.api_message_code || '')) || current[0];
}
