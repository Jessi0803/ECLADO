import React, { useState } from 'react';
import { PAYMENT_METHODS } from '../domain/payments.js';
import useIsMobile from '../hooks/useIsMobile.js';
import { lookupGuestOrder } from '../services/paymentApi.js';
import { savePendingPayment } from '../services/pendingPayment.js';

function paymentDeadlineFromIso(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = type => parts.find(item => item.type === type)?.value || '';
  return {
    expireDate: `${part('year')}${part('month')}${part('day')}`,
    expireTime: `${part('hour')}${part('minute')}`,
  };
}

export default function GuestOrderLookupPage({ setPage }) {
  const isMobile = useIsMobile();
  const initialCode = new URLSearchParams(window.location.search).get('lookup') || '';
  const [lookupCode, setLookupCode] = useState(initialCode);
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const result = await lookupGuestOrder({ lookupCode, phone });
      const order = result.order || {};
      const instruction = result.instruction || {};
      const subtotal = Number(order.subtotal) || 0;
      const discount = Number(order.discount) || 0;
      const shipping = Number(order.shipping) || 0;
      const total = Number(order.total) || 0;
      const method = instruction.payment_method || 'atm';
      const saved = savePendingPayment({
        orderNo: order.id,
        accessType: 'guest',
        guestAccessToken: result.guestAccessToken,
        lookupCode: String(lookupCode || '').toUpperCase(),
        orderEmailSent: instruction.order_email_sent_at ? true : null,
        amount: total,
        method,
        methodLabel: PAYMENT_METHODS[method]?.label || '付款',
        paymentLink: instruction.payment_url || '',
        paymentDeadline: paymentDeadlineFromIso(instruction.payment_due_at || order.payment_due_at),
        paymentDueAt: instruction.payment_due_at || order.payment_due_at,
        response: {
          Status: instruction.provider_status || '',
          Description: instruction.provider_description || '',
          TSNo: instruction.provider_transaction_no || '',
          ATMParam: instruction.atm_account ? { AtmPayNo: instruction.atm_account } : undefined,
        },
        summary: {
          subtotal,
          discount,
          finalSubtotal: subtotal - discount,
          shipping,
          total,
          promotion: order.promotion_name
            ? { id: `guest-${order.id}`, name: order.promotion_name }
            : null,
          items: Array.isArray(order.items) ? order.items : [],
        },
      });
      if (!saved) throw new Error('瀏覽器無法保存付款資訊，請稍後再試。');
      setPage('checkout');
    } catch (lookupError) {
      setError(lookupError?.message || '查詢資料不正確，請確認查詢碼與手機號碼。');
    } finally {
      setLoading(false);
    }
  }

  const fieldStyle = {
    width:'100%', boxSizing:'border-box', border:'1px solid var(--light)', background:'var(--white)',
    padding:'13px 14px', fontFamily:'var(--font-body)', fontSize:14, color:'var(--black)', outline:'none',
  };

  return (
    <main style={{ minHeight:'80vh', paddingTop:68, background:'var(--off-white)' }}>
      <section style={{ maxWidth:560, margin:'0 auto', padding:isMobile ? '52px 20px 80px' : '76px 32px 96px' }}>
        <div style={{ background:'var(--white)', border:'1px solid var(--light)', padding:isMobile ? '28px 20px' : '40px' }}>
          <p style={{ color:'var(--gold)', fontSize:11, letterSpacing:'0.2em', marginBottom:10 }}>GUEST ORDER</p>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:isMobile ? 28 : 36, fontWeight:400, marginBottom:12 }}>訪客訂單查詢</h1>
          <p style={{ color:'var(--dark)', fontSize:13, lineHeight:1.8, marginBottom:28 }}>
            請輸入訂單成立信中的短查詢碼，以及結帳時填寫的手機號碼。
          </p>
          <form onSubmit={handleSubmit} style={{ display:'grid', gap:20 }}>
            <label style={{ display:'grid', gap:7, fontSize:12, color:'var(--dark)' }}>
              訪客查詢碼
              <input
                autoComplete="off"
                inputMode="text"
                maxLength={11}
                placeholder="ABCDE-12345"
                required
                style={{ ...fieldStyle, letterSpacing:'0.12em', textTransform:'uppercase' }}
                value={lookupCode}
                onChange={event => setLookupCode(event.target.value)}
              />
            </label>
            <label style={{ display:'grid', gap:7, fontSize:12, color:'var(--dark)' }}>
              結帳手機號碼
              <input
                autoComplete="tel"
                inputMode="tel"
                placeholder="09xx-xxx-xxx"
                required
                style={fieldStyle}
                type="tel"
                value={phone}
                onChange={event => setPhone(event.target.value)}
              />
            </label>
            {error && <div role="alert" style={{ color:'#991b1b', background:'#fef2f2', border:'1px solid #fecaca', padding:'12px 14px', fontSize:12, lineHeight:1.7 }}>{error}</div>}
            <button disabled={loading} type="submit" style={{ border:'none', background:'var(--black)', color:'var(--white)', padding:'14px 18px', fontFamily:'var(--font-body)', fontSize:12, letterSpacing:'0.12em', cursor:loading ? 'wait' : 'pointer', opacity:loading ? 0.65 : 1 }}>
              {loading ? '查詢中…' : '查看訂單與付款資訊'}
            </button>
          </form>
          <button type="button" onClick={() => setPage('login')} style={{ display:'block', margin:'22px auto 0', border:'none', background:'transparent', color:'var(--dark)', fontFamily:'var(--font-body)', fontSize:12, textDecoration:'underline', textUnderlineOffset:3, cursor:'pointer' }}>
            返回會員登入
          </button>
        </div>
      </section>
    </main>
  );
}
