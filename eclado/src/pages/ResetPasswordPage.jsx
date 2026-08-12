import React, { useEffect, useState } from 'react';
import BackHomeButton from '../components/auth/BackHomeButton.jsx';
import PasswordVisibilityIcon from '../components/auth/PasswordVisibilityIcon.jsx';
import {
  cleanAuthCallbackFromUrl,
  getAuthCallbackErrorMessage,
  hasAuthCallbackInUrl,
  sbError,
  signOut,
  updatePassword,
} from '../services/auth.js';

export default function ResetPasswordPage({ setPage }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');

  function reset() { setError(''); setSuccess(''); }

  async function handleResetPassword(e) {
    e.preventDefault(); reset();
    if (password.length < 6) { setError('密碼至少需要 6 個字元'); return; }
    if (password !== confirm) { setError('兩次密碼不一致'); return; }
    setLoading(true);
    try {
      const { error } = await updatePassword(password);
      if (error) { setError(sbError(error.message)); return; }
      window.history.replaceState(null, '', window.location.pathname || '/');
      setPassword('');
      setConfirm('');
      setSuccess('✓ 密碼已更新，請使用新密碼重新登入。');
      await signOut();
    } catch(err) { setError('重設連結已失效，請重新申請密碼重設信。'); }
    finally { setLoading(false); }
  }

  const inputStyle = { width:'100%', border:'none', borderBottom:'1px solid var(--light)', padding:'9px 0', fontSize:15, fontFamily:'var(--font-body)', outline:'none', background:'none', color:'var(--dark)' };

  return (
    <div style={{ minHeight:'100vh', display:'flex' }}>
      <div className="login-visual" style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', background:'var(--black)', padding:60, position:'relative', overflow:'hidden' }}>
        <img src="https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=900&q=85&fit=crop" alt="" style={{ position:'absolute', top:0, left:0, width:'100%', height:'100%', objectFit:'cover', opacity:0.35 }} />
        <div style={{ position:'relative', zIndex:1, textAlign:'center' }}>
          <img src="/assets/images/ECLADO LOGO with CI_WHITE.png" alt="ECLADO Laboratory" style={{ width:190, height:'auto', display:'block', margin:'0 auto 8px' }} />
          <p style={{ fontFamily:'var(--font-display)', fontSize:30, fontWeight:500, color:'var(--white)', lineHeight:1.4, marginTop:40, marginBottom:20 }}>Reset<br />Password.</p>
          <p style={{ fontSize:13, color:'rgba(255,255,255,0.4)', lineHeight:1.9 }}>請設定新的會員密碼</p>
        </div>
      </div>

      <div style={{ width:'100%', maxWidth:480, display:'flex', flexDirection:'column', justifyContent:'center', padding:'60px 32px', background:'var(--white)', overflowY:'auto' }}>
        <BackHomeButton setPage={setPage} />

        <div style={{ marginBottom:28 }}>
          <img src="/assets/images/ECLADO LOGO with CI_WHITE.png" alt="ECLADO Laboratory" style={{ width:150, height:'auto', display:'block', filter:'brightness(0)', marginBottom:6 }} />
        </div>

        <div style={{ marginBottom:28 }}>
          <h2 style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:300, color:'var(--black)' }}>重設密碼</h2>
          <p style={{ fontSize:13, color:'var(--dark)', marginTop:8, lineHeight:1.7 }}>請輸入新的密碼，完成後可重新登入會員帳號。</p>
        </div>

        {success && (
          <div style={{ background:'#f0faf0', border:'1px solid #b7ddb7', padding:'14px 16px', marginBottom:20, fontSize:13, color:'#2d6a2d', lineHeight:1.7 }}>{success}</div>
        )}

        {error && (
          <div style={{ background:'#fff5f5', border:'1px solid #f5c0c0', padding:'14px 16px', marginBottom:20, fontSize:13, color:'#c0392b', lineHeight:1.7 }}>{error}</div>
        )}

        {!success && (
          <form onSubmit={handleResetPassword} style={{ display:'flex', flexDirection:'column', gap:22 }}>
            <div>
              <label style={{ fontSize:11, letterSpacing:'0.14em', color:'var(--dark)', textTransform:'uppercase', display:'block', marginBottom:9 }}>新密碼（至少 6 位）</label>
              <div style={{ position:'relative' }}>
                <input type={passwordVisible ? 'text' : 'password'} value={password} onChange={e=>setPassword(e.target.value)} required minLength={6} style={{ ...inputStyle, paddingRight:52 }}
                  onFocus={e=>e.target.style.borderBottomColor='var(--dark)'}
                  onBlur={e=>e.target.style.borderBottomColor='var(--light)'} />
                <button type="button" onClick={() => setPasswordVisible(current => !current)} aria-label={passwordVisible ? '隱藏密碼' : '顯示密碼'} style={{ position:'absolute', right:0, top:0, bottom:1, width:34, display:'flex', alignItems:'center', justifyContent:'flex-end', border:'none', background:'transparent', padding:0, color:'var(--dark)', opacity:0.72, cursor:'pointer' }}><PasswordVisibilityIcon visible={passwordVisible} /></button>
              </div>
            </div>
            <div>
              <label style={{ fontSize:11, letterSpacing:'0.14em', color:'var(--dark)', textTransform:'uppercase', display:'block', marginBottom:9 }}>確認新密碼</label>
              <div style={{ position:'relative' }}>
                <input type={confirmVisible ? 'text' : 'password'} value={confirm} onChange={e=>setConfirm(e.target.value)} required style={{ ...inputStyle, paddingRight:52 }}
                  onFocus={e=>e.target.style.borderBottomColor='var(--dark)'}
                  onBlur={e=>e.target.style.borderBottomColor='var(--light)'} />
                <button type="button" onClick={() => setConfirmVisible(current => !current)} aria-label={confirmVisible ? '隱藏密碼' : '顯示密碼'} style={{ position:'absolute', right:0, top:0, bottom:1, width:34, display:'flex', alignItems:'center', justifyContent:'flex-end', border:'none', background:'transparent', padding:0, color:'var(--dark)', opacity:0.72, cursor:'pointer' }}><PasswordVisibilityIcon visible={confirmVisible} /></button>
              </div>
            </div>
            <button type="submit" disabled={loading} style={{ width:'100%', background: loading ? 'var(--mid)' : 'var(--black)', color:'var(--white)', border:'none', padding:'15px', fontSize:12, letterSpacing:'0.2em', textTransform:'uppercase', cursor: loading ? 'default' : 'pointer', fontFamily:'var(--font-body)', fontWeight:500 }}>
              {loading ? '更新中...' : '更新密碼'}
            </button>
          </form>
        )}

        {success && (
          <button onClick={() => setPage('login')} style={{ width:'100%', background:'var(--black)', color:'var(--white)', border:'none', padding:'15px', fontSize:12, letterSpacing:'0.2em', textTransform:'uppercase', cursor:'pointer', fontFamily:'var(--font-body)', fontWeight:500 }}>
            前往登入
          </button>
        )}
      </div>
    </div>
  );
}

// ─── PROFESSIONAL APPLICATION PAGE ────────────────────────────────────────────
