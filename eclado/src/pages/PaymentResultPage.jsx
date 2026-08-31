import React, { useEffect, useState } from 'react';
import { getPaymentResultStatus } from '../domain/payments.js';
import useIsMobile from '../hooks/useIsMobile.js';
import { querySinopacPayment, retrySinopacPayment } from '../services/paymentApi.js';
import { clearPendingPayment, getPendingPayment, isTerminalPaymentState, savePendingPayment } from '../services/pendingPayment.js';

const CONTENT = {
  checking: ['正在確認付款結果', '請勿關閉頁面或重複付款。'],
  paid: ['付款成功', '款項已確認，我們已開始處理你的訂單。'],
  pending: ['付款結果仍在確認中', '請勿重新付款，可稍後回到會員訂單查看最新狀態。'],
  failed: ['付款未完成', '目前沒有確認到成功付款，請查看訂單或聯絡客服。'],
  expired: ['付款期限已過', '此訂單已取消，無法重新付款；如仍需購買，請重新建立訂單。'],
  cancelled: ['訂單已取消', '此付款單已關閉，無法重新付款。'],
};

const PAYMENT_RESULT_QUERY_ATTEMPTS = 6;
const PAYMENT_RESULT_QUERY_INTERVAL_MS = 2000;

export default function PaymentResultPage({ setPage }) {
  const isMobile = useIsMobile();
  const params = new URLSearchParams(window.location.search);
  const orderNo = params.get('orderNo') || '';
  const hint = params.get('result');
  const resultAccessToken = params.get('resultToken') || '';
  const [status, setStatus] = useState('checking');
  const [amount, setAmount] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const pendingPayment = getPendingPayment(orderNo);
    const paymentAccess = pendingPayment || (resultAccessToken ? {
      orderNo,
      resultAccessToken,
    } : null);
    if (!paymentAccess) {
      setStatus(hint === 'paid' ? 'pending' : (hint === 'failed' ? 'failed' : 'pending'));
      return undefined;
    }
    setAmount(Number(pendingPayment?.amount) || 0);

    (async () => {
      let nextStatus = 'pending';
      for (let attempt = 0; attempt < PAYMENT_RESULT_QUERY_ATTEMPTS && !cancelled; attempt += 1) {
        try {
          const result = await querySinopacPayment(paymentAccess);
          const confirmedAmount = Number(result?.order?.total);
          if (Number.isFinite(confirmedAmount) && confirmedAmount > 0) setAmount(confirmedAmount);
          nextStatus = result.paymentState || getPaymentResultStatus(result.response);
          if (nextStatus !== 'pending') break;
        } catch {
          nextStatus = attempt === PAYMENT_RESULT_QUERY_ATTEMPTS - 1 && hint === 'failed' ? 'failed' : 'pending';
        }
        if (attempt < PAYMENT_RESULT_QUERY_ATTEMPTS - 1) {
          await new Promise(resolve => window.setTimeout(resolve, PAYMENT_RESULT_QUERY_INTERVAL_MS));
        }
      }
      if (cancelled) return;
      setStatus(nextStatus);
      if (isTerminalPaymentState(nextStatus) && nextStatus !== 'failed') clearPendingPayment();
    })();
    return () => { cancelled = true; };
  }, [orderNo, hint, resultAccessToken]);

  async function retryPayment() {
    setRetrying(true);
    setRetryError('');
    try {
      const pendingPayment = getPendingPayment(orderNo);
      const result = await retrySinopacPayment({
        orderNo,
        paymentToken: pendingPayment?.paymentToken,
        guestAccessToken: pendingPayment?.guestAccessToken,
        resultAccessToken: resultAccessToken || pendingPayment?.resultAccessToken,
      });
      savePendingPayment({
        ...(pendingPayment || {}),
        orderNo,
        paymentToken: '',
        resultAccessToken: result.resultAccessToken || resultAccessToken,
        paymentLink: result.paymentLink,
        amount: Number(result.order?.total) || amount,
        response: result.response,
      });
      window.location.assign(result.paymentLink);
    } catch (error) {
      setRetryError(error?.name === 'AbortError'
        ? '付款服務連線逾時，請稍後再試。'
        : `重新建立付款單失敗。${error?.message ? `（${error.message}）` : ''}`);
      setRetrying(false);
    }
  }

  const [title, description] = CONTENT[status] || CONTENT.pending;
  const accentColor = status === 'paid' ? '#176b3a' : status === 'checking' || status === 'pending' ? 'var(--gold)' : '#9a4a2b';
  return (
    <main style={{ minHeight:'75vh', paddingTop:68, display:'flex', alignItems:'center' }}>
      <section style={{ width:'100%', maxWidth:680, margin:'0 auto', padding:isMobile ? '56px 20px' : '80px 40px', textAlign:'center' }}>
        <div style={{ width:64, height:64, border:`1px solid ${accentColor}`, color:accentColor, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 24px', fontSize:status === 'checking' ? 18 : 24 }}>
          {status === 'checking' ? '…' : status === 'paid' ? '✓' : '!'}
        </div>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:isMobile ? 30 : 38, fontWeight:300, marginBottom:14 }}>{title}</h1>
        <p style={{ color:'var(--dark)', fontSize:13, lineHeight:1.8, marginBottom:24 }}>{description}</p>
        {orderNo && <p style={{ fontSize:13, marginBottom:8 }}>訂單編號：<strong>{orderNo}</strong></p>}
        {amount > 0 && <p style={{ fontSize:13, marginBottom:30 }}>付款金額：<strong>NT$ {amount.toLocaleString()}</strong></p>}
        {status === 'failed' && (
          <div role="alert" style={{ maxWidth:520, margin:'24px auto 0', border:'1px solid #c58a72', borderLeft:'4px solid #9a4a2b', background:'#fff6f2', color:'#6f341f', padding:'16px 18px', textAlign:'left', fontSize:13, lineHeight:1.8 }}>
            這次付款沒有完成，原訂單不會被視為已付款，也不會扣款出貨。你可以保留原訂單並重新建立付款單；若未重新付款，訂單會依期限自動取消。
          </div>
        )}
        {retryError && <p role="alert" style={{ color:'#9a4a2b', fontSize:13, lineHeight:1.7, marginTop:18 }}>{retryError}</p>}
        <div style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap', marginTop:30 }}>
          {status === 'failed' && <button onClick={retryPayment} disabled={retrying} style={{ background:'var(--black)', color:'var(--white)', border:'none', padding:'12px 22px', cursor:retrying ? 'wait' : 'pointer', opacity:retrying ? 0.65 : 1 }}>{retrying ? '正在建立付款單…' : '重新付款'}</button>}
          <button onClick={() => setPage('account')} style={{ background:status === 'failed' ? 'transparent' : 'var(--black)', color:status === 'failed' ? 'var(--black)' : 'var(--white)', border:'1px solid var(--black)', padding:'12px 22px', cursor:'pointer' }}>查看我的訂單</button>
          <button onClick={() => setPage('shop')} style={{ background:'transparent', color:'var(--black)', border:'1px solid var(--black)', padding:'12px 22px', cursor:'pointer' }}>繼續購物</button>
          <button onClick={() => setPage('home')} style={{ background:'transparent', color:'var(--dark)', border:'1px solid var(--light)', padding:'12px 22px', cursor:'pointer' }}>返回首頁</button>
        </div>
      </section>
    </main>
  );
}
