import React, { useEffect, useState } from 'react';
import {
  getMemberTier,
  isProfessionalMember,
} from '../domain/catalog.jsx';
import { getOrderStatusLabel } from '../domain/payments.js';
import { SF_EXPRESS_TRACKING_URL } from '../domain/shipping.js';
import useIsMobile from '../hooks/useIsMobile.js';
import useAdminAccess from '../hooks/useAdminAccess.js';
import {
  fetchLatestProApplication,
  goProfessionalApply,
  openAdmin,
} from '../services/membership.js';
import { fetchAccountOrders } from '../services/accountOrders.js';
import { fetchProfessionalApplicationStatus } from '../services/professionalApplications.js';
import { getMemberPaymentInstructions } from '../services/paymentApi.js';
import { getPendingPayment, savePendingPayment } from '../services/pendingPayment.js';

export default function AccountPage({ user, setPage, onSignOut }) {
  const isMobile = useIsMobile();
  const isAdmin = useAdminAccess(user?.uid);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [proAppStatus, setProAppStatus] = useState(null); // null | 'pending' | 'approved' | 'rejected'
  const [copiedTracking, setCopiedTracking] = useState('');
  const [openingPaymentOrder, setOpeningPaymentOrder] = useState('');
  const [paymentErrors, setPaymentErrors] = useState({});

  useEffect(() => {
    // SPA navigation keeps the previous page's scroll position. A long order
    // history would otherwise make Account open halfway down the page.
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);

  function paymentDeadlineFromIso(value) {
    const date = new Date(value || '');
    if (Number.isNaN(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const part = type => parts.find(item => item.type === type)?.value || '';
    return {
      expireDate: `${part('year')}${part('month')}${part('day')}`,
      expireTime: `${part('hour')}${part('minute')}`,
    };
  }

  async function openPendingPayment(order) {
    setOpeningPaymentOrder(order.id);
    setPaymentErrors(current => ({ ...current, [order.id]: '' }));
    try {
      if (getPendingPayment(order.id)) {
        setPage('checkout');
        return;
      }
      const result = await getMemberPaymentInstructions(order.id);
      const authoritativeOrder = result.order || order;
      const instruction = result.instruction || {};
      const subtotal = Number(authoritativeOrder.subtotal ?? order.subtotal) || 0;
      const discount = Number(authoritativeOrder.discount ?? order.discount) || 0;
      const shipping = Number(authoritativeOrder.shipping ?? order.shipping) || 0;
      const total = Number(authoritativeOrder.total ?? order.total) || 0;
      const saved = savePendingPayment({
        orderNo: order.id,
        accessType: 'member',
        amount: total,
        method: instruction.payment_method || authoritativeOrder.payment_method || order.payment_method || 'atm',
        paymentLink: instruction.payment_url || '',
        paymentDeadline: paymentDeadlineFromIso(instruction.payment_due_at || authoritativeOrder.payment_due_at),
        paymentDueAt: instruction.payment_due_at || authoritativeOrder.payment_due_at,
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
          fulfillmentMethod: authoritativeOrder.fulfillment_method || order.fulfillment_method || 'delivery',
          promotion: authoritativeOrder.promotion_name
            ? { id: `order-${order.id}`, name: authoritativeOrder.promotion_name }
            : null,
          items: Array.isArray(authoritativeOrder.items) ? authoritativeOrder.items : [],
        },
      });
      if (!saved) throw new Error('瀏覽器無法保存付款資訊');
      setPage('checkout');
    } catch (paymentError) {
      setPaymentErrors(current => ({
        ...current,
        [order.id]: paymentError?.message || '付款資訊無法載入，請稍後再試。',
      }));
    } finally {
      setOpeningPaymentOrder('');
    }
  }

  async function copyTracking(tracking) {
    try {
      await navigator.clipboard.writeText(tracking);
      setCopiedTracking(tracking);
      window.setTimeout(() => setCopiedTracking(current => current === tracking ? '' : current), 2000);
    } catch {
      setCopiedTracking('');
    }
  }

  function shipmentTime(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-TW', {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  useEffect(() => {
    if (!user?.uid || isProfessionalMember(user)) return;
    fetchProfessionalApplicationStatus(user.uid)
      .then(({ data }) => { if (data) setProAppStatus(data.status); });
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    let alive = true;
    async function loadOrders() {
      setLoading(true);
      setError('');
      const { data, error } = await fetchAccountOrders(user.uid);
      if (!alive) return;
      if (error) {
        setError('訂單資料無法載入，請稍後再試。');
        setOrders([]);
      } else {
        setOrders(data || []);
      }
      setLoading(false);
    }
    loadOrders();
    return () => { alive = false; };
  }, [user?.uid]);

  if (!user) {
    return (
      <div style={{ minHeight:'100vh', padding:'120px 24px 80px', background:'var(--white)' }}>
        <div style={{ maxWidth:720, margin:'0 auto', textAlign:'center' }}>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:isMobile ? 30 : 44, fontWeight:300, color:'var(--black)', marginBottom:16 }}>會員專區</h1>
          <p style={{ fontSize:14, color:'var(--dark)', lineHeight:1.8, marginBottom:28 }}>請先登入會員後查看訂單紀錄。</p>
          <button onClick={() => setPage('login')} style={{ background:'var(--black)', color:'var(--white)', border:'none', padding:'14px 30px', fontSize:12, letterSpacing:'0.12em', cursor:'pointer', fontFamily:'var(--font-body)' }}>前往登入</button>
        </div>
      </div>
    );
  }

  const isLineMember = user.email?.startsWith('line.');
  const visibleEmail = isLineMember ? '' : user.email;

  return (
    <div style={{ minHeight:'100vh', paddingTop:68, background:'var(--white)' }}>
      <div style={{ background:'var(--off-white)', borderBottom:'1px solid var(--light)', padding:isMobile ? '42px 20px 30px' : '58px 32px 38px' }}>
        <div style={{ maxWidth:1040, margin:'0 auto' }}>
          <p style={{ fontSize:11, letterSpacing:'0.26em', color:'var(--gold)', textTransform:'uppercase', marginBottom:10 }}>Account</p>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:isMobile ? 30 : 46, fontWeight:300, color:'var(--black)', marginBottom:12 }}>會員專區</h1>
          <p style={{ fontSize:14, color:'var(--dark)', lineHeight:1.8 }}>您好，{user.name}</p>
        </div>
      </div>

      <div style={{ maxWidth:1040, margin:'0 auto', padding:isMobile ? '32px 20px 72px' : '48px 32px 88px' }}>
        <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : '280px 1fr', gap:isMobile ? 28 : 40, alignItems:'start' }}>
          <aside style={{ borderTop:'1px solid var(--black)', paddingTop:20 }}>
            <div style={{ fontSize:12, letterSpacing:'0.16em', color:'var(--dark)', textTransform:'uppercase', marginBottom:18 }}>會員資料</div>
            <div style={{ display:'grid', gap:14 }}>
              <div>
                <div style={{ fontSize:11, color:'var(--dark)', marginBottom:4 }}>姓名</div>
                <div style={{ fontSize:15, color:'var(--black)' }}>{user.name}</div>
              </div>
              {visibleEmail && (
                <div>
                  <div style={{ fontSize:11, color:'var(--dark)', marginBottom:4 }}>Email</div>
                  <div style={{ fontSize:13, color:'var(--black)', wordBreak:'break-all' }}>{visibleEmail}</div>
                </div>
              )}
              <div>
                <div style={{ fontSize:11, color:'var(--dark)', marginBottom:4 }}>會員類型</div>
                <div style={{ fontSize:15, color:'var(--black)' }}>{getMemberTier(user).label}</div>
              </div>
              {!isProfessionalMember(user) && (
                <div style={{ marginTop:4, padding:'16px', background:'var(--off-white)', borderLeft:'2px solid var(--gold)' }}>
                  {proAppStatus === 'pending' ? (
                    <>
                      <div style={{ fontSize:11, letterSpacing:'0.1em', color:'var(--gold)', textTransform:'uppercase', marginBottom:6 }}>美容師申請審核中</div>
                      <p style={{ fontSize:12, color:'var(--dark)', lineHeight:1.7 }}>我們正在審核您的申請，通過後將自動開通專業會員功能。</p>
                    </>
                  ) : proAppStatus === 'rejected' ? (
                    <>
                      <div style={{ fontSize:11, letterSpacing:'0.1em', color:'#c0392b', textTransform:'uppercase', marginBottom:6 }}>申請未通過</div>
                      <p style={{ fontSize:12, color:'var(--dark)', lineHeight:1.7, marginBottom:10 }}>如有疑問請透過 LINE 聯繫客服。</p>
                      <button onClick={() => goProfessionalApply(user, setPage)} style={{ background:'none', border:'none', padding:0, fontSize:12, color:'var(--dark)', cursor:'pointer', fontFamily:'var(--font-body)', textDecoration:'underline', letterSpacing:'0.04em' }}>重新申請 →</button>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize:11, letterSpacing:'0.1em', color:'var(--gold)', textTransform:'uppercase', marginBottom:6 }}>成為認證美容師</div>
                      <p style={{ fontSize:12, color:'var(--dark)', lineHeight:1.7, marginBottom:10 }}>享有院線商品購買資格及專業折扣。</p>
                      <button onClick={() => goProfessionalApply(user, setPage)} style={{ background:'none', border:'none', padding:0, fontSize:12, color:'var(--black)', cursor:'pointer', fontFamily:'var(--font-body)', letterSpacing:'0.08em', fontWeight:500 }}>申請專業會員 →</button>
                    </>
                  )}
                </div>
              )}
              {isAdmin && (
                <button onClick={openAdmin} style={{ marginTop:8, width:'fit-content', background:'var(--black)', color:'var(--white)', border:'1px solid var(--black)', padding:'10px 18px', fontSize:12, letterSpacing:'0.08em', cursor:'pointer', fontFamily:'var(--font-body)' }}>進入後台</button>
              )}
              <button onClick={onSignOut} style={{ marginTop:8, width:'fit-content', background:'none', color:'var(--dark)', border:'1px solid var(--light)', padding:'10px 18px', fontSize:12, letterSpacing:'0.08em', cursor:'pointer', fontFamily:'var(--font-body)' }}>登出</button>
            </div>
          </aside>

          <section>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:16, marginBottom:22 }}>
              <h2 style={{ fontFamily:'var(--font-display)', fontSize:isMobile ? 24 : 32, fontWeight:300, color:'var(--black)' }}>我的訂單</h2>
              <span style={{ fontSize:12, color:'var(--dark)' }}>{orders.length} 筆</span>
            </div>

            {loading && <div style={{ fontSize:13, color:'var(--dark)', padding:'28px 0', borderTop:'1px solid var(--light)' }}>正在載入訂單...</div>}
            {error && <div style={{ fontSize:13, color:'#991b1b', background:'#fef2f2', border:'1px solid #fecaca', padding:'14px 16px', marginBottom:18 }}>{error}</div>}
            {!loading && !error && orders.length === 0 && (
              <div style={{ borderTop:'1px solid var(--light)', padding:'32px 0' }}>
                <p style={{ fontSize:14, color:'var(--dark)', lineHeight:1.8, marginBottom:18 }}>目前沒有訂單紀錄。</p>
                <button onClick={() => setPage('shop')} style={{ background:'var(--black)', color:'var(--white)', border:'none', padding:'12px 24px', fontSize:12, letterSpacing:'0.12em', cursor:'pointer', fontFamily:'var(--font-body)' }}>前往購物</button>
              </div>
            )}

            <div style={{ display:'grid', gap:14 }}>
              {orders.map(order => {
                const items = Array.isArray(order.items) ? order.items : [];
                const paymentDueTime = new Date(order.payment_due_at || '').getTime();
                const paymentExpired = Number.isFinite(paymentDueTime) && paymentDueTime <= Date.now();
                const canResumePayment = ['awaiting_confirm', 'unpaid'].includes(order.status)
                  && !paymentExpired;
                return (
                  <div key={order.id} style={{ border:'1px solid var(--light)', padding:isMobile ? 16 : 20, background:'var(--white)' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', gap:16, alignItems:'flex-start', marginBottom:14 }}>
                      <div>
                        <div style={{ fontSize:12, color:'var(--dark)', marginBottom:5 }}>訂單編號</div>
                        <div style={{ fontSize:14, color:'var(--black)', fontWeight:500, wordBreak:'break-all' }}>{order.id}</div>
                      </div>
                      <span style={{ flexShrink:0, fontSize:11, letterSpacing:'0.08em', border:'1px solid var(--gold)', color:'var(--black)', padding:'5px 9px' }}>{getOrderStatusLabel(order.status)}</span>
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:isMobile ? '1fr' : '1fr auto', gap:isMobile ? 12 : 24, borderTop:'1px solid var(--light)', paddingTop:14 }}>
                      <div style={{ display:'grid', gap:8 }}>
                        {items.map((item, idx) => (
                          <div key={`${order.id}-${idx}`} style={{ display:'flex', justifyContent:'space-between', gap:12, fontSize:13, color:'var(--dark)', lineHeight:1.6 }}>
                            <span>
                              {item.name || item.nameZh || '商品'} × {item.qty || 1}
                              {item.fulfillment && (
                                <span style={{ display:'block', fontSize:12, color: item.fulfillment_type === 'preorder' ? 'var(--gold)' : 'var(--dark)' }}>{item.fulfillment_type === 'loading' ? '庫存資料載入中' : `${item.fulfillment} · ${item.shipping_time || ''}`}</span>
                              )}
                            </span>
                            {item.price != null && <span>NT$ {Number(item.price).toLocaleString()}</span>}
                          </div>
                        ))}
                        {order.promotion_name && <div style={{ fontSize:12, color:'var(--gold)' }}>活動：{order.promotion_name}</div>}
                        {order.fulfillment_method === 'onsite_pickup' && (
                          <div style={{ marginTop:4, padding:'12px 14px', background:'var(--off-white)', border:'1px solid var(--gold)', fontSize:12, color:'var(--dark)' }}>
                            客訂商品現場自取{order.status === 'ready_for_pickup' ? '，商品已可取貨' : order.status === 'picked_up' ? '，已完成取貨' : '，目前正在處理中'}。
                          </div>
                        )}
                        {order.fulfillment_method !== 'onsite_pickup' && order.tracking && (
                          <div style={{ marginTop:4, padding:'12px 14px', background:'var(--off-white)', border:'1px solid var(--light)' }}>
                            <div style={{ fontSize:12, color:'var(--dark)', marginBottom:5 }}>物流公司：順豐速運</div>
                            <div style={{ fontSize:12, color:'var(--dark)', marginBottom:10 }}>托運單號：{order.tracking}</div>
                            {order.shipped_at && <div style={{ fontSize:11, color:'var(--dark)', marginBottom:10 }}>出貨時間：{shipmentTime(order.shipped_at)}</div>}
                            <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                              <button type="button" onClick={() => copyTracking(order.tracking)} style={{ border:'1px solid var(--light)', background:'var(--white)', color:'var(--dark)', padding:'7px 10px', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>
                                {copiedTracking === order.tracking ? '已複製' : '複製單號'}
                              </button>
                              <a href={SF_EXPRESS_TRACKING_URL} target="_blank" rel="noreferrer" style={{ border:'1px solid var(--black)', background:'var(--black)', color:'var(--white)', padding:'7px 10px', fontSize:11, textDecoration:'none' }}>前往順豐查件</a>
                            </div>
                            <p style={{ fontSize:11, color:'var(--dark)', lineHeight:1.7, marginTop:10 }}>
                              後續派送或取件通知以順豐電話、簡訊或 APP 推播為準，請保持收件電話暢通。
                            </p>
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign:isMobile ? 'left' : 'right' }}>
                        <div style={{ fontSize:12, color:'var(--dark)', marginBottom:5 }}>{order.date || order.created_at?.slice(0, 10) || ''}</div>
                        <div style={{ fontFamily:'var(--font-display)', fontSize:20, color:'var(--black)' }}>NT$ {Number(order.total || 0).toLocaleString()}</div>
                        {canResumePayment && (
                          <button
                            type="button"
                            onClick={() => openPendingPayment(order)}
                            disabled={openingPaymentOrder === order.id}
                            style={{ marginTop:12, border:'1px solid var(--black)', background:'var(--black)', color:'var(--white)', padding:'9px 12px', fontSize:11, letterSpacing:'0.08em', cursor:openingPaymentOrder === order.id ? 'wait' : 'pointer', fontFamily:'inherit', opacity:openingPaymentOrder === order.id ? 0.65 : 1 }}
                          >
                            {openingPaymentOrder === order.id ? '正在讀取…' : '查看付款資訊'}
                          </button>
                        )}
                        {paymentExpired && ['awaiting_confirm', 'unpaid'].includes(order.status) && (
                          <div style={{ marginTop:10, fontSize:11, color:'#8a3c2c' }}>付款期限已過</div>
                        )}
                      </div>
                    </div>
                    {paymentErrors[order.id] && (
                      <div role="alert" style={{ marginTop:12, border:'1px solid #fecaca', background:'#fef2f2', color:'#991b1b', padding:'10px 12px', fontSize:12, lineHeight:1.6 }}>
                        {paymentErrors[order.id]}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
