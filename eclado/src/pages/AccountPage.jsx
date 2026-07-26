import React, { useEffect, useState } from 'react';
import {
  getMemberTier,
  isProfessionalMember,
} from '../domain/catalog.jsx';
import { getOrderStatusLabel } from '../domain/payments.js';
import useIsMobile from '../hooks/useIsMobile.js';
import {
  fetchLatestProApplication,
  goProfessionalApply,
  isAdminUser,
  openAdmin,
} from '../services/membership.js';
import { fetchAccountOrders } from '../services/accountOrders.js';
import { fetchProfessionalApplicationStatus } from '../services/professionalApplications.js';

export default function AccountPage({ user, setPage, onSignOut }) {
  const isMobile = useIsMobile();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [proAppStatus, setProAppStatus] = useState(null); // null | 'pending' | 'approved' | 'rejected'

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
              {isAdminUser(user) && (
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
                        {order.tracking && <div style={{ fontSize:12, color:'var(--dark)' }}>物流編號：{order.tracking}</div>}
                      </div>
                      <div style={{ textAlign:isMobile ? 'left' : 'right' }}>
                        <div style={{ fontSize:12, color:'var(--dark)', marginBottom:5 }}>{order.date || order.created_at?.slice(0, 10) || ''}</div>
                        <div style={{ fontFamily:'var(--font-display)', fontSize:20, color:'var(--black)' }}>NT$ {Number(order.total || 0).toLocaleString()}</div>
                      </div>
                    </div>
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
