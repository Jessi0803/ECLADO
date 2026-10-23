import React from 'react';
import { describeSinopacDiagnostic, selectSinopacSummary, sinopacMessage, sinopacPayStatus } from '../../domain/sinopacDiagnostics.js';

const sourceNames = { create:'建立付款單', retry:'重新付款', query:'付款查詢', notify:'銀行通知後查證', return:'付款回站後查證', assisted_create:'代客訂單付款' };
const typeNames = { PayOut:'付款結果', CaptureOut:'已自動請款', RegularOut:'定期扣款結果', RegularEnd:'扣款終止通知', VARefundOut:'虛擬帳號退款通知', CardBindOut:'綁卡授權結果' };
const statusName = value => value === 'S' ? '成功（S）' : value === 'F' ? '失敗（F）' : '未提供';
const time = value => new Date(value).toLocaleString('zh-TW', { timeZone:'Asia/Taipei', hour12:false });

function Record({ row, showHeading = true, showAdvice = true }) {
  const result = describeSinopacDiagnostic(row);
  return <div style={{ borderTop:'1px solid var(--border)', paddingTop:10, marginTop:10, lineHeight:1.75, overflowWrap:'anywhere' }}>
    {showHeading && <strong>第 {row.attempt_no} 次付款流程 · {result.title}</strong>}
    <div>首次記錄：{time(row.recorded_at)}（台灣時間）</div>
    <div>觀測來源：{sourceNames[row.source] || '未提供'} · {row.api_service}</div>
    {row.http_status && <div>永豐 HTTP 狀態：{row.http_status}</div>}
    <div>API 執行：{statusName(row.api_status)}{row.api_message_code ? ` · ${row.api_message_code} ${sinopacMessage(row.api_message_code)}` : ''}</div>
    {row.transaction_type && <div>交易作業：{typeNames[row.transaction_type] || row.transaction_type}</div>}
    {(row.transaction_status || row.transaction_message_code) && <div>內層交易結果：{statusName(row.transaction_status)}{row.transaction_message_code ? ` · ${row.transaction_message_code} ${sinopacMessage(row.transaction_message_code)}` : ''}</div>}
    {row.pay_status && <div>銀行交易狀態：{row.pay_status} · {sinopacPayStatus(row.pay_status)}</div>}
    {row.auth_response_code && <div>信用卡回應碼：{row.auth_response_code}（規格未列出對照，需向永豐確認）</div>}
    {showAdvice && <div style={{ color:'var(--mid)', marginTop:5 }}>查核建議：{result.advice}</div>}
  </div>;
}

export default function PaymentDiagnostics({ order }) {
  const records = order.paymentDiagnostics || [];
  const summary = records.length ? selectSinopacSummary(records) : null;
  const result = summary ? describeSinopacDiagnostic(summary) : null;
  const paid = Boolean(order.paidAt) || ['paid','preparing','shipped','delivered','ready_for_pickup','picked_up'].includes(order.status) || order.paymentState === 'paid';
  return <section aria-label="永豐付款診斷" style={{ marginTop:14, paddingTop:12, borderTop:'1px solid var(--border)', fontSize:11, lineHeight:1.7 }}>
    <strong style={{ fontSize:12 }}>永豐付款診斷</strong>
    {order.paymentDiagnosticsStatus === 'unavailable'
      ? <div role="status">詳細銀行診斷暫時無法載入，原付款狀態仍顯示於上方。請重新載入，並確認診斷功能已部署。</div>
      : !summary ? <div>尚無詳細銀行診斷。</div>
        : <>
          {paid && <div style={{ color:'var(--green)', marginTop:8 }}>訂單目前已有付款紀錄；以下為銀行觀測紀錄，先前失敗不代表目前未付款。</div>}
          <div style={{ marginTop:8, color:result.tone === 'error' ? 'var(--red)' : result.tone === 'warning' ? '#8a5a16' : 'var(--dark)' }}>
            <strong>最近明確資訊：{result.title}</strong>
            <div>{result.advice}</div>
          </div>
          <Record row={summary} showHeading={false} showAdvice={false} />
          {records.length > 1 && <details style={{ marginTop:10 }}>
            <summary style={{ cursor:'pointer' }}>查看銀行診斷紀錄（最近 {records.length} 筆）</summary>
            {records.map(row => <Record key={row.id} row={row} />)}
          </details>}
          <div style={{ color:'var(--mid)', marginTop:10 }}>說明依永豐規格代碼對照；未提供明確原因時不推斷卡片額度或鎖卡狀況。相同回覆會去重，首次記錄時間不等於付款時間。</div>
        </>}
  </section>;
}
