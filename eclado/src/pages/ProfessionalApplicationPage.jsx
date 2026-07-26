import React, { useEffect, useState } from 'react';
import {
  LOGIN_NOTICE_KEY,
  POST_LOGIN_PAGE_KEY,
  PROFESSIONAL_LOGIN_NOTICE,
} from '../app/authSession.js';
import { getMemberRole } from '../domain/catalog.jsx';
import useIsMobile from '../hooks/useIsMobile.js';
import { fetchLatestProApplication } from '../services/membership.js';
import { setProfileRole } from '../services/profiles.js';
import { createProfessionalApplication } from '../services/professionalApplications.js';

export default function ProfessionalApplicationPage({ setPage, user, authReady, onUserUpdated }) {
  const [form, setForm] = useState({
    studioName: '',
    contactName: user?.name || '',
    phone: '',
    address: '',
    socialMedia: '',
    certificate: '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [gateLoading, setGateLoading] = useState(true);
  const [blocked, setBlocked] = useState(null); // 'login' | 'pro' | 'pending'
  const isMobile = useIsMobile();
  const inputStyle = { width:'100%', border:'none', borderBottom:'1px solid var(--light)', padding:'10px 0', fontSize:14, fontFamily:'var(--font-body)', outline:'none', background:'none', color:'var(--black)', boxSizing:'border-box' };
  const field = key => e => setForm(prev => ({ ...prev, [key]: e.target.value }));

  useEffect(() => {
    if (!authReady) return;
    let alive = true;
    async function checkAccess() {
      if (!user?.uid) {
        sessionStorage.setItem(POST_LOGIN_PAGE_KEY, 'professional-apply');
        sessionStorage.setItem(LOGIN_NOTICE_KEY, PROFESSIONAL_LOGIN_NOTICE);
        setPage('login');
        return;
      }
      const role = getMemberRole(user);
      if (['pro', 'instructor', 'distributor'].includes(role)) {
        if (alive) { setBlocked('pro'); setGateLoading(false); }
        return;
      }
      if (role === 'pending') {
        if (alive) { setBlocked('pending'); setGateLoading(false); }
        return;
      }
      const app = await fetchLatestProApplication(user.uid);
      if (!alive) return;
      if (app?.status === 'pending') {
        setBlocked('pending');
      }
      setGateLoading(false);
    }
    checkAccess();
    return () => { alive = false; };
  }, [authReady, user?.uid, user?.role]);

  useEffect(() => {
    if (user?.name && !form.contactName) {
      setForm(prev => ({ ...prev, contactName: user.name }));
    }
  }, [user?.name]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!user?.uid) {
      sessionStorage.setItem(POST_LOGIN_PAGE_KEY, 'professional-apply');
      sessionStorage.setItem(LOGIN_NOTICE_KEY, PROFESSIONAL_LOGIN_NOTICE);
      setPage('login');
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    const existing = await fetchLatestProApplication(user.uid);
    if (existing?.status === 'pending') {
      setSubmitError('您已有審核中的申請，請至會員專區查看。');
      setSubmitting(false);
      return;
    }
    const { error } = await createProfessionalApplication({
      studio_name: form.studioName,
      contact_name: form.contactName,
      phone: form.phone,
      address: form.address,
      social_media: form.socialMedia,
      certificate: form.certificate,
      user_id: user.uid,
      user_email: user.email || null,
      status: 'pending',
      source: 'standalone',
    });
    if (error) {
      setSubmitError('送出失敗，請稍後再試。');
      setSubmitting(false);
      return;
    }
    await setProfileRole(user.uid, 'pending');
    if (onUserUpdated) await onUserUpdated();
    setSubmitting(false);
    setSubmitted(true);
    window.scrollTo(0, 0);
  }

  const labelStyle = { fontSize:14, color:'var(--dark)', display:'block', marginBottom:8 };
  const twoCol = { display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: isMobile ? '28px' : '28px 40px' };

  return (
    <div style={{ paddingTop:68, minHeight:'100vh', background:'var(--white)' }}>
      <div style={{ background:'var(--black)', padding: isMobile ? '40px 20px' : '52px 32px', color:'var(--white)' }}>
        <div style={{ maxWidth:900, margin:'0 auto' }}>
          <div style={{ display:'flex', gap:18, flexWrap:'wrap', marginBottom:24 }}>
            <button onClick={() => window.history.back()} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.78)', cursor:'pointer', fontSize:12, letterSpacing:'0.08em', fontFamily:'var(--font-body)', padding:0 }}>← 返回</button>
          </div>
          <p style={{ fontSize:10, letterSpacing:'0.28em', color:'var(--gold)', textTransform:'uppercase', marginBottom:12 }}>Professional Membership</p>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:'clamp(22px,3vw,34px)', fontWeight:300, lineHeight:1.2, marginBottom:14 }}>申請成為專業會員</h1>
          <p style={{ fontSize:14, color:'rgba(255,255,255,0.62)', lineHeight:1.8, maxWidth:560 }}>請填寫以下基本資料，完成後我們將盡快與您聯繫，協助開立客戶資料、提供產品目錄與報價內容。</p>
        </div>
      </div>

      <div style={{ maxWidth:900, margin:'0 auto', padding: isMobile ? '36px 20px 60px' : '48px 32px 72px' }}>
        {!authReady || gateLoading ? (
          <p style={{ fontSize:14, color:'var(--dark)', padding:'24px 0' }}>載入中…</p>
        ) : blocked === 'pro' ? (
          <div style={{ border:'1px solid var(--light)', background:'var(--off-white)', padding:'28px' }}>
            <h2 style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:300, marginBottom:10 }}>您已是專業會員</h2>
            <p style={{ fontSize:14, lineHeight:1.8, marginBottom:20, color:'var(--dark)' }}>無需重複申請，可至會員專區查看帳戶資訊。</p>
            <button type="button" onClick={() => setPage('account')} style={{ background:'var(--black)', color:'var(--white)', border:'none', padding:'12px 28px', fontSize:12, letterSpacing:'0.12em', cursor:'pointer', fontFamily:'var(--font-body)' }}>前往會員專區</button>
          </div>
        ) : blocked === 'pending' ? (
          <div style={{ border:'1px solid var(--gold)', background:'#fffdf5', padding:'28px' }}>
            <h2 style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:300, marginBottom:10 }}>申請審核中</h2>
            <p style={{ fontSize:14, lineHeight:1.8, marginBottom:20, color:'var(--dark)' }}>我們正在審核您的美容師會員申請，通過後將自動開通專業價與院線商品購買資格。</p>
            <button type="button" onClick={() => setPage('account')} style={{ background:'var(--black)', color:'var(--white)', border:'none', padding:'12px 28px', fontSize:12, letterSpacing:'0.12em', cursor:'pointer', fontFamily:'var(--font-body)' }}>前往會員專區</button>
          </div>
        ) : submitted ? (
          <div style={{ border:'1px solid #b7ddb7', background:'#f0faf0', padding:'28px', color:'#2d6a2d' }}>
            <h2 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:300, color:'#1f5f1f', marginBottom:10 }}>申請資料已送出</h2>
            <p style={{ fontSize:14, lineHeight:1.8, marginBottom:20 }}>我們已收到您的專業會員申請資料，審核通過後將開通美容師會員功能。</p>
            <button type="button" onClick={() => setPage('account')} style={{ background:'var(--black)', color:'var(--white)', border:'none', padding:'12px 28px', fontSize:12, letterSpacing:'0.12em', cursor:'pointer', fontFamily:'var(--font-body)' }}>前往會員專區</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display:'flex', flexDirection:'column', gap:28 }}>

            <div>
              <label style={labelStyle}>① 皮膚管理院 / 工作室名稱</label>
              <input type="text" value={form.studioName} onChange={field('studioName')} required
                onFocus={e=>e.target.style.borderBottomColor='var(--dark)'}
                onBlur={e=>e.target.style.borderBottomColor='var(--light)'}
                style={inputStyle} />
            </div>

            <div style={twoCol}>
              <div>
                <label style={labelStyle}>② 聯絡人姓名</label>
                <input type="text" value={form.contactName} onChange={field('contactName')} required
                  onFocus={e=>e.target.style.borderBottomColor='var(--dark)'}
                  onBlur={e=>e.target.style.borderBottomColor='var(--light)'}
                  style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>③ 聯絡電話</label>
                <input type="tel" value={form.phone} onChange={field('phone')} required placeholder="09xx-xxx-xxx"
                  onFocus={e=>e.target.style.borderBottomColor='var(--dark)'}
                  onBlur={e=>e.target.style.borderBottomColor='var(--light)'}
                  style={inputStyle} />
              </div>
            </div>

            <div>
              <label style={labelStyle}>④ 收件地址</label>
              <input type="text" value={form.address} onChange={field('address')} required
                onFocus={e=>e.target.style.borderBottomColor='var(--dark)'}
                onBlur={e=>e.target.style.borderBottomColor='var(--light)'}
                style={inputStyle} />
            </div>

            <div>
              <label style={labelStyle}>⑤ 店家社群帳號 IG 或 Facebook（任一即可）</label>
              <input type="text" value={form.socialMedia} onChange={field('socialMedia')} required placeholder="@帳號名稱 或 https://..."
                onFocus={e=>e.target.style.borderBottomColor='var(--dark)'}
                onBlur={e=>e.target.style.borderBottomColor='var(--light)'}
                style={inputStyle} />
            </div>

            <div>
              <label style={labelStyle}>⑥ 美容相關證書（請填寫證書名稱或描述）</label>
              <textarea value={form.certificate} onChange={field('certificate')} required rows="3"
                placeholder="例：美容丙級技術士證照、美容師執照..."
                onFocus={e=>e.target.style.borderColor='var(--dark)'}
                onBlur={e=>e.target.style.borderColor='var(--light)'}
                style={{ ...inputStyle, resize:'vertical', border:'1px solid var(--light)', padding:'12px', lineHeight:1.7, borderBottom:'1px solid var(--light)' }} />
            </div>

            {submitError && <p style={{ fontSize:13, color:'#c0392b', marginTop:4 }}>{submitError}</p>}
            <div style={{ display:'flex', gap:12, flexWrap:'wrap', paddingTop:8 }}>
              <button type="submit" disabled={submitting} style={{ background:'var(--black)', color:'var(--white)', border:'none', padding:'15px 40px', fontSize:12, letterSpacing:'0.18em', cursor:submitting?'not-allowed':'pointer', fontFamily:'var(--font-body)', fontWeight:500, opacity:submitting?0.6:1 }}>{submitting ? '送出中…' : '送出申請'}</button>
              <button type="button" onClick={() => setPage('login')} style={{ background:'none', color:'var(--dark)', border:'1px solid var(--light)', padding:'15px 32px', fontSize:12, letterSpacing:'0.12em', cursor:'pointer', fontFamily:'var(--font-body)' }}>返回會員登入</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
