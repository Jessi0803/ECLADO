import React, { useEffect, useState } from 'react';
import { getPaymentResultStatus } from '../domain/payments.js';
import useIsMobile from '../hooks/useIsMobile.js';
import { querySinopacPayment } from '../services/paymentApi.js';
import { clearPendingPayment, getPendingPayment } from '../services/pendingPayment.js';

const CONTENT = {
  checking: ['正在確認付款結果', '請勿關閉頁面或重複付款。'],
  paid: ['付款成功', '款項已確認，我們已開始處理你的訂單。'],
  pending: ['付款結果仍在確認中', '請勿重新付款，可稍後回到會員訂單查看最新狀態。'],
  failed: ['付款未完成', '目前沒有確認到成功付款，請查看訂單或聯絡客服。'],
  expired: ['付款期限已過', '此訂單已取消，無法重新付款；如仍需購買，請重新建立訂單。'],
  cancelled: ['訂單已取消', '此付款單已關閉，無法重新付款。'],
};

export default function PaymentResultPage({ setPage }) {
  const isMobile = useIsMobile();
  const params = new URLSearchParams(window.location.search);
  const orderNo = params.get('orderNo') || '';
  const hint = params.get('result');
  const [status, setStatus] = useState('checking');
  const [amount, setAmount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const pendingPayment = getPendingPayment(orderNo);
    if (!pendingPayment) {
      setStatus(hint === 'paid' ? 'pending' : (hint === 'failed' ? 'failed' : 'pending'));
      return undefined;
    }
    setAmount(Number(pendingPayment.amount) || 0);
    querySinopacPayment(pendingPayment)
      .then(result => {
        if (cancelled) return;
        const nextStatus = result.paymentState || getPaymentResultStatus(result.response);
        setStatus(nextStatus);
        if (['paid', 'failed', 'expired', 'cancelled'].includes(nextStatus)) clearPendingPayment();
      })
      .catch(() => {
        if (!cancelled) setStatus(hint === 'failed' ? 'failed' : 'pending');
      });
    return () => { cancelled = true; };
  }, [orderNo, hint]);

  const [title, description] = CONTENT[status] || CONTENT.pending;
  return (
    <main style={{ minHeight:'75vh', paddingTop:68, display:'flex', alignItems:'center' }}>
      <section style={{ width:'100%', maxWidth:680, margin:'0 auto', padding:isMobile ? '56px 20px' : '80px 40px', textAlign:'center' }}>
        <div style={{ width:64, height:64, border:'1px solid var(--black)', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 24px', fontSize:status === 'checking' ? 18 : 24 }}>
          {status === 'checking' ? '…' : status === 'paid' ? '✓' : '!'}
        </div>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:isMobile ? 30 : 38, fontWeight:300, marginBottom:14 }}>{title}</h1>
        <p style={{ color:'var(--dark)', fontSize:13, lineHeight:1.8, marginBottom:24 }}>{description}</p>
        {orderNo && <p style={{ fontSize:13, marginBottom:8 }}>訂單編號：<strong>{orderNo}</strong></p>}
        {amount > 0 && <p style={{ fontSize:13, marginBottom:30 }}>付款金額：<strong>NT$ {amount.toLocaleString()}</strong></p>}
        <div style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap', marginTop:30 }}>
          <button onClick={() => setPage('account')} style={{ background:'var(--black)', color:'var(--white)', border:'none', padding:'12px 22px', cursor:'pointer' }}>查看我的訂單</button>
          <button onClick={() => setPage('shop')} style={{ background:'transparent', color:'var(--black)', border:'1px solid var(--black)', padding:'12px 22px', cursor:'pointer' }}>繼續購物</button>
          <button onClick={() => setPage('home')} style={{ background:'transparent', color:'var(--dark)', border:'1px solid var(--light)', padding:'12px 22px', cursor:'pointer' }}>返回首頁</button>
        </div>
      </section>
    </main>
  );
}
