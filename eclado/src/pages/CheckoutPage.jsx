import React, { useState } from 'react';
import CheckoutField from '../components/checkout/CheckoutField.jsx';
import CheckoutOrderSummary from '../components/checkout/CheckoutOrderSummary.jsx';
import CheckoutSteps from '../components/checkout/CheckoutSteps.jsx';
import PaymentInfo from '../components/checkout/PaymentInfo.jsx';
import useIsMobile from '../hooks/useIsMobile.js';
import {
  getFulfillmentInfo,
  getMemberPrice,
  getMemberRole,
} from '../domain/catalog.jsx';
import { calculateDiscount } from '../domain/promotions.js';
import {
  PAYMENT_METHODS,
  SINOPAC_NOTIFY_API,
  SINOPAC_PAYMENT_API,
  addDays,
  buildPaymentNotes,
  extractPaymentLink,
  formatDateCompact,
  formatTimeCompact,
  getSinopacPaymentError,
  safeTrim,
} from '../domain/payments.js';
import { saveOrder } from '../services/orders.js';
import { createSinopacPayment } from '../services/paymentApi.js';

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
  const [orderNo] = useState(() => `ECL-${Date.now().toString().slice(-8)}`);
  const [paymentMethod, setPaymentMethod] = useState('atm');
  const [paymentResult, setPaymentResult] = useState(null);
  const [paymentSnapshot, setPaymentSnapshot] = useState(null);
  const [paymentSummary, setPaymentSummary] = useState(null);
  const [paymentError, setPaymentError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copiedAtmNo, setCopiedAtmNo] = useState(false);
  const isMobile = useIsMobile();

  const { subtotal, discount, finalSubtotal, promotion } = calculateDiscount(cart, promotions, user);
  const shipping = cart.every(i => i.id === 9) ? 0 : 120;
  const total = finalSubtotal + shipping;

  const STEPS = ['收件資訊', '確認付款', '完成'];

  function setField(name) {
    return e => setForm(f => ({ ...f, [name]: e.target.value }));
  }

  function productNameForPayment() {
    if (!cart.length) return 'ECLADO訂單';
    if (cart.length === 1) return cart[0].nameZh;
    return `${cart[0].nameZh} 等 ${cart.length} 項商品`;
  }


  async function insertOrder(paymentData, method) {
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const noteParts = [safeTrim(form.note), buildPaymentNotes(method.label, paymentData)].filter(Boolean);
    const order = {
      id: orderNo,
      member: form.name || user?.name || '訪客',
      type: getMemberRole(user),
      items: cart.map(i => {
        const fulfillment = getFulfillmentInfo(i);
        return {
          id: i.id,
          name: i.nameZh,
          qty: i.qty,
          price: getMemberPrice(i, user),
          fulfillment: fulfillment.label,
          fulfillment_type: fulfillment.type,
          shipping_time: fulfillment.shipping,
          stock_at_order: Number(i.stock ?? 0),
        };
      }),
      total,
      subtotal,
      discount,
      promotion_id: promotion?.id || null,
      promotion_name: promotion?.name || null,
      status: method.pendingStatus || 'unpaid',
      date: dateStr,
      address: `${form.city}${form.district}${form.address}`,
      phone: form.phone,
      email: form.email,
      note: noteParts.join('\n\n'),
      transfer_last5: paymentData?.ATMParam?.AtmPayNo ? paymentData.ATMParam.AtmPayNo.slice(-5) : '',
      user_id: user?.uid || null,
    };
    return saveOrder(order);
  }

  async function handleNext(e) {
    e.preventDefault();
    if (step === 1) {
      window.scrollTo(0, 0);
      setStep(2);
      return;
    }
    if (step !== 2) return;

    const method = PAYMENT_METHODS[paymentMethod] || PAYMENT_METHODS.atm;
    const expiresAt = addDays(new Date(), 1);
    const payload = {
      orderNo,
      amount: total,
      prdtName: productNameForPayment(),
      payType: method.payType,
      expireDate: formatDateCompact(expiresAt),
      expireTime: formatTimeCompact(expiresAt),
      returnUrl: `${SINOPAC_PAYMENT_API}/return?orderNo=${encodeURIComponent(orderNo)}`,
      backendUrl: `${SINOPAC_NOTIFY_API}?orderNo=${encodeURIComponent(orderNo)}`,
      qrCodeStatus: 'Y',
      memo: safeTrim(form.note),
      Param1: orderNo,
    };
    if (method.choosePay) payload.choosePay = method.choosePay;

    setPaymentError('');
    setSubmitting(true);
    try {
      const apiResponse = await createSinopacPayment(payload);
      const sinopacError = getSinopacPaymentError(apiResponse);
      if (sinopacError) throw new Error(sinopacError);

      setPaymentSnapshot(cart.map(item => ({ ...item })));
      setPaymentSummary({ subtotal, discount, finalSubtotal, promotion, shipping, total, items: cart.map(item => ({ ...item })) });
      const insertError = await insertOrder(apiResponse, method);
      if (insertError) console.error(insertError);

      const paymentLink = extractPaymentLink(apiResponse);
      setPaymentResult({
        method: paymentMethod,
        methodLabel: method.label,
        request: payload,
        response: apiResponse,
        paymentLink,
        insertError: insertError ? (insertError.message || String(insertError)) : '',
      });
      setCart([]);
      window.scrollTo(0, 0);
      setStep(3);
    } catch (err) {
      console.error(err);
      const message = err?.name === 'AbortError'
        ? '付款服務連線逾時，請稍後再試或聯繫客服。'
        : '付款單建立失敗，請稍後再試或聯繫客服。' + (err?.message ? `（${err.message}）` : '');
      setPaymentError(message);
    } finally {
      setSubmitting(false);
    }
  }

  function copyAtmNo(atmNo) {
    navigator.clipboard?.writeText(atmNo);
    setCopiedAtmNo(true);
    setTimeout(() => setCopiedAtmNo(false), 2200);
  }


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
              onCopyAtmNo={copyAtmNo}
              orderNo={orderNo}
              paymentResult={paymentResult}
              total={total}
            />

            <div style={{ background:'var(--off-white)', padding:'24px 28px' }}>
              <p style={{ fontSize:10, letterSpacing:'0.2em', color:'var(--dark)', textTransform:'uppercase', marginBottom:16 }}>配送資訊</p>
              <div style={{ display:'grid', gridTemplateColumns:'auto 1fr', gap:'8px 20px', fontSize:13 }}>
                {[['收件人', form.name], ['手機', form.phone], ['地址', `${form.city}${form.district}${form.address}`], ['物流','宅配到府（順豐物流）']].map(([k, v]) => (
                  <React.Fragment key={k}>
                    <span style={{ color:'var(--dark)', whiteSpace:'nowrap' }}>{k}</span>
                    <span style={{ color:'var(--black)' }}>{v}</span>
                  </React.Fragment>
                ))}
              </div>
            </div>

            <p style={{ fontSize:12, color:'var(--dark)', lineHeight:1.8, textAlign:'center' }}>
              請依付款頁或虛擬帳號完成付款。系統會在永豐通知後更新訂單狀態。<br />
              如有疑問請透過官方 LINE 聯繫客服。
            </p>

            <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
              <button onClick={() => setPage('shop')} style={{ flex:1, background:'none', border:'1px solid var(--black)', color:'var(--black)', padding:'13px 0', fontSize:12, letterSpacing:'0.14em', cursor:'pointer', fontFamily:'var(--font-body)' }}>繼續購物</button>
              <button onClick={() => setPage('home')} style={{ flex:1, background:'var(--black)', color:'var(--white)', border:'none', padding:'13px 0', fontSize:12, letterSpacing:'0.14em', cursor:'pointer', fontFamily:'var(--font-body)' }}>返回首頁</button>
            </div>
          </div>

          <CheckoutOrderSummary
            items={paymentSnapshot?.items || cart}
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
                      <p style={{ fontSize:11, color:'var(--dark)' }}>順豐物流 · NT$ 120</p>
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
                      <button type="button" onClick={() => setStep(1)} style={{ background:'none', border:'none', fontSize:11, color:'var(--dark)', cursor:'pointer', textDecoration:'underline', fontFamily:'var(--font-body)', padding:0 }}>修改</button>
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
                            onClick={() => setPaymentMethod(key)}
                            style={{
                              width:'100%',
                              textAlign:'left',
                              border: active ? '2px solid var(--black)' : '1px solid var(--light)',
                              background: active ? 'var(--off-white)' : 'var(--white)',
                              padding:'16px 18px',
                              cursor:'pointer',
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
                  <button type="submit" disabled={submitting} style={{ background: submitting ? 'var(--dark)' : 'var(--black)', color:'var(--white)', border:'none', padding:'16px 0', fontSize:12, letterSpacing:'0.18em', textTransform:'uppercase', cursor: submitting ? 'wait' : 'pointer', fontFamily:'var(--font-body)', fontWeight:500, width:'100%', marginTop:8, opacity: submitting ? 0.7 : 1 }}>
                    {submitting ? '建立付款單中...' : '建立付款單'}
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
