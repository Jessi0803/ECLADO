import React from 'react';

export default function CheckoutField({ label, hint, name, type, required, placeholder, value, onChange }) {
  const hintId = hint ? `${name}-hint` : undefined;
  return (
    <div>
      <label style={{ fontSize:11, letterSpacing:'0.12em', color:'var(--dark)', textTransform:'uppercase', display:'block', marginBottom: hint ? 4 : 7, fontFamily:'var(--font-body)' }}>
        {label}{required !== false && <span style={{ color:'var(--accent)', marginLeft:3 }}>*</span>}
      </label>
      {hint && <p id={hintId} style={{ fontSize:12, lineHeight:1.6, color:'#6b6a67', margin:'0 0 4px', fontFamily:'var(--font-body)' }}>{hint}</p>}
      <input type={type||'text'} name={name} value={value} onChange={onChange} required={required !== false} placeholder={placeholder||''} aria-describedby={hintId}
        style={{ width:'100%', border:'none', borderBottom:'1px solid var(--light)', padding:'10px 0', fontSize:14, fontFamily:'var(--font-body)', fontVariantNumeric:'tabular-nums', outline:'none', background:'none', color:'var(--black)', boxSizing:'border-box' }}
        onFocus={e=>e.target.style.borderBottomColor='var(--black)'}
        onBlur={e=>e.target.style.borderBottomColor='var(--light)'}
      />
    </div>
  );
}
