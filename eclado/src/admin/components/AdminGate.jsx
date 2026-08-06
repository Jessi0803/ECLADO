import React, { useEffect, useState } from 'react';
import { supabase } from '../../services/supabase.js';

const ADMIN_EMAILS = [
  'baby90522@gmail.com',
  'ecladotaiwan@gmail.com',
  'k0919933386@gmail.com',
  'line.u6f71cfa36c3fb2188f54396a5cb58882@ecladotaiwan.com',
];

function isAdminEmail(email) {
  return ADMIN_EMAILS.includes((email || '').toLowerCase());
}

export default function AdminGate({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [email, setEmail] = useState('');
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password: pwd });
    setLoading(false);
    if (err) { setError('帳號或密碼錯誤'); setPwd(''); return; }
    if (!isAdminEmail(data.user?.email)) {
      await supabase.auth.signOut();
      setError('此帳號無管理員權限');
      setPwd('');
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (session === undefined) return null; // loading

  const isAdmin = session && isAdminEmail(session.user?.email);
  if (isAdmin) return React.cloneElement(children, { adminEmail: session.user.email, onSignOut: signOut });

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
        <input type="password" value={pwd} onChange={e => { setPwd(e.target.value); setError(''); }} required
          style={{ width: '100%', border: 'none', borderBottom: '1px solid var(--border)', padding: '10px 0', fontSize: 15, outline: 'none', background: 'none', color: 'var(--dark)', marginBottom: 8 }}
          onFocus={e => e.target.style.borderBottomColor = 'var(--dark)'}
          onBlur={e => e.target.style.borderBottomColor = 'var(--border)'}
        />
        {error && <p style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ width: '100%', background: 'var(--dark)', color: '#fff', border: 'none', padding: '14px', fontSize: 12, letterSpacing: '0.18em', cursor: loading ? 'not-allowed' : 'pointer', marginTop: 16, opacity: loading ? 0.7 : 1 }}>
          {loading ? '登入中…' : '進入後台'}
        </button>
      </form>
    </div>
  );
}
