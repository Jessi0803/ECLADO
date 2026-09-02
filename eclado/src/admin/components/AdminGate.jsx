import React, { useEffect, useState } from 'react';
import { supabase } from '../../services/supabase.js';
import { getBackofficeAccess } from '../../services/membership.js';

export default function AdminGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [email, setEmail] = useState('');
  const [pwd, setPwd] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [backofficeAccess, setBackofficeAccess] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) setBackofficeAccess(null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let alive = true;
    if (!session) {
      setBackofficeAccess(null);
      return () => { alive = false; };
    }
    setBackofficeAccess(undefined);
    getBackofficeAccess().then(access => {
      if (alive) setBackofficeAccess(access);
    });
    return () => { alive = false; };
  }, [session?.user?.id]);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password: pwd });
    setLoading(false);
    if (err) { setError('帳號或密碼錯誤'); setPwd(''); return; }
    const access = await getBackofficeAccess();
    if (!access.permissions.length) {
      await supabase.auth.signOut();
      setError('此帳號無後台權限');
      setPwd('');
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (session === undefined || (session && backofficeAccess === undefined)) return null; // loading

  const hasBackofficeAccess = session && backofficeAccess?.permissions?.length > 0;
  if (hasBackofficeAccess) return React.cloneElement(children, { adminEmail: session.user.email, backofficeAccess, onSignOut: signOut });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--sidebar)', padding: 16 }}>
      <form onSubmit={submit} style={{ background: 'var(--white)', padding: 'clamp(32px, 6vw, 48px) clamp(24px, 5vw, 56px)', width: '100%', maxWidth: 380, boxShadow: '0 4px 24px rgba(0,0,0,0.2)' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src="/assets/images/ECLADO LOGO with CI_WHITE.png" alt="ECLADO Laboratory" style={{ width:120, height:'auto', display:'block', filter:'brightness(0)', margin:'0 auto 10px' }} />
          <div style={{ fontSize: 10, letterSpacing: '0.24em', color: 'var(--gold)', textTransform: 'uppercase' }}>管理後台 · 請登入</div>
        </div>
        <label style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--mid)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>電子郵件</label>
        <input type="email" value={email} onChange={e => { setEmail(e.target.value); setError(''); }} autoFocus required
          style={{ width: '100%', border: 'none', borderBottom: '1px solid var(--border)', padding: '10px 0', fontSize: 15, outline: 'none', background: 'none', color: 'var(--dark)', marginBottom: 20 }}
          onFocus={e => e.target.style.borderBottomColor = 'var(--dark)'}
          onBlur={e => e.target.style.borderBottomColor = 'var(--border)'}
        />
        <label style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--mid)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>密碼</label>
        <div style={{ position:'relative', marginBottom:8 }}>
          <input type={passwordVisible ? 'text' : 'password'} value={pwd} onChange={e => { setPwd(e.target.value); setError(''); }} required
            style={{ width: '100%', border: 'none', borderBottom: '1px solid var(--border)', padding: '10px 42px 10px 0', fontSize: 15, outline: 'none', background: 'none', color: 'var(--dark)' }}
            onFocus={e => e.target.style.borderBottomColor = 'var(--dark)'}
            onBlur={e => e.target.style.borderBottomColor = 'var(--border)'}
          />
          <button type="button" onClick={() => setPasswordVisible(current => !current)} aria-label={passwordVisible ? '隱藏密碼' : '顯示密碼'} style={{ position:'absolute', right:0, top:0, bottom:1, width:34, display:'flex', alignItems:'center', justifyContent:'flex-end', border:'none', background:'transparent', padding:0, color:'var(--dark)', opacity:0.72, cursor:'pointer' }}>
            {passwordVisible ? (
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M10.6 5.2A9.7 9.7 0 0112 5c5.4 0 9 7 9 7a17 17 0 01-2.4 3.4M6.2 6.2C4.2 7.7 3 10 3 12c0 0 3.6 7 9 7 1.3 0 2.5-.4 3.6-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M9.9 9.9a3 3 0 004.2 4.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M3 12s3.6-7 9-7 9 7 9 7-3.6 7-9 7-9-7-9-7z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            )}
          </button>
        </div>
        {error && <p style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ width: '100%', background: 'var(--dark)', color: '#fff', border: 'none', padding: '14px', fontSize: 12, letterSpacing: '0.18em', cursor: loading ? 'not-allowed' : 'pointer', marginTop: 16, opacity: loading ? 0.7 : 1 }}>
          {loading ? '登入中…' : '進入後台'}
        </button>
      </form>
    </div>
  );
}
