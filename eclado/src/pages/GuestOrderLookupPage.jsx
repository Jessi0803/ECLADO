import React, { useEffect, useState } from 'react';
import { getProductImagePublicUrl } from '../services/catalogData.js';
import { getOrderStatusLabel, getPaymentStateColor, getPaymentStateLabel, PAYMENT_METHODS } from '../domain/payments.js';
import { SF_EXPRESS_TRACKING_URL } from '../domain/shipping.js';
import useIsMobile from '../hooks/useIsMobile.js';
import { fetchGuestOrderDetails, lookupGuestOrder, retrySinopacPayment } from '../services/paymentApi.js';
import {
  clearGuestOrderSession,
  getGuestOrderSession,
  saveGuestOrderSession,
} from '../services/guestOrderSession.js';
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

function formatDateTime(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function statusColor(status) {
  if (['paid', 'preparing', 'shipped', 'delivered'].includes(status)) return 'var(--green)';
  if (['cancelled', 'returned'].includes(status)) return 'var(--red)';
  return 'var(--gold)';
}

export default function GuestOrderLookupPage({ setPage }) {
  const isMobile = useIsMobile();
  const initialSession = getGuestOrderSession();
  const initialCode = new URLSearchParams(window.location.search).get('lookup') || initialSession?.lookupCode || '';
  const [lookupCode, setLookupCode] = useState(initialCode);
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState(initialSession);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(!!initialSession);
  const [error, setError] = useState('');
  const [copiedTracking, setCopiedTracking] = useState(false);
  const returnPage = window.history.state?.from === 'login' ? 'login' : 'home';

  function rememberResult(nextResult, code = lookupCode) {
    const record = { ...nextResult, lookupCode: String(code || '').toUpperCase() };
    saveGuestOrderSession(record);
    setResult(record);
    return record;
  }

  useEffect(() => {
    if (!initialSession?.orderNo || !initialSession?.guestAccessToken) return undefined;
    let alive = true;
    fetchGuestOrderDetails({
      orderNo: initialSession.orderNo,
      guestAccessToken: initialSession.guestAccessToken,
    }).then(nextResult => {
      if (!alive) return;
      rememberResult(nextResult, initialSession.lookupCode);
      setError('');
    }).catch(restoreError => {
      if (!alive) return;
      clearGuestOrderSession();
      setResult(null);
      setError(restoreError?.message || '查詢授權已過期，請重新輸入查詢碼與手機號碼。');
    }).finally(() => {
      if (alive) setRestoring(false);
    });
    return () => { alive = false; };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const nextResult = await lookupGuestOrder({ lookupCode, phone });
      rememberResult(nextResult);
      setPhone('');
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    } catch (lookupError) {
      setError(lookupError?.message || '查詢資料不正確，請確認查詢碼與手機號碼。');
    } finally {
      setLoading(false);
    }
  }

  async function refreshOrder() {
    if (!result?.order?.id || !result?.guestAccessToken || loading) return;
    setLoading(true);
    setError('');
    try {
      const nextResult = await fetchGuestOrderDetails({
        orderNo: result.order.id,
        guestAccessToken: result.guestAccessToken,
      });
      rememberResult(nextResult, result.lookupCode);
    } catch (refreshError) {
      clearGuestOrderSession();
      setResult(null);
      setError(refreshError?.message || '查詢授權已過期，請重新輸入查詢碼與手機號碼。');
    } finally {
      setLoading(false);
    }
  }

  function openPayment() {
    const order = result?.order || {};
    const instruction = result?.instruction || {};
    const subtotal = Number(order.subtotal) || 0;
    const discount = Number(order.discount) || 0;
    const shipping = Number(order.shipping) || 0;
    const total = Number(order.total) || 0;
    const method = instruction.payment_method || 'atm';
    const saved = savePendingPayment({
      orderNo: order.id,
      accessType: 'guest',
      guestAccessToken: result.guestAccessToken,
      lookupCode: result.lookupCode,
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
        fulfillmentMethod: order.fulfillment_method || 'delivery',
        promotion: order.promotion_name
          ? { id: `guest-${order.id}`, name: order.promotion_name }
          : null,
        items: Array.isArray(order.items) ? order.items : [],
      },
    });
    if (!saved) {
      setError('瀏覽器無法保存付款資訊，請稍後再試。');
      return;
    }
    setPage('checkout');
  }

  async function retryPayment() {
    if (!order?.id || !result?.guestAccessToken || loading) return;
    setLoading(true);
    setError('');
    try {
      const retry = await retrySinopacPayment({
        orderNo:order.id,
        guestAccessToken:result.guestAccessToken,
      });
      const authoritativeOrder = retry.order || order;
      const subtotal = Number(authoritativeOrder.subtotal ?? order.subtotal) || 0;
      const discount = Number(authoritativeOrder.discount ?? order.discount) || 0;
      const shipping = Number(authoritativeOrder.shipping ?? order.shipping) || 0;
      const total = Number(authoritativeOrder.total ?? order.total) || 0;
      const saved = savePendingPayment({
        orderNo:order.id,
        accessType:'guest',
        guestAccessToken:result.guestAccessToken,
        resultAccessToken:retry.resultAccessToken,
        lookupCode:result.lookupCode,
        amount:total,
        method:instruction?.payment_method || 'card',
        methodLabel:PAYMENT_METHODS[instruction?.payment_method]?.label || '付款',
        paymentLink:retry.paymentLink,
        paymentDueAt:authoritativeOrder.payment_due_at || order.payment_due_at,
        response:retry.response,
        summary:{
          subtotal,
          discount,
          finalSubtotal:subtotal - discount,
          shipping,
          total,
          fulfillmentMethod:authoritativeOrder.fulfillment_method || order.fulfillment_method || 'delivery',
          promotion:authoritativeOrder.promotion_name ? { id:`guest-${order.id}`, name:authoritativeOrder.promotion_name } : null,
          items:Array.isArray(authoritativeOrder.items) ? authoritativeOrder.items : [],
        },
      });
      if (!saved) throw new Error('瀏覽器無法保存新的付款資訊');
      window.location.assign(retry.paymentLink);
    } catch (retryError) {
      setError(retryError?.message || '重新建立付款單失敗，請稍後再試。');
      setLoading(false);
    }
  }

  async function copyTracking(tracking) {
    try {
      await navigator.clipboard.writeText(tracking);
      setCopiedTracking(true);
      window.setTimeout(() => setCopiedTracking(false), 2000);
    } catch {
      setCopiedTracking(false);
    }
  }

  function startAnotherLookup() {
    clearGuestOrderSession();
    setResult(null);
    setLookupCode('');
    setPhone('');
    setError('');
  }

  const fieldStyle = {
    width:'100%', boxSizing:'border-box', border:'1px solid var(--light)', background:'var(--white)',
    padding:'13px 14px', fontFamily:'var(--font-body)', fontSize:14, color:'var(--black)', outline:'none',
  };
  const order = result?.order || null;
  const instruction = result?.instruction || null;
  const items = Array.isArray(order?.items) ? order.items : [];
  const dueTime = new Date(instruction?.payment_due_at || order?.payment_due_at || '').getTime();
  const paymentExpired = Number.isFinite(dueTime) && dueTime <= Date.now();
  const canResumePayment = result?.paymentState === 'pending'
    && ['awaiting_confirm', 'unpaid'].includes(order?.status)
    && !paymentExpired
    && !!instruction;
  const canRetryPayment = result?.paymentState === 'failed'
    && order?.status === 'unpaid'
    && !paymentExpired
    && ['card', 'apple', 'google'].includes(String(instruction?.payment_method || '').toLowerCase());

  return (
    <main style={{ minHeight:'80vh', paddingTop:68, background:'var(--off-white)' }}>
      <section style={{ maxWidth:920, margin:'0 auto', padding:isMobile ? '52px 20px 80px' : '76px 32px 96px' }}>
        {!order ? (
          <div style={{ maxWidth:560, margin:'0 auto', background:'var(--white)', border:'1px solid var(--light)', padding:isMobile ? '28px 20px' : '40px' }}>
            <p style={{ color:'var(--gold)', fontSize:11, letterSpacing:'0.2em', marginBottom:10 }}>GUEST ORDER</p>
            <h1 style={{ fontFamily:'var(--font-display)', fontSize:isMobile ? 28 : 36, fontWeight:400, marginBottom:12 }}>訪客訂單查詢</h1>
            <p style={{ color:'var(--dark)', fontSize:13, lineHeight:1.8, marginBottom:28 }}>
              請輸入訂單成立信中的短查詢碼，以及結帳時填寫的手機號碼，即可查看訂單、付款及物流狀態。
            </p>
            <form onSubmit={handleSubmit} style={{ display:'grid', gap:20 }}>
              <label style={{ display:'grid', gap:7, fontSize:12, color:'var(--dark)' }}>
                訪客查詢碼
                <input autoComplete="off" inputMode="text" maxLength={11} placeholder="ABCDE-12345" required style={{ ...fieldStyle, letterSpacing:'0.12em', textTransform:'uppercase' }} value={lookupCode} onChange={event => setLookupCode(event.target.value)} />
              </label>
              <label style={{ display:'grid', gap:7, fontSize:12, color:'var(--dark)' }}>
                結帳手機號碼
                <input autoComplete="tel" inputMode="tel" placeholder="09xx-xxx-xxx" required style={fieldStyle} type="tel" value={phone} onChange={event => setPhone(event.target.value)} />
              </label>
              {error && <div role="alert" style={{ color:'#991b1b', background:'#fef2f2', border:'1px solid #fecaca', padding:'12px 14px', fontSize:12, lineHeight:1.7 }}>{error}</div>}
              <button disabled={loading || restoring} type="submit" style={{ border:'none', background:'var(--black)', color:'var(--white)', padding:'14px 18px', fontFamily:'var(--font-body)', fontSize:12, letterSpacing:'0.12em', cursor:loading ? 'wait' : 'pointer', opacity:loading || restoring ? 0.65 : 1 }}>
                {loading || restoring ? '查詢中…' : '查看訂單'}
              </button>
            </form>
            <button type="button" onClick={() => setPage(returnPage)} style={{ display:'block', margin:'22px auto 0', border:'none', background:'transparent', color:'var(--dark)', fontFamily:'var(--font-body)', fontSize:12, textDecoration:'underline', textUnderlineOffset:3, cursor:'pointer' }}>返回</button>
          </div>
        ) : (
          <div style={{ display:'grid', gap:18 }}>
            <div style={{ background:'var(--white)', border:'1px solid var(--light)', padding:isMobile ? '24px 20px' : '30px 32px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:20, flexWrap:'wrap' }}>
                <div>
                  <p style={{ color:'var(--gold)', fontSize:11, letterSpacing:'0.2em', marginBottom:9 }}>GUEST ORDER</p>
                  <h1 style={{ fontFamily:'var(--font-display)', fontSize:isMobile ? 26 : 34, fontWeight:400, marginBottom:10 }}>訪客訂單明細</h1>
                  <div style={{ fontSize:12, color:'var(--dark)', lineHeight:1.8, wordBreak:'break-all' }}>訂單編號：{order.id}</div>
                  <div style={{ fontSize:12, color:'var(--dark)' }}>成立時間：{formatDateTime(order.created_at || order.date) || '—'}</div>
                </div>
                <div style={{ display:'flex', gap:7, flexWrap:'wrap', justifyContent:'flex-end' }}>
                  {result.paymentState && <span style={{ border:`1px solid ${getPaymentStateColor(result.paymentState)}`, color:getPaymentStateColor(result.paymentState), padding:'7px 10px', fontSize:11, letterSpacing:'0.06em', flexShrink:0 }}>{getPaymentStateLabel(result.paymentState)}</span>}
                  <span style={{ border:`1px solid ${statusColor(order.status)}`, color:statusColor(order.status), padding:'7px 12px', fontSize:12, letterSpacing:'0.08em', flexShrink:0 }}>{getOrderStatusLabel(order.status)}</span>
                </div>
              </div>
              {restoring && <p role="status" style={{ fontSize:11, color:'var(--mid)', marginTop:14 }}>正在更新最新訂單狀態…</p>}
              {error && <div role="alert" style={{ marginTop:16, color:'#991b1b', background:'#fef2f2', border:'1px solid #fecaca', padding:'12px 14px', fontSize:12, lineHeight:1.7 }}>{error}</div>}
            </div>

            <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : 'minmax(0, 1.35fr) minmax(280px, 0.65fr)', gap:18, alignItems:'start' }}>
              <div style={{ background:'var(--white)', border:'1px solid var(--light)', padding:isMobile ? 20 : 28 }}>
                <h2 style={{ fontSize:16, fontWeight:500, marginBottom:20 }}>商品與金額</h2>
                <div style={{ display:'grid', gap:14 }}>
                  {items.map((item, index) => {
                    const imageSrc = getProductImagePublicUrl(item.image_storage_path || item.imageStoragePath) || item.img || '';
                    return (
                      <div key={`${item.product_id || item.id}-${item.variant_id || index}`} style={{ display:'grid', gridTemplateColumns:imageSrc ? '54px minmax(0, 1fr) auto' : 'minmax(0, 1fr) auto', gap:12, alignItems:'center' }}>
                        {imageSrc && <img src={imageSrc} alt={item.nameZh || item.name || '商品'} style={{ width:54, height:54, objectFit:'contain', background:'var(--off-white)' }} />}
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontSize:13, color:'var(--black)', marginBottom:3 }}>{item.nameZh || item.name || '商品'}</div>
                          <div style={{ fontSize:11, color:'var(--dark)' }}>{item.size || '單一規格'} · 數量 {Number(item.qty) || 1}</div>
                        </div>
                        <div style={{ fontFamily:'var(--font-display)', fontSize:13, whiteSpace:'nowrap' }}>NT$ {(Number(item.unit_price ?? item.price) * (Number(item.qty) || 1)).toLocaleString()}</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ borderTop:'1px solid var(--light)', marginTop:20, paddingTop:16, display:'grid', gap:9, fontSize:13 }}>
                  <div style={{ display:'flex', justifyContent:'space-between' }}><span>小計</span><span>NT$ {Number(order.subtotal || 0).toLocaleString()}</span></div>
                  {Number(order.discount) > 0 && <div style={{ display:'flex', justifyContent:'space-between', color:'var(--gold)' }}><span>活動折扣{order.promotion_name ? ` · ${order.promotion_name}` : ''}</span><span>−NT$ {Number(order.discount).toLocaleString()}</span></div>}
                  <div style={{ display:'flex', justifyContent:'space-between' }}><span>運費</span><span>{Number(order.shipping) === 0 ? '免運' : `NT$ ${Number(order.shipping).toLocaleString()}`}</span></div>
                  <div style={{ display:'flex', justifyContent:'space-between', borderTop:'1px solid var(--light)', paddingTop:12, fontWeight:600 }}><span>合計</span><span style={{ fontFamily:'var(--font-display)', fontSize:18 }}>NT$ {Number(order.total || 0).toLocaleString()}</span></div>
                </div>
              </div>

              <div style={{ display:'grid', gap:18 }}>
                <div style={{ background:'var(--white)', border:'1px solid var(--light)', padding:22 }}>
                  <h2 style={{ fontSize:15, fontWeight:500, marginBottom:14 }}>付款狀態</h2>
                  <div style={{ fontSize:13, marginBottom:8 }}>{order.status === 'returned' ? '訂單已退貨' : getPaymentStateLabel(result.paymentState)}</div>
                  {instruction?.payment_method && <div style={{ fontSize:11, color:'var(--dark)', marginBottom:5 }}>付款方式：{PAYMENT_METHODS[instruction.payment_method]?.label || instruction.payment_method}</div>}
                  {instruction?.payment_due_at && result.paymentState === 'pending' && <div style={{ fontSize:11, color:'var(--dark)', lineHeight:1.6 }}>付款期限：{formatDateTime(instruction.payment_due_at)}</div>}
                  {canResumePayment && <button type="button" onClick={openPayment} style={{ width:'100%', marginTop:16, border:'none', background:'var(--black)', color:'var(--white)', padding:'12px 14px', fontFamily:'inherit', fontSize:12, letterSpacing:'0.08em', cursor:'pointer' }}>查看付款資訊／繼續付款</button>}
                  {canRetryPayment && <button type="button" disabled={loading} onClick={retryPayment} style={{ width:'100%', marginTop:16, border:'none', background:'var(--black)', color:'var(--white)', padding:'12px 14px', fontFamily:'inherit', fontSize:12, letterSpacing:'0.08em', cursor:loading ? 'wait' : 'pointer', opacity:loading ? 0.65 : 1 }}>{loading ? '正在建立付款單…' : '重新付款'}</button>}
                  {!canResumePayment && ['expired', 'cancelled'].includes(result.paymentState) && <p style={{ marginTop:12, fontSize:11, color:'#8a3c2c', lineHeight:1.6 }}>付款期限已過，無法重新付款或建立第二張付款單。</p>}
                </div>

                <div style={{ background:'var(--white)', border:'1px solid var(--light)', padding:22 }}>
                  <h2 style={{ fontSize:15, fontWeight:500, marginBottom:14 }}>{order.fulfillment_method === 'onsite_pickup' ? '取貨狀態' : '物流狀態'}</h2>
                  {order.fulfillment_method === 'onsite_pickup' ? (
                    <p style={{ fontSize:12, color:'var(--dark)', lineHeight:1.7 }}>{order.status === 'ready_for_pickup' ? '客訂商品已可現場取貨。' : order.status === 'picked_up' ? '客訂商品已完成取貨。' : '客訂商品正在處理中，完成備貨後將更新為可取貨。'}</p>
                  ) : order.tracking ? (
                    <>
                      <div style={{ fontSize:12, color:'var(--dark)', marginBottom:5 }}>物流公司：順豐速運</div>
                      <div style={{ fontSize:12, color:'var(--dark)', marginBottom:5, overflowWrap:'anywhere' }}>托運單號：{order.tracking}</div>
                      {order.shipped_at && <div style={{ fontSize:11, color:'var(--dark)', marginBottom:12 }}>出貨時間：{formatDateTime(order.shipped_at)}</div>}
                      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                        <button type="button" onClick={() => copyTracking(order.tracking)} style={{ border:'1px solid var(--light)', background:'var(--white)', color:'var(--dark)', padding:'8px 10px', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>{copiedTracking ? '已複製' : '複製單號'}</button>
                        <a href={SF_EXPRESS_TRACKING_URL} target="_blank" rel="noreferrer" style={{ border:'1px solid var(--black)', background:'var(--black)', color:'var(--white)', padding:'8px 10px', fontSize:11, textDecoration:'none' }}>前往順豐查件</a>
                      </div>
                      <p style={{ fontSize:11, color:'var(--dark)', lineHeight:1.7, marginTop:12 }}>後續派送或取件通知以順豐電話、簡訊或 APP 推播為準，請保持收件電話暢通。</p>
                    </>
                  ) : (
                    <p style={{ fontSize:12, color:'var(--dark)', lineHeight:1.7 }}>{['paid', 'preparing'].includes(order.status) ? '訂單正在備貨，出貨後將於此顯示托運單號。' : order.status === 'delivered' ? '訂單已到貨。' : '目前尚未建立物流資料。'}</p>
                  )}
                </div>
              </div>
            </div>

            <div style={{ display:'flex', justifyContent:'center', gap:12, flexWrap:'wrap' }}>
              <button type="button" disabled={loading} onClick={refreshOrder} style={{ border:'1px solid var(--black)', background:'var(--white)', color:'var(--black)', padding:'11px 18px', fontFamily:'inherit', fontSize:12, cursor:loading ? 'wait' : 'pointer' }}>{loading ? '更新中…' : '更新訂單狀態'}</button>
              <button type="button" onClick={startAnotherLookup} style={{ border:'1px solid var(--black)', background:'var(--black)', color:'var(--white)', padding:'11px 18px', fontFamily:'inherit', fontSize:12, cursor:'pointer' }}>查詢其他訂單</button>
              <button type="button" onClick={() => setPage(returnPage)} style={{ border:'none', background:'transparent', color:'var(--dark)', padding:'11px 12px', fontFamily:'inherit', fontSize:12, textDecoration:'underline', textUnderlineOffset:3, cursor:'pointer' }}>返回</button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
