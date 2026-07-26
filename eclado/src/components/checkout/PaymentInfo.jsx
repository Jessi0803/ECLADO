import React from 'react';

export default function PaymentInfo({
  copiedAtmNo,
  onCopyAtmNo,
  orderNo,
  paymentResult,
  total,
}) {
  if (!paymentResult) return null;

  const response = paymentResult.response || {};
  const atmNo = response?.ATMParam?.AtmPayNo || '';
  const paymentLink = paymentResult.paymentLink || '';

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
        {atmNo && <>
          <span style={{ color:'var(--dark)' }}>銀行代碼</span>
          <span style={{ color:'var(--black)', fontFamily:'var(--font-display)', fontWeight:500 }}>807 永豐銀行</span>
          <span style={{ color:'var(--dark)' }}>虛擬帳號</span>
          <span style={{ color:'var(--black)', fontFamily:'var(--font-display)', letterSpacing:'0.12em', fontWeight:500, fontVariantNumeric:'tabular-nums' }}>{atmNo}</span>
        </>}
        <span style={{ color:'var(--dark)' }}>金額</span>
        <span style={{ color:'var(--black)', fontFamily:'var(--font-display)', fontWeight:500 }}>NT$ {total.toLocaleString()}</span>
      </div>
      {response?.Description && <p style={{ fontSize:12, color:'var(--dark)', marginTop:12, lineHeight:1.7 }}>{response.Description}</p>}
      {paymentResult.insertError && <p style={{ fontSize:12, color:'#b45309', marginTop:12, lineHeight:1.7 }}>付款單已建立，但本站訂單寫入失敗：{paymentResult.insertError}</p>}
      {atmNo && (
        <div style={{ display:'flex', gap:10, marginTop:16, flexWrap:'wrap' }}>
          <button type="button" onClick={() => onCopyAtmNo(atmNo)} style={{ background:'var(--black)', border:'1px solid var(--black)', color:'var(--white)', padding:'11px 16px', fontSize:12, letterSpacing:'0.12em', cursor:'pointer', fontFamily:'var(--font-body)' }}>複製虛擬帳號</button>
          {copiedAtmNo && <span style={{ display:'inline-flex', alignItems:'center', color:'var(--black)', fontSize:12, letterSpacing:'0.08em', fontFamily:'var(--font-body)' }}>虛擬帳號已複製</span>}
        </div>
      )}
      {!atmNo && paymentLink && (
        <div style={{ display:'flex', gap:10, marginTop:16, flexWrap:'wrap' }}>
          <a href={paymentLink} target="_blank" rel="noreferrer" style={{ display:'inline-flex', alignItems:'center', justifyContent:'center', padding:'11px 16px', border:'1px solid var(--black)', color:'var(--black)', textDecoration:'none', fontSize:12, letterSpacing:'0.12em', fontFamily:'var(--font-body)' }}>前往付款頁</a>
          <button type="button" onClick={() => navigator.clipboard?.writeText(paymentLink)} style={{ background:'none', border:'1px solid var(--light)', color:'var(--dark)', padding:'11px 16px', fontSize:12, letterSpacing:'0.12em', cursor:'pointer', fontFamily:'var(--font-body)' }}>複製付款連結</button>
        </div>
      )}
    </div>
  );
}
