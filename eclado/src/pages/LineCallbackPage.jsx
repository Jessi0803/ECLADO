import React, { useEffect, useState } from 'react';
import { CHECKOUT_LOGIN_REDIRECT_KEY } from '../app/authSession.js';
import { getSession } from '../services/auth.js';

export default function LineCallbackPage() {
  const [status, setStatus] = useState('LINE 登入中...');
  const [showRetry, setShowRetry] = useState(false);

  useEffect(() => {
    let done = false;
    getSession().then(({ data: { session } }) => {
      if (session?.user) {
        done = true;
        const nextLabel = sessionStorage.getItem(CHECKOUT_LOGIN_REDIRECT_KEY) === 'checkout' ? '結帳頁' : '會員專區';
        setStatus(`LINE 登入成功，正在前往${nextLabel}...`);
        return;
      }
    });
    const t = setTimeout(() => {
      if (done) return;
      setStatus('LINE 登入尚未完成，請重新登入或稍後再試。');
      setShowRetry(true);
    }, 8000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'var(--off-white)' }}>
      <div style={{ textAlign:'center' }}>
        <div style={{ fontSize:13, letterSpacing:'0.1em', color:'var(--dark)' }}>{status}</div>
        {showRetry && (
          <button onClick={() => window.location.href = '/login'} style={{ marginTop:18, background:'var(--black)', color:'var(--white)', border:'none', padding:'12px 24px', fontSize:12, letterSpacing:'0.12em', cursor:'pointer', fontFamily:'var(--font-body)' }}>
            返回登入
          </button>
        )}
      </div>
    </div>
  );
}

// ─── ACCOUNT PAGE ────────────────────────────────────────────────────────────
