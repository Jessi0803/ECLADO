import React from 'react';

function formatPaymentDeadline(deadline) {
  if (!deadline) return '';
  const date = String(deadline.expireDate || deadline.ExpireDate || '').replace(/\D/g, '');
  const time = String(deadline.expireTime || deadline.ExpireTime || '').replace(/\D/g, '').padStart(4, '0');
  if (date.length !== 8 || time.length !== 4) return '';
  return `${date.slice(0, 4)}/${date.slice(4, 6)}/${date.slice(6, 8)} ${time.slice(0, 2)}:${time.slice(2, 4)}`;
}

export default function PaymentInfo({
  copiedAtmNo,
  onCopyAtmNo,
  onGoToPayment,
  orderNo,
  paymentResult,
  paymentState = 'pending',
  renewing = false,
  total,
}) {
  if (!paymentResult) return null;

  const response = paymentResult.response || {};
  const atmNo = response?.ATMParam?.AtmPayNo || '';
  const paymentDeadline = formatPaymentDeadline(
    paymentResult.paymentDeadline || response?.ATMParam,
  );
  const paymentLink = paymentResult.paymentLink || '';
  const canPay = paymentState === 'pending';
  const stateMessage = {
    paid: '此筆訂單已完成付款，不需要再次付款。',
    expired: '付款期限已過，此訂單已取消，無法重新付款。',
    cancelled: '此筆訂單已取消，無法重新付款。',
    failed: '付款尚未完成，訂單仍為你保留。你可以再次確認付款狀態，繼續完成原訂單。',
    error: '付款狀態暫時無法確認，請稍後重新查詢，暫勿重複付款。',
    initiated: '正在確認付款資訊，訂單已為你保留，請稍後再查詢。',
    link_expired: '付款連結已到期，訂單仍為你保留至原付款期限。點選「繼續付款」，我們會先確認付款狀態，再帶你前往付款。',
  }[paymentState] || '';

  return (
    <div style={{ background:'var(--off-white)', padding:'24px 28px', marginBottom:20 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, gap:12 }}>
        <p style={{ fontSize:10, letterSpacing:'0.2em', color:'var(--dark)', textTransform:'uppercase' }}>付款資訊</p>
        <span style={{ fontSize:10, background:'var(--accent)', color:'var(--white)', padding:'3px 10px', letterSpacing:'0.1em' }}>{paymentResult.methodLabel}</span>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:'8px 20px', fontSize:13 }}>
        <span style={{ color:'var(--dark)' }}>訂單編號</span>
        <span style={{ color:'var(--black)', letterSpacing:'0.08em', fontFamily:'var(--font-display)', fontVariantNumeric:'tabular-nums' }}>{orderNo}</span>
        {!atmNo && paymentResult.paymentDueAt && <>
          <span style={{ color:'var(--dark)' }}>訂單保留至</span>
          <span>{new Date(paymentResult.paymentDueAt).toLocaleString('zh-TW', { timeZone:'Asia/Taipei', hour12:false })}</span>
        </>}
        {response?.TSNo && <>
          <span style={{ color:'var(--dark)' }}>交易編號</span>
          <span style={{ color:'var(--black)', letterSpacing:'0.08em', fontFamily:'var(--font-display)', fontVariantNumeric:'tabular-nums' }}>{response.TSNo}</span>
        </>}
        {paymentResult.lookupCode && <>
          <span style={{ color:'var(--dark)' }}>訪客查詢碼</span>
          <span style={{ color:'var(--black)', letterSpacing:'0.12em', fontFamily:'var(--font-display)', fontWeight:500, fontVariantNumeric:'tabular-nums' }}>{paymentResult.lookupCode}</span>
        </>}
        {atmNo && canPay && <>
          <span style={{ color:'var(--dark)' }}>銀行代碼</span>
          <span style={{ color:'var(--black)', fontFamily:'var(--font-display)', fontWeight:500 }}>807 永豐銀行</span>
          <span style={{ color:'var(--dark)' }}>虛擬帳號</span>
          <span style={{ color:'var(--black)', fontFamily:'var(--font-display)', letterSpacing:'0.12em', fontWeight:500, fontVariantNumeric:'tabular-nums' }}>{atmNo}</span>
          {paymentDeadline && <>
            <span style={{ color:'var(--dark)' }}>繳款期限</span>
            <span style={{ color:'var(--black)', fontFamily:'var(--font-display)', fontWeight:500, fontVariantNumeric:'tabular-nums' }}>{paymentDeadline} 前</span>
          </>}
        </>}
        <span style={{ color:'var(--dark)' }}>金額</span>
        <span style={{ color:'var(--black)', fontFamily:'var(--font-display)', fontWeight:500 }}>NT$ {total.toLocaleString()}</span>
      </div>
      {stateMessage && (
        <div role="status" style={{ marginTop:16, padding:'12px 14px', border:'1px solid var(--light)', background:'var(--white)', color:paymentState === 'paid' ? '#176b3a' : '#8a3c2c', fontSize:12, lineHeight:1.7 }}>
          {stateMessage}
        </div>
      )}
      {paymentResult.linkExpiresAt && canPay && <p style={{ fontSize:12, color:'var(--dark)', marginTop:12, lineHeight:1.7 }}>付款連結有效至 {new Date(paymentResult.linkExpiresAt).toLocaleString('zh-TW', { timeZone:'Asia/Taipei', hour12:false })}。連結到期後，可於訂單付款期限內繼續付款。</p>}
      {['link_expired','failed'].includes(paymentState) && ['card','apple','google'].includes(paymentResult.method) && <button type="button" disabled={renewing} onClick={onGoToPayment} style={{ marginTop:16, padding:'11px 16px', background:'var(--black)', color:'var(--white)', border:0, cursor:renewing ? 'wait' : 'pointer' }}>{renewing ? '正在確認付款狀態…' : '繼續付款'}</button>}
      {paymentResult.lookupCode && typeof paymentResult.orderEmailSent === 'boolean' && (
        <p role="status" style={{ fontSize:12, color:paymentResult.orderEmailSent ? '#176b3a' : '#8a3c2c', marginTop:12, lineHeight:1.7 }}>
          {paymentResult.orderEmailSent
            ? '訂單成立信已寄出；日後可使用查詢碼與結帳手機號碼找回付款資訊。'
            : '訂單成立信暫時未能寄出，請先截圖或記下訪客查詢碼。'}
        </p>
      )}
      {atmNo && canPay && paymentDeadline && <p style={{ fontSize:12, color:'var(--dark)', marginTop:12, lineHeight:1.7 }}>請於期限前完成轉帳，逾期後訂單將自動取消。</p>}
      {paymentResult.insertError && <p style={{ fontSize:12, color:'#b45309', marginTop:12, lineHeight:1.7 }}>訂單處理發生異常，請先記下訂單編號並聯繫客服，暫勿重複下單。</p>}
      {atmNo && canPay && (
        <div style={{ display:'flex', gap:10, marginTop:16, flexWrap:'wrap' }}>
          <button type="button" onClick={() => onCopyAtmNo(atmNo)} style={{ background:'var(--black)', border:'1px solid var(--black)', color:'var(--white)', padding:'11px 16px', fontSize:12, letterSpacing:'0.12em', cursor:'pointer', fontFamily:'var(--font-body)' }}>複製虛擬帳號</button>
          {copiedAtmNo && <span style={{ display:'inline-flex', alignItems:'center', color:'var(--black)', fontSize:12, letterSpacing:'0.08em', fontFamily:'var(--font-body)' }}>虛擬帳號已複製</span>}
        </div>
      )}
      {!atmNo && paymentLink && canPay && (
        <div style={{ display:'flex', gap:10, marginTop:16, flexWrap:'wrap' }}>
          <button type="button" onClick={onGoToPayment} style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', padding:'11px 16px', border:'1px solid var(--black)', color:'var(--black)', background:'transparent', fontSize:12, letterSpacing:'0.12em', fontFamily:'var(--font-body)', cursor:'pointer' }}>前往付款頁</button>
          <button type="button" onClick={() => navigator.clipboard?.writeText(paymentLink)} style={{ background:'none', border:'1px solid var(--light)', color:'var(--dark)', padding:'11px 16px', fontSize:12, letterSpacing:'0.12em', cursor:'pointer', fontFamily:'var(--font-body)' }}>複製付款連結</button>
        </div>
      )}
    </div>
  );
}
