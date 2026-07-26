import React, { useEffect, useState } from 'react';
import AuthForms from '../components/auth/AuthForms.jsx';
import BackHomeButton from '../components/auth/BackHomeButton.jsx';
import {
  LINE_LOGIN_PENDING_KEY,
  LOGIN_NOTICE_KEY,
} from '../app/authSession.js';
import {
  findProfileByEmail,
  upsertConsumerProfile,
} from '../services/profiles.js';
import {
  cleanAuthCallbackFromUrl,
  getAuthCallbackErrorMessage,
  getAuthRedirectUrl,
  getLineLoginErrorMessage,
  getPasswordResetRedirectUrl,
  hasAuthCallbackInUrl,
  isEmailVerificationCallback,
  requestPasswordReset,
  sbError,
  signInWithPassword,
  signUp,
} from '../services/auth.js';

export default function LoginPage({ setPage }) {
  const [view, setView]         = useState('login'); // 'login' | 'register' | 'forgot'
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm]   = useState('');
  const [name, setName]         = useState('');
  const [phone, setPhone]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  const [notice, setNotice]     = useState('');

  function reset() { setError(''); setSuccess(''); setNotice(''); }

  useEffect(() => {
    const lineError = getLineLoginErrorMessage();
    if (lineError) {
      setView('login');
      setError(lineError);
      cleanAuthCallbackFromUrl('/login');
      return;
    }
    const notice = sessionStorage.getItem('eclado_auth_notice');
    if (notice === 'email_verified') {
      sessionStorage.removeItem('eclado_auth_notice');
      setView('login');
      setSuccess('✓ Email 已驗證成功，請使用您的帳號密碼登入。');
    } else if (notice?.startsWith('error:')) {
      sessionStorage.removeItem('eclado_auth_notice');
      setView('login');
      setError(notice.slice(6));
    }
    const loginNotice = sessionStorage.getItem(LOGIN_NOTICE_KEY);
    if (loginNotice) {
      sessionStorage.removeItem(LOGIN_NOTICE_KEY);
      setView('login');
      setNotice(loginNotice);
    }
  }, []);

  // ── 登入 ──
  async function handleSignIn(e) {
    e.preventDefault(); reset(); setLoading(true);
    try {
      const { error } = await signInWithPassword({ email, password });
      if (error) { setError(sbError(error.message)); return; }
      setPage(consumeCheckoutLoginRedirectPage());
    } catch(err) { setError('網路異常，請確認連線'); }
    finally { setLoading(false); }
  }

  // ── 註冊 ──
  async function handleRegister(e) {
    e.preventDefault(); reset();
    if (password !== confirm) { setError('兩次密碼不一致'); return; }
    setLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const {
        data: existingProfile,
        error: profileCheckError,
      } = await findProfileByEmail(normalizedEmail);
      if (profileCheckError) {
        console.warn('[ECLADO] 檢查會員是否存在失敗：', profileCheckError.message);
      }
      if (existingProfile) {
        setError('此 Email 已註冊會員，請直接登入或使用忘記密碼。');
        return;
      }

      const { data, error } = await signUp({
        email: normalizedEmail, password,
        options: {
          data: { name, phone, role: 'consumer' },
          emailRedirectTo: getAuthRedirectUrl(),
        }
      });
      if (error) { setError(sbError(error.message)); return; }
      if (data?.user?.id) {
        await upsertConsumerProfile({
          id: data.user.id,
          email: normalizedEmail, name, phone,
        });
      }
      if (data?.session) {
        setSuccess('✓ 會員已建立完成，請直接登入。');
      } else {
        setSuccess('✓ 驗證信已發送！請查收 ' + normalizedEmail + ' 並點擊驗證連結後再登入。若未收到，請檢查垃圾郵件或稍後再試一次。');
      }
      setView('login');
    } catch(err) { setError('網路異常，請確認連線'); }
    finally { setLoading(false); }
  }

  // ── 忘記密碼 ──
  async function handleForgot(e) {
    e.preventDefault(); reset(); setLoading(true);
    try {
      const { error } = await requestPasswordReset(
        email,
        getPasswordResetRedirectUrl(),
      );
      if (error) { setError(sbError(error.message)); return; }
      setSuccess('✓ 密碼重設信已發送至 ' + email + '，請查收信箱。');
    } catch(err) { setError('網路異常，請確認連線'); }
    finally { setLoading(false); }
  }

  function signInWithLine() {
    const state = Math.random().toString(36).substring(2, 15);
    sessionStorage.setItem('line_oauth_state', state);
    sessionStorage.setItem(LINE_LOGIN_PENDING_KEY, '1');
    const lineRedirectUri = 'https://www.ecladotaiwan.com/api/line-callback';
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: '2010106039',
      redirect_uri: lineRedirectUri,
      state,
      scope: 'profile openid email',
      bot_prompt: 'aggressive',
    });
    window.location.href = 'https://access.line.me/oauth2/v2.1/authorize?' + params;
  }

  return (
    <div style={{ minHeight:'100vh', display:'flex' }}>
      {/* Left visual */}
      <div className="login-visual" style={{ flex:1, display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', background:'var(--black)', padding:60, position:'relative', overflow:'hidden' }}>
        <img src="https://images.unsplash.com/photo-1571781926291-c477ebfd024b?w=900&q=85&fit=crop" alt="" style={{ position:'absolute', top:0, left:0, width:'100%', height:'100%', objectFit:'cover', opacity:0.35 }} />
        <div style={{ position:'relative', zIndex:1, textAlign:'center' }}>
          <div style={{ fontFamily:'var(--font-display)', fontSize:26, letterSpacing:'0.22em', color:'var(--white)', marginBottom:6 }}>ECLADO</div>
          <div style={{ fontSize:9, letterSpacing:'0.3em', color:'var(--gold)', marginBottom:40, textTransform:'uppercase' }}>Korean Cosmeceuticals</div>
          <p style={{ fontFamily:'var(--font-display)', fontSize:30, fontWeight:300, color:'var(--white)', lineHeight:1.4, marginBottom:20 }}>Professional<br />Skincare.</p>
          <p style={{ fontSize:13, color:'rgba(255,255,255,0.4)', lineHeight:1.9 }}>登入後享有完整購物體驗</p>
        </div>
      </div>

      {/* Right form */}
      <div style={{ width:'100%', maxWidth:480, display:'flex', flexDirection:'column', justifyContent:'center', padding:'60px 32px', background:'var(--white)', overflowY:'auto' }}>
        <BackHomeButton setPage={setPage} />

        <div style={{ marginBottom:28 }}>
          <div style={{ fontFamily:'var(--font-display)', fontSize:20, letterSpacing:'0.2em', color:'var(--black)', marginBottom:4 }}>ECLADO</div>
          <div style={{ fontSize:9, letterSpacing:'0.26em', color:'var(--gold)', textTransform:'uppercase' }}>Korean Cosmeceuticals</div>
        </div>

        {/* Tabs — 登入 / 註冊 (hidden on forgot view) */}
        {view !== 'forgot' && (
          <div style={{ display:'flex', marginBottom:32, borderBottom:'1px solid var(--light)' }}>
            <button onClick={() => { setView('login'); reset(); }} style={{ background:'none', border:'none', cursor:'pointer', fontFamily:'var(--font-body)', fontSize:14, padding:'11px 0', marginRight:28, color: view==='login' ? 'var(--black)' : 'var(--dark)', borderBottom: view==='login' ? '1px solid var(--black)' : '1px solid transparent', letterSpacing:'0.04em', fontWeight: view==='login' ? 500 : 300 }}>登入</button>
            <button onClick={() => { setView('register'); reset(); }} style={{ background:'none', border:'none', cursor:'pointer', fontFamily:'var(--font-body)', fontSize:14, padding:'11px 0', marginRight:28, color: view==='register' ? 'var(--black)' : 'var(--dark)', borderBottom: view==='register' ? '1px solid var(--black)' : '1px solid transparent', letterSpacing:'0.04em', fontWeight: view==='register' ? 500 : 300 }}>註冊</button>
          </div>
        )}

        {/* 忘記密碼 header */}
        {view === 'forgot' && (
          <div style={{ marginBottom:28 }}>
            <h2 style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:300, color:'var(--black)' }}>忘記密碼</h2>
            <p style={{ fontSize:13, color:'var(--dark)', marginTop:8, lineHeight:1.7 }}>輸入您的 Email，我們將發送密碼重設連結。</p>
          </div>
        )}

        {/* 成功訊息 */}
        {success && (
          <div style={{ background:'#f0faf0', border:'1px solid #b7ddb7', padding:'14px 16px', marginBottom:20, fontSize:13, color:'#2d6a2d', lineHeight:1.7 }}>{success}</div>
        )}

        {/* 提醒訊息 */}
        {notice && (
          <div style={{ background:'#fffbf0', border:'1px solid #e8d9b0', padding:'14px 16px', marginBottom:20, fontSize:13, color:'#5a4a1e', lineHeight:1.7 }}>{notice}</div>
        )}

        {/* 錯誤訊息 */}
        {error && (
          <div style={{ background:'#fff5f5', border:'1px solid #f5c0c0', padding:'14px 16px', marginBottom:20, fontSize:13, color:'#c0392b', lineHeight:1.7 }}>{error}</div>
        )}

        <AuthForms
          confirm={confirm}
          email={email}
          loading={loading}
          name={name}
          onConfirmChange={event => setConfirm(event.target.value)}
          onEmailChange={event => setEmail(event.target.value)}
          onForgot={handleForgot}
          onForgotView={() => { setView('forgot'); reset(); }}
          onLineSignIn={signInWithLine}
          onNameChange={event => setName(event.target.value)}
          onPasswordChange={event => setPassword(event.target.value)}
          onPhoneChange={event => setPhone(event.target.value)}
          onRegister={handleRegister}
          onSignIn={handleSignIn}
          password={password}
          phone={phone}
          view={view}
        />
      </div>
    </div>
  );
}
