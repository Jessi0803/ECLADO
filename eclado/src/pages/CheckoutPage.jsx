import React, { useEffect, useRef, useState } from 'react';
import CheckoutField from '../components/checkout/CheckoutField.jsx';
import CheckoutOrderSummary from '../components/checkout/CheckoutOrderSummary.jsx';
import CheckoutSteps from '../components/checkout/CheckoutSteps.jsx';
import PaymentInfo from '../components/checkout/PaymentInfo.jsx';
import useIsMobile from '../hooks/useIsMobile.js';
import { getMemberPrice, getMemberRole } from '../domain/catalog.jsx';
import { calculateDiscount } from '../domain/promotions.js';
import { calculateShipping } from '../domain/shipping.js';
import {
  PAYMENT_METHODS,
  SINOPAC_NOTIFY_API,
  SINOPAC_PAYMENT_API,
  extractPaymentLink,
  getPaymentResultStatus,
  getSinopacPaymentError,
  safeTrim,
} from '../domain/payments.js';
import { createAuthoritativeOrder } from '../services/orders.js';
import { createSinopacPayment, querySinopacPayment } from '../services/paymentApi.js';
import { clearPendingPayment, getPendingPayment, savePendingPayment } from '../services/pendingPayment.js';

// ─── CHECKOUT PAGE ────────────────────────────────────────────────────────────
export default function CheckoutPage({ cart, setCart, setPage, user, promotions = [] }) {
  const isLineEmail = user?.email?.startsWith('line.');
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: user?.name || '',
    phone: '',
    email: isLineEmail ? '' : (user?.email || ''),
    city: '',
    district: '',
    address: '',
    note: '',
  });
  const [orderNo, setOrderNo] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('atm');
  const [paymentResult, setPaymentResult] = useState(null);
  const [paymentSnapshot, setPaymentSnapshot] = useState(null);
  const [paymentSummary, setPaymentSummary] = useState(null);
  const [paymentError, setPaymentError] = useState('');
  const [paymentState, setPaymentState] = useState('pending');
  const [storedPayment] = useState(() => getPendingPayment());
  const [restoringPayment, setRestoringPayment] = useState(!!storedPayment);
  const [pendingAuthoritativeOrder, setPendingAuthoritativeOrder] = useState(null);
  const [pricingChanges, setPricingChanges] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [copiedAtmNo, setCopiedAtmNo] = useState(false);
  const isMobile = useIsMobile();

  // Browser values are a preview. The order RPC recalculates member prices and
  // chooses the single best live promotion before any payment request is made.
  const { subtotal, discount, finalSubtotal, promotion } =
    calculateDiscount(cart, promotions, user);
  const shipping = calculateShipping(cart, user, finalSubtotal);
  const total = finalSubtotal + shipping;

  const STEPS = ['收件資訊', '確認付款', '完成'];

  function hydrateStoredPayment(payment, state, queryResponse = null) {
    const method = PAYMENT_METHODS[payment.method] || PAYMENT_METHODS.atm;
    const summary = payment.summary || {
      subtotal: payment.amount,
      discount: 0,
      finalSubtotal: payment.amount,
      promotion: null,
      shipping: 0,
      total: payment.amount,
      items: [],
    };
    setOrderNo(payment.orderNo);
    setPaymentMethod(payment.method || 'atm');
    setPaymentSummary(summary);
    setPaymentSnapshot(summary.items || []);
    setPaymentResult({
      method: payment.method,
      methodLabel: payment.methodLabel || method.label,
      request: { paymentToken: payment.paymentToken },
      response: payment.response || queryResponse || {},
      paymentDeadline: payment.paymentDeadline || null,
      paymentLink: payment.paymentLink || '',
      lookupCode: payment.lookupCode || '',
      orderEmailSent: typeof payment.orderEmailSent === 'boolean' ? payment.orderEmailSent : null,
      insertError: '',
    });
    setPaymentState(state);
    setStep(3);
  }

  async function restorePayment() {
    if (!storedPayment) return;
    setRestoringPayment(true);
    try {
      const result = await querySinopacPayment(storedPayment);
      const gatewayState = getPaymentResultStatus(result.response);
      const deadlineTime = new Date(
        result.order?.payment_due_at || storedPayment.paymentDueAt || '',
      ).getTime();
      const deadlineExpired = Number.isFinite(deadlineTime) && deadlineTime <= Date.now();
      const state = result.paymentState
        || (gatewayState !== 'pending' ? gatewayState : deadlineExpired ? 'expired' : 'pending');
      hydrateStoredPayment(storedPayment, state, result.response);
    } catch {
      hydrateStoredPayment(storedPayment, 'error');
    } finally {
      setRestoringPayment(false);
    }
  }

  useEffect(() => {
    restorePayment();
    // The stored payment is intentionally read once when /checkout mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setField(name) {
    return e => setForm(f => ({ ...f, [name]: e.target.value }));
  }

  function productNameForPayment() {
    if (!cart.length) return 'ECLADO訂單';
    if (cart.length === 1) return cart[0].nameZh;
    return `${cart[0].nameZh} 等 ${cart.length} 項商品`;
  }

  function toPaymentSummary(authoritativeOrder) {
    const items = authoritativeOrder.items.map(item => ({ ...item }));
    return {
      subtotal: authoritativeOrder.subtotal,
      discount: authoritativeOrder.discount,
      finalSubtotal: authoritativeOrder.subtotal - authoritativeOrder.discount,
      promotion: authoritativeOrder.promotion,
      shipping: authoritativeOrder.shipping,
      total: authoritativeOrder.total,
      items,
    };
  }

  function getPricingChanges(authoritativeOrder) {
    const changes = [];
    const previewRole = getMemberRole(user);
    const checks = [
      ['會員價格資格', previewRole, authoritativeOrder.member_role],
      ['商品小計', subtotal, authoritativeOrder.subtotal],
      ['活動折抵', discount, authoritativeOrder.discount],
      ['套用活動', promotion?.id || null, authoritativeOrder.promotion?.id || null],
      ['運費', shipping, authoritativeOrder.shipping],
      ['訂單總額', total, authoritativeOrder.total],
    ];
    checks.forEach(([label, preview, authoritative]) => {
      if (String(preview ?? '') !== String(authoritative ?? '')) {
        changes.push({ label, preview, authoritative });
      }
    });

    // Only a real unit-price change should require another confirmation.
    // Product/variant identifiers can be returned by Postgres in a different
    // representation (for example numeric ID vs text) without changing what
    // the customer pays, so they must not be treated as a price change.
    const unitPricesChanged = cart.length !== authoritativeOrder.items.length
      || cart.some((item, index) => (
        Number(getMemberPrice(item, user))
        !== Number(authoritativeOrder.items[index]?.unit_price ?? authoritativeOrder.items[index]?.price)
      ));
    if (unitPricesChanged) {
      changes.push({
        label: '商品成交單價',
        preview: '畫面預覽',
        authoritative: '後端已重新計算',
      });
    }
    return changes;
  }

  async function handleNext(e) {
    e.preventDefault();
    if (step === 1) {
      window.scrollTo(0, 0);
      setStep(2);
      return;
    }
    if (step !== 2) return;
    // React state is updated asynchronously, so multiple clicks in the same
    // event loop can enter this handler before `submitting` disables the
    // button. A synchronous ref closes that gap and prevents duplicate orders.
    if (submittingRef.current) return;
    submittingRef.current = true;

    const method = PAYMENT_METHODS[paymentMethod] || PAYMENT_METHODS.atm;
    setPaymentError('');
    setSubmitting(true);
    try {
      const authoritativeOrder = pendingAuthoritativeOrder || await createAuthoritativeOrder({
          items: cart,
          member: form.name || user?.name || '訪客',
          address: `${form.city}${form.district}${form.address}`,
          phone: form.phone,
          email: form.email,
          note: safeTrim(form.note),
          paymentMethod,
        });
      const authoritativeOrderNo = authoritativeOrder.order_id;
      setOrderNo(authoritativeOrderNo);
      const authoritativeSummary = toPaymentSummary(authoritativeOrder);
      setPaymentSnapshot(authoritativeSummary.items);
      setPaymentSummary(authoritativeSummary);

      if (!pendingAuthoritativeOrder) {
        const changes = getPricingChanges(authoritativeOrder);
        if (changes.length > 0) {
          setPendingAuthoritativeOrder(authoritativeOrder);
          setPricingChanges(changes);
          window.scrollTo(0, 0);
          return;
        }
      }

      const payload = {
        orderNo: authoritativeOrderNo,
        paymentToken: authoritativeOrder.paymentToken,
        amount: authoritativeOrder.total,
        prdtName: productNameForPayment(),
        payType: method.payType,
        returnUrl: `${SINOPAC_PAYMENT_API}/return?orderNo=${encodeURIComponent(authoritativeOrderNo)}`,
        backendUrl: `${SINOPAC_NOTIFY_API}?orderNo=${encodeURIComponent(authoritativeOrderNo)}`,
        qrCodeStatus: 'Y',
        memo: safeTrim(form.note),
        Param1: authoritativeOrderNo,
      };
      if (method.choosePay) payload.choosePay = method.choosePay;

      const paymentApiResult = await createSinopacPayment(payload);
      const apiResponse = paymentApiResult.response;
      const sinopacError = getSinopacPaymentError(apiResponse);
      if (sinopacError) throw new Error(sinopacError);

      const paymentLink = extractPaymentLink(apiResponse);
      const nextPaymentResult = {
        method: paymentMethod,
        methodLabel: method.label,
        request: payload,
        response: apiResponse,
        paymentDeadline: paymentApiResult.paymentDeadline,
        paymentLink,
        lookupCode: paymentApiResult.guestLookupCode,
        orderEmailSent: paymentApiResult.orderEmailSent,
        insertError: '',
      };
      const saved = savePendingPayment({
        orderNo: authoritativeOrderNo,
        paymentToken: authoritativeOrder.paymentToken,
        amount: authoritativeOrder.total,
        method: paymentMethod,
        methodLabel: method.label,
        paymentLink,
        paymentDeadline: paymentApiResult.paymentDeadline,
        paymentDueAt: paymentApiResult.order?.payment_due_at,
        lookupCode: paymentApiResult.guestLookupCode,
        orderEmailSent: paymentApiResult.orderEmailSent,
        response: apiResponse,
        summary: authoritativeSummary,
      });
      setPaymentResult({
        ...nextPaymentResult,
        recoveryWarning: saved ? '' : '瀏覽器未能保存付款資訊，請勿重新整理或重複建立付款單，並請先記下訂單編號。',
      });
      setPaymentState('pending');
      setPendingAuthoritativeOrder(null);
      setPricingChanges([]);
      if (saved) setCart([]);
      window.scrollTo(0, 0);
      setStep(3);
    } catch (err) {
      console.error(err);
      const message = err?.name === 'AbortError'
        ? '付款服務連線逾時，請稍後再試或聯繫客服。'
        : '付款單建立失敗，請稍後再試或聯繫客服。' + (err?.message ? `（${err.message}）` : '');
      setPaymentError(message);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function copyAtmNo(atmNo) {
    navigator.clipboard?.writeText(atmNo);
    setCopiedAtmNo(true);
    setTimeout(() => setCopiedAtmNo(false), 2200);
  }

  function goToPayment() {
    if (paymentState !== 'pending' || !paymentResult?.paymentLink) return;
    window.location.assign(paymentResult.paymentLink);
  }

  function startNewOrder() {
    clearPendingPayment();
    setPage('shop');
  }


  if (restoringPayment) return (
    <main style={{ minHeight:'75vh', paddingTop:68, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div role="status" style={{ textAlign:'center', padding:'60px 20px' }}>
        <p style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:300, marginBottom:12 }}>正在確認原付款單</p>
        <p style={{ color:'var(--dark)', fontSize:13 }}>請勿重新付款或關閉頁面。</p>
      </div>
    </main>
  );


  if (step === 3) return (
    <div style={{ paddingTop:68, minHeight:'80vh' }}>
      <div style={{ maxWidth:960, margin:'0 auto', padding: isMobile ? '40px 20px' : '60px 40px' }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize: isMobile ? 28 : 36, fontWeight:300, marginBottom:36 }}>結帳</h1>
        <CheckoutSteps steps={STEPS} currentStep={step} />

        <div style={{ maxWidth:520, margin:'0 auto', textAlign:'center' }}>
          <div style={{ width:56, height:56, border:'1px solid var(--black)', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 20px', fontSize:22 }}>✓</div>
          <h2 style={{ fontFamily:'var(--font-display)', fontSize:30, fontWeight:300, marginBottom:10 }}>付款單已建立</h2>
          <p style={{ fontSize:13, color:'var(--dark)', marginBottom:26 }}>訂單編號：<strong style={{ color:'var(--dark)', letterSpacing:'0.06em', fontFamily:'var(--font-display)', fontVariantNumeric:'tabular-nums' }}>{orderNo}</strong></p>
        </div>

        <div className="gcheckout">
          <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
            <PaymentInfo
              copiedAtmNo={copiedAtmNo}
              onGoToPayment={goToPayment}
              onCopyAtmNo={copyAtmNo}
              orderNo={orderNo}
              paymentResult={paymentResult}
              paymentState={paymentState}
              total={paymentSummary?.total || total}
            />

            {paymentState === 'error' && (
              <button type="button" onClick={restorePayment} style={{ background:'var(--black)', color:'var(--white)', border:'none', padding:'12px 18px', cursor:'pointer', fontFamily:'var(--font-body)', fontSize:12, letterSpacing:'0.12em' }}>
                重新查詢付款狀態
              </button>
            )}

            {paymentResult?.recoveryWarning && (
              <div role="alert" style={{ border:'1px solid #c47a16', background:'#fff4e5', color:'#5a3a10', padding:'12px 14px', fontSize:12, lineHeight:1.7 }}>
                {paymentResult.recoveryWarning}
              </div>
            )}

            {(form.name || form.phone || form.address) && <div style={{ background:'var(--off-white)', padding:'24px 28px' }}>
              <p style={{ fontSize:10, letterSpacing:'0.2em', color:'var(--dark)', textTransform:'uppercase', marginBottom:16 }}>配送資訊</p>
              <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:'8px 20px', fontSize:13 }}>
                {[['收件人', form.name], ['手機', form.phone], ['地址', `${form.city}${form.district}${form.address}`], ['物流','宅配到府（順豐物流）']].map(([k, v]) => (
                  <React.Fragment key={k}>
                    <span style={{ color:'var(--dark)', whiteSpace:'nowrap' }}>{k}</span>
                    <span style={{ color:'var(--black)' }}>{v}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>}

            <p style={{ fontSize:12, color:'var(--dark)', lineHeight:1.8, textAlign:'center' }}>
              請依付款頁或虛擬帳號完成付款。系統會在永豐通知後更新訂單狀態。<br />
              如有疑問請透過官方 LINE 聯繫客服。
            </p>

            <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
              <button onClick={() => setPage('shop')} style={{ flex:1, background:'none', border:'1px solid var(--black)', color:'var(--black)', padding:'13px 0', fontSize:12, letterSpacing:'0.14em', cursor:'pointer', fontFamily:'var(--font-body)' }}>繼續購物</button>
              <button onClick={() => setPage('home')} style={{ flex:1, background:'var(--black)', color:'var(--white)', border:'none', padding:'13px 0', fontSize:12, letterSpacing:'0.14em', cursor:'pointer', fontFamily:'var(--font-body)' }}>返回首頁</button>
            </div>
            {['paid', 'expired', 'cancelled', 'failed'].includes(paymentState) && (
              <button type="button" onClick={startNewOrder} style={{ width:'100%', background:'transparent', color:'var(--dark)', border:'none', padding:'8px 0', cursor:'pointer', fontFamily:'var(--font-body)', fontSize:12, textDecoration:'underline', textUnderlineOffset:3 }}>
                清除此付款紀錄並建立新訂單
              </button>
            )}
          </div>

          <CheckoutOrderSummary
            items={paymentSnapshot || cart}
            summary={paymentSummary || { subtotal, discount, finalSubtotal, promotion, shipping, total }}
            user={user}
          />
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ paddingTop:68 }}>
      <div style={{ maxWidth:960, margin:'0 auto', padding: isMobile ? '40px 20px' : '60px 40px' }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize: isMobile ? 28 : 36, fontWeight:300, marginBottom:36 }}>結帳</h1>
        <CheckoutSteps steps={STEPS} currentStep={step} />

        <form onSubmit={handleNext}>
          <div className="gcheckout">
            <div>
              {step === 1 && (
                <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
                  <div style={{ background:'var(--off-white)', border:'1px solid var(--light)', padding:'16px 20px', display:'flex', alignItems:'center', gap:14 }}>
                    <div style={{ width:36, height:36, background:'var(--black)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                    </div>
                    <div>
                      <p style={{ fontSize:12, fontWeight:500, color:'var(--black)', marginBottom:2 }}>宅配到府</p>
                      <p style={{ fontSize:11, color:'var(--dark)' }}>順豐物流 · {shipping === 0 ? '免運' : `NT$ ${shipping}`}</p>
                    </div>
                  </div>

                  <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:20 }}>
                    <CheckoutField label="收件人姓名" name="name" value={form.name} onChange={setField('name')} />
                    <CheckoutField label="手機號碼" name="phone" type="tel" placeholder="09xx-xxx-xxx" value={form.phone} onChange={setField('phone')} />
                  </div>
                  <CheckoutField label="電子信箱" name="email" type="email" value={form.email} onChange={setField('email')} />

                  <div>
                    <label style={{ fontSize:11, letterSpacing:'0.12em', color:'var(--dark)', textTransform:'uppercase', display:'block', marginBottom:7 }}>收件地址 <span style={{ color:'var(--gold)' }}>*</span></label>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:12 }}>
                      {[['city','縣市'],['district','區域']].map(([k,ph]) => (
                        <input key={k} type="text" value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} required placeholder={ph}
                          style={{ border:'none', borderBottom:'1px solid var(--light)', padding:'10px 0', fontSize:14, fontFamily:'var(--font-body)', fontVariantNumeric:'tabular-nums', outline:'none', background:'none', color:'var(--black)' }}
                          onFocus={e => e.target.style.borderBottomColor='var(--black)'}
                          onBlur={e => e.target.style.borderBottomColor='var(--light)'}
                        />
                      ))}
                    </div>
                    <input type="text" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} required placeholder="路/街/巷/弄/號/樓"
                      style={{ width:'100%', border:'none', borderBottom:'1px solid var(--light)', padding:'10px 0', fontSize:14, fontFamily:'var(--font-body)', fontVariantNumeric:'tabular-nums', outline:'none', background:'none', color:'var(--black)', boxSizing:'border-box' }}
                      onFocus={e => e.target.style.borderBottomColor='var(--black)'}
                      onBlur={e => e.target.style.borderBottomColor='var(--light)'}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize:11, letterSpacing:'0.12em', color:'var(--dark)', textTransform:'uppercase', display:'block', marginBottom:7 }}>備註（選填）</label>
                    <textarea value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} rows={3} placeholder="如有特殊需求請於此備註"
                      style={{ width:'100%', border:'1px solid var(--light)', padding:'10px 12px', fontSize:13, fontFamily:'var(--font-body)', outline:'none', resize:'none', background:'none', color:'var(--black)', boxSizing:'border-box', lineHeight:1.7 }}
                      onFocus={e => e.target.style.borderColor='var(--black)'}
                      onBlur={e => e.target.style.borderColor='var(--light)'}
                    />
                  </div>

                  <button type="submit" style={{ background:'var(--black)', color:'var(--white)', border:'none', padding:'15px 0', fontSize:12, letterSpacing:'0.18em', textTransform:'uppercase', cursor:'pointer', fontFamily:'var(--font-body)', fontWeight:500, width:'100%', marginTop:8 }}>
                    繼續確認付款
                  </button>
                </div>
              )}

              {step === 2 && (
                <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
                  <div style={{ border:'1px solid var(--light)', padding:'20px 24px' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                      <p style={{ fontSize:10, letterSpacing:'0.2em', color:'var(--dark)', textTransform:'uppercase' }}>收件資訊</p>
                      <button type="button" disabled={!!pendingAuthoritativeOrder} onClick={() => setStep(1)} style={{ background:'none', border:'none', fontSize:11, color:'var(--dark)', cursor: pendingAuthoritativeOrder ? 'not-allowed' : 'pointer', opacity: pendingAuthoritativeOrder ? 0.45 : 1, textDecoration:'underline', fontFamily:'var(--font-body)', padding:0 }}>修改</button>
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:'8px 20px', fontSize:13 }}>
                      {[['收件人', form.name], ['手機', form.phone], ['Email', form.email], ['地址', `${form.city}${form.district}${form.address}`], ['物流','宅配到府（順豐物流）']].map(([k, v]) => (
                        <React.Fragment key={k}>
                          <span style={{ color:'var(--dark)', whiteSpace:'nowrap' }}>{k}</span>
                          <span style={{ color:'var(--black)' }}>{v}</span>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p style={{ fontSize:10, letterSpacing:'0.2em', color:'var(--dark)', textTransform:'uppercase', marginBottom:14 }}>付款方式</p>
                    <div style={{ display:'grid', gap:12 }}>
                      {Object.entries(PAYMENT_METHODS).map(([key, method]) => {
                        const active = paymentMethod === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            disabled={!!pendingAuthoritativeOrder}
                            onClick={() => setPaymentMethod(key)}
                            style={{
                              width:'100%',
                              textAlign:'left',
                              border: active ? '2px solid var(--black)' : '1px solid var(--light)',
                              background: active ? 'var(--off-white)' : 'var(--white)',
                              padding:'16px 18px',
                              cursor: pendingAuthoritativeOrder ? 'not-allowed' : 'pointer',
                              opacity: pendingAuthoritativeOrder && !active ? 0.5 : 1,
                            }}
                          >
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12 }}>
                              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                                <div style={{ width:18, height:18, borderRadius:'50%', border:`2px solid ${active ? 'var(--black)' : 'var(--mid)'}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                                  {active && <div style={{ width:8, height:8, borderRadius:'50%', background:'var(--black)' }} />}
                                </div>
                                <div>
                                  <div style={{ fontSize:14, fontWeight:500, color:'var(--black)', fontFamily:'var(--font-body)' }}>{method.label}</div>
                                  <div style={{ fontSize:11, color:'var(--dark)', marginTop:2, fontFamily:'var(--font-body)' }}>{method.description}</div>
                                </div>
                              </div>
                              <div style={{ fontSize:11, letterSpacing:'0.08em', color:'var(--dark)', fontFamily:'var(--font-body)', fontVariantNumeric:'tabular-nums' }}>{method.payType}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div style={{ background:'#fffbf0', border:'1px solid #e8d9b0', padding:'12px 14px', fontSize:11, color:'#5a4a1e', lineHeight:1.85, marginBottom:10 }}>
                    ⚠ <strong>退貨說明</strong>：本訂單商品為個人衛生用品，依《消費者保護法》第 19 條之 1，<strong>已拆封商品不適用七天猶豫期退貨</strong>。未拆封商品自收到次日起 7 日內可申請退貨（運費由消費者負擔）。如有品質瑕疵，不限拆封與否均可退換（運費由本公司負擔）。詳見<a href="/info" style={{ color:'#5a4a1e' }}>退換貨政策</a>。
                  </div>
                  {pricingChanges.length > 0 && (
                    <div role="alert" style={{ background:'#fff4e5', border:'2px solid #c47a16', padding:'16px 18px', color:'#5a3a10', lineHeight:1.7 }}>
                      <p style={{ fontSize:14, fontWeight:600, marginBottom:8 }}>成交金額已由後端更新，尚未建立付款單</p>
                      <p style={{ fontSize:12, marginBottom:10 }}>請確認右側最新訂單明細。只有再次按下確認按鈕後，系統才會建立永豐付款單。</p>
                      <ul style={{ margin:'0 0 0 18px', padding:0, fontSize:12 }}>
                        {pricingChanges.map(change => (
                          <li key={change.label}>{change.label}已重新確認</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <button type="submit" disabled={submitting} style={{ background: submitting ? 'var(--dark)' : 'var(--black)', color:'var(--white)', border:'none', padding:'16px 0', fontSize:12, letterSpacing:'0.18em', textTransform:'uppercase', cursor: submitting ? 'wait' : 'pointer', fontFamily:'var(--font-body)', fontWeight:500, width:'100%', marginTop:8, opacity: submitting ? 0.7 : 1 }}>
                    {submitting
                      ? '建立付款單中...'
                      : pendingAuthoritativeOrder
                        ? '確認更新後金額並建立付款單'
                        : '建立付款單'}
                  </button>
                  {paymentError && <p style={{ fontSize:12, color:'#c0392b', textAlign:'center', lineHeight:1.6 }}>{paymentError}</p>}
                  <p style={{ fontSize:11, color:'var(--dark)', textAlign:'center', lineHeight:1.6 }}>
                    送出即表示您同意本公司<a href="/info" style={{ color:'var(--dark)', textDecoration:'underline', textUnderlineOffset:2 }}>退換貨政策</a>及<a href="/privacy" style={{ color:'var(--dark)', textDecoration:'underline', textUnderlineOffset:2 }}>隱私權政策</a>
                  </p>
                </div>
              )}
            </div>

            <CheckoutOrderSummary
              items={paymentSnapshot?.items || cart}
              summary={paymentSummary || { subtotal, discount, finalSubtotal, promotion, shipping, total }}
              user={user}
            />
          </div>
        </form>
      </div>
    </div>
  );
}
