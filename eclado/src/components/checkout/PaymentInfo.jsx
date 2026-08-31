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
    failed: paymentResult.lookupCode
      ? '付款未完成，此付款單已關閉。請使用查詢碼與結帳手機號碼回到訪客訂單查詢，保留原訂單並重新付款。'
      : '付款未完成，此付款單已關閉。請回到會員專區的「我的訂單」，保留原訂單並重新付款。',
    error: '目前無法確認付款狀態。為避免重複付款，付款入口已暫時停用，請重新查詢。',
  }[paymentState] || '';

  return (
    <div style={{ background:'var(--off-white)', padding:'24px 28px', marginBottom:20 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14, gap:12 }}>
        <p style={{ fontSize:10, letterSpacing:'0.2em', color:'var(--dark)', textTransform:'uppercase' }}>付款資訊</p>
        <span style={{ fontSize:10, background:'var(--gold)', color:'var(--white)', padding:'3px 10px', letterSpacing:'0.1em' }}>{paymentResult.methodLabel}</span>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:'8px 20px', fontSize:13 }}>
        <span style={{ color:'var(--dark)' }}>訂單編號</span>
        <span style={{ color:'var(--black)', letterSpacing:'0.08em', fontFamily:'var(--font-display)', fontVariantNumeric:'tabular-nums' }}>{orderNo}</span>
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
      {response?.Description && <p style={{ fontSize:12, color:'var(--dark)', marginTop:12, lineHeight:1.7 }}>{response.Description}</p>}
      {paymentResult.lookupCode && typeof paymentResult.orderEmailSent === 'boolean' && (
        <p role="status" style={{ fontSize:12, color:paymentResult.orderEmailSent ? '#176b3a' : '#8a3c2c', marginTop:12, lineHeight:1.7 }}>
          {paymentResult.orderEmailSent
            ? '訂單成立信已寄出；日後可使用查詢碼與結帳手機號碼找回付款資訊。'
            : '訂單成立信暫時未能寄出，請先截圖或記下訪客查詢碼。'}
        </p>
      )}
      {atmNo && canPay && paymentDeadline && <p style={{ fontSize:12, color:'var(--dark)', marginTop:12, lineHeight:1.7 }}>請於期限前完成轉帳，逾期後訂單將自動取消。</p>}
      {paymentResult.insertError && <p style={{ fontSize:12, color:'#b45309', marginTop:12, lineHeight:1.7 }}>付款單已建立，但本站訂單寫入失敗：{paymentResult.insertError}</p>}
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
