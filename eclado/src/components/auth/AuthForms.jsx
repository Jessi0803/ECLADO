import React from 'react';

const inputStyle = {
  width:'100%',
  border:'none',
  borderBottom:'1px solid var(--light)',
  padding:'9px 0',
  fontSize:15,
  fontFamily:'var(--font-body)',
  outline:'none',
  background:'none',
  color:'var(--dark)',
};

function AuthInput({ label, ...props }) {
  return (
    <div>
      <label style={{ fontSize:11, letterSpacing:'0.14em', color:'var(--dark)', textTransform:'uppercase', display:'block', marginBottom:9 }}>{label}</label>
      <input
        {...props}
        required
        style={inputStyle}
        onFocus={event => { event.target.style.borderBottomColor = 'var(--dark)'; }}
        onBlur={event => { event.target.style.borderBottomColor = 'var(--light)'; }}
      />
    </div>
  );
}

function SubmitButton({ children, disabled }) {
  return (
    <button type="submit" disabled={disabled} style={{ width:'100%', background: disabled ? 'var(--mid)' : 'var(--black)', color:'var(--white)', border:'none', padding:'15px', fontSize:12, letterSpacing:'0.2em', textTransform:'uppercase', cursor: disabled ? 'default' : 'pointer', fontFamily:'var(--font-body)', fontWeight:500, marginTop:4 }}>
      {children}
    </button>
  );
}

export default function AuthForms({
  confirm,
  email,
  loading,
  name,
  onConfirmChange,
  onEmailChange,
  onForgot,
  onForgotView,
  onLineSignIn,
  onNameChange,
  onPasswordChange,
  onPhoneChange,
  onRegister,
  onSignIn,
  password,
  phone,
  view,
}) {
  return (
    <>
      {view === 'login' && (
        <form onSubmit={onSignIn} style={{ display:'flex', flexDirection:'column', gap:22 }}>
          <AuthInput label="Email" type="email" value={email} onChange={onEmailChange} />
          <div>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:9 }}>
              <label style={{ fontSize:11, letterSpacing:'0.14em', color:'var(--dark)', textTransform:'uppercase' }}>密碼</label>
              <button type="button" onClick={onForgotView} style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--dark)', fontFamily:'var(--font-body)', letterSpacing:'0.04em', textDecoration:'underline', textUnderlineOffset:3 }}>忘記密碼？</button>
            </div>
            <input
              type="password"
              value={password}
              onChange={onPasswordChange}
              required
              style={inputStyle}
              onFocus={event => { event.target.style.borderBottomColor = 'var(--dark)'; }}
              onBlur={event => { event.target.style.borderBottomColor = 'var(--light)'; }}
            />
          </div>
          <SubmitButton disabled={loading}>{loading ? '登入中...' : '登入'}</SubmitButton>
        </form>
      )}

      {view === 'register' && (
        <form onSubmit={onRegister} style={{ display:'flex', flexDirection:'column', gap:22 }}>
          <AuthInput label="姓名" type="text" value={name} onChange={onNameChange} />
          <AuthInput label="手機" type="tel" value={phone} onChange={onPhoneChange} placeholder="09xx-xxx-xxx" />
          <AuthInput label="Email" type="email" value={email} onChange={onEmailChange} />
          <AuthInput label="密碼（至少 6 位）" type="password" value={password} onChange={onPasswordChange} minLength={6} />
          <AuthInput label="確認密碼" type="password" value={confirm} onChange={onConfirmChange} />
          <p style={{ fontSize:12, color:'var(--dark)', lineHeight:1.8, marginBottom:0 }}>想申請美容師資格？請先完成會員註冊，登入後再前往「<a href="/professional-apply" style={{ color:'var(--black)', textDecoration:'underline', textUnderlineOffset:3 }}>美容師申請</a>」頁面填寫資料。</p>
          <SubmitButton disabled={loading}>{loading ? '建立中...' : '建立帳號'}</SubmitButton>
        </form>
      )}

      {view === 'forgot' && (
        <form onSubmit={onForgot} style={{ display:'flex', flexDirection:'column', gap:22 }}>
          <AuthInput label="Email" type="email" value={email} onChange={onEmailChange} />
          <SubmitButton disabled={loading}>{loading ? '發送中...' : '發送重設密碼信'}</SubmitButton>
        </form>
      )}

      {view !== 'forgot' && (
        <>
          <div style={{ display:'flex', alignItems:'center', gap:14, margin:'24px 0' }}>
            <div style={{ flex:1, height:1, background:'var(--light)' }} />
            <span style={{ fontSize:11, color:'var(--dark)', letterSpacing:'0.1em' }}>或</span>
            <div style={{ flex:1, height:1, background:'var(--light)' }} />
          </div>
          <p style={{ fontSize:13, color:'var(--black)', lineHeight:1.8, margin:'-8px 0 12px', fontWeight:400 }}>使用 LINE 登入即表示您同意我們取得 LINE 帳號的 Email，用於會員帳戶識別、避免重複註冊與訂單通知。</p>
          <button onClick={onLineSignIn} style={{ width:'100%', background:'#00B900', color:'var(--white)', border:'none', padding:'14px', fontSize:13, letterSpacing:'0.08em', cursor:'pointer', fontFamily:'var(--font-body)', fontWeight:500, display:'flex', alignItems:'center', justifyContent:'center', gap:10 }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="white"><path d="M10 2C5.6 2 2 5.1 2 8.8c0 2.5 1.6 4.7 4 5.9l-.5 2 2.3-1.2c.7.2 1.4.3 2.2.3 4.4 0 8-3.1 8-6.8C18 5.1 14.4 2 10 2z"/></svg>
            使用 LINE 帳號登入
          </button>
        </>
      )}
    </>
  );
}
